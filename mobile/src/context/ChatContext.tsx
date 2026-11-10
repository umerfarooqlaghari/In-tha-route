import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { API_URL } from '@/constants/api';
import { errorMessage, useInThaRoute } from '@/context/InThaRouteContext';
import { api, getAccessToken, refreshSession } from '@/services/apiClient';

/**
 * Restaurant <-> driver chat.
 *
 * Messages are sent over HTTPS and arrive instantly over a WebSocket (`/ws`).
 * The socket is open only while the app is in the foreground, which is what the
 * other side sees as "Online"; when it closes they see "Active 5 min ago".
 */

export type ChatRole = 'restaurant' | 'driver';

export interface ChatCounterpart {
  userId: string;
  role: ChatRole;
  name: string;
  phone: string;
  subtitle: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Conversation {
  id: string;
  counterpart: ChatCounterpart;
  lastMessage: { body: string; senderRole: ChatRole; createdAt: string } | null;
  unreadCount: number;
  /** False once there is no active order together: the thread becomes read-only. */
  canMessage: boolean;
  activeOrders: string[];
  otherLastReadAt: string | null;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  body: string;
  senderRole: ChatRole;
  createdAt: string;
  /** Local only: a message still on its way, or one that failed to send. */
  pending?: 'sending' | 'failed';
}

interface Thread {
  messages: ChatMessage[];
  loading: boolean;
  hasOlder: boolean;
}

interface ChatContextType {
  enabled: boolean;
  myRole: ChatRole | null;
  connected: boolean;
  conversations: Conversation[];
  unreadTotal: number;
  inboxLoading: boolean;
  refreshInbox: () => Promise<void>;
  /** The thread shown full screen, if any. */
  openConversationId: string | null;
  openConversation: (id: string) => void;
  /** Opens the thread for an order (Live orders / current stop). */
  openForOrder: (orderId: string) => Promise<void>;
  closeConversation: () => void;
  thread: (id: string) => Thread;
  loadOlder: (id: string) => Promise<void>;
  send: (id: string, body: string) => Promise<void>;
  retry: (id: string, message: ChatMessage) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const EMPTY_THREAD: Thread = { messages: [], loading: false, hasOlder: false };
const PAGE = 50;
const INBOX_POLL_MS = 30_000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000];

const SOCKET_URL = `${API_URL.replace(/^http/, 'ws')}/ws`;

/** Adds messages, keeping one copy of each and time order. */
function merge(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, role } = useInThaRoute();
  const myRole: ChatRole | null = role === 'restaurant' || role === 'driver' ? role : null;
  const enabled = isLoggedIn && !!myRole;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openConversationId;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */

  const refreshInbox = useCallback(async () => {
    if (!enabled) return;
    setInboxLoading(true);
    try {
      const res = await api<{ conversations: Conversation[] }>('GET', '/api/chat/conversations');
      setConversations(res.conversations);
    } catch {
      // Keep what we have; the next refresh will try again.
    } finally {
      setInboxLoading(false);
    }
  }, [enabled]);

  const upsertConversation = useCallback((c: Conversation) => {
    setConversations((prev) => {
      const rest = prev.filter((p) => p.id !== c.id);
      return [c, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  /** Loads the newest page (this also marks the thread read on the server). */
  const loadLatest = useCallback(
    async (id: string) => {
      setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY_THREAD), loading: true } }));
      try {
        const res = await api<{ conversation: Conversation; messages: ChatMessage[] }>(
          'GET',
          `/api/chat/conversations/${id}/messages?limit=${PAGE}`
        );
        upsertConversation({ ...res.conversation, unreadCount: 0 });
        setThreads((t) => {
          const current = t[id] ?? EMPTY_THREAD;
          // Keep unsent local messages on top of what the server has.
          const local = current.messages.filter((m) => m.pending);
          return {
            ...t,
            [id]: {
              messages: merge(merge(current.messages.filter((m) => !m.pending), res.messages), local),
              loading: false,
              hasOlder: current.messages.length === 0 ? res.messages.length === PAGE : current.hasOlder,
            },
          };
        });
      } catch (err) {
        setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY_THREAD), loading: false } }));
        Alert.alert('Couldn’t load messages', errorMessage(err));
      }
    },
    [upsertConversation]
  );

  const loadOlder = useCallback(async (id: string) => {
    const current = threadsRef.current[id];
    if (!current || current.loading || !current.hasOlder) return;
    const oldest = current.messages.find((m) => !m.pending);
    if (!oldest) return;
    setThreads((t) => ({ ...t, [id]: { ...current, loading: true } }));
    try {
      const res = await api<{ messages: ChatMessage[] }>(
        'GET',
        `/api/chat/conversations/${id}/messages?limit=${PAGE}&before=${encodeURIComponent(oldest.createdAt)}`
      );
      setThreads((t) => {
        const now = t[id] ?? EMPTY_THREAD;
        return {
          ...t,
          [id]: { messages: merge(now.messages, res.messages), loading: false, hasOlder: res.messages.length === PAGE },
        };
      });
    } catch {
      setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY_THREAD), loading: false } }));
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Live updates                                                            */
  /* ---------------------------------------------------------------------- */

  const handleEvent = useCallback(
    (event: any) => {
      if (event.type === 'message') {
        const message: ChatMessage = event.message;
        const id: string = event.conversationId;
        const mine = message.senderRole === myRole;
        const viewing = openIdRef.current === id && AppState.currentState === 'active';

        setThreads((t) => {
          if (!t[id]) return t;
          return { ...t, [id]: { ...t[id], messages: merge(t[id].messages, [message]) } };
        });

        const known = conversationsRef.current.some((c) => c.id === id);
        setConversations((prev) => {
          const next = prev.map((c) => {
            if (c.id !== id) return c;
            return {
              ...c,
              lastMessage: { body: message.body, senderRole: message.senderRole, createdAt: message.createdAt },
              unreadCount: mine || viewing ? 0 : c.unreadCount + 1,
              updatedAt: message.createdAt,
            };
          });
          return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        // A thread we have not seen yet (e.g. the driver just accepted an order).
        if (!known) refreshInbox();
        if (!mine && viewing) api('POST', `/api/chat/conversations/${id}/read`).catch(() => {});
      } else if (event.type === 'read') {
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== event.conversationId
              ? c
              : event.role === myRole
              ? { ...c, unreadCount: 0 } // read on another of my phones
              : { ...c, otherLastReadAt: event.readAt }
          )
        );
      } else if (event.type === 'presence') {
        setConversations((prev) =>
          prev.map((c) =>
            c.counterpart.userId === event.userId
              ? { ...c, counterpart: { ...c.counterpart, online: event.online, lastSeenAt: event.lastSeenAt } }
              : c
          )
        );
      } else if (event.type === 'ready') {
        // Catch up on anything sent while we were disconnected.
        refreshInbox();
        if (openIdRef.current) loadLatest(openIdRef.current);
      }
    },
    [myRole, refreshInbox, loadLatest]
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // One socket while signed in as a restaurant or driver with the app open.
  useEffect(() => {
    if (!enabled || !appActive) {
      setConnected(false);
      return;
    }
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) return;
      let token: string;
      try {
        token = await getAccessToken();
      } catch {
        scheduleReconnect();
        return;
      }
      if (stopped) return;
      const socket = new WebSocket(SOCKET_URL);
      ws = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
      socket.onmessage = (e) => {
        let event: any;
        try {
          event = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (event.type === 'ready') {
          attempt = 0;
          setConnected(true);
          pingTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
          }, 25_000);
        }
        if (event.type === 'error' && event.code === 'TOKEN_EXPIRED') {
          refreshSession().catch(() => {});
        }
        handleEventRef.current(event);
      };
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        setConnected(false);
        scheduleReconnect();
      };
      socket.onerror = () => {};
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close(1000);
      setConnected(false);
    };
  }, [enabled, appActive]);

  // The inbox also refreshes on its own (new threads appear when an order is accepted).
  useEffect(() => {
    if (!enabled) {
      setConversations([]);
      setThreads({});
      setOpenConversationId(null);
      return;
    }
    if (!appActive) return;
    refreshInbox();
    const timer = setInterval(refreshInbox, INBOX_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, appActive, refreshInbox]);

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  const openConversation = useCallback(
    (id: string) => {
      setOpenConversationId(id);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      loadLatest(id);
    },
    [loadLatest]
  );

  const openForOrder = useCallback(
    async (orderId: string) => {
      try {
        const res = await api<{ conversation: Conversation }>('POST', '/api/chat/open', { orderId });
        upsertConversation(res.conversation);
        openConversation(res.conversation.id);
      } catch (err) {
        Alert.alert('Chat not available', errorMessage(err));
      }
    },
    [openConversation, upsertConversation]
  );

  const closeConversation = useCallback(() => setOpenConversationId(null), []);

  const deliver = useCallback(
    async (id: string, local: ChatMessage) => {
      try {
        const res = await api<{ message: ChatMessage }>('POST', `/api/chat/conversations/${id}/messages`, {
          body: local.body,
        });
        setThreads((t) => {
          const current = t[id] ?? EMPTY_THREAD;
          return {
            ...t,
            [id]: { ...current, messages: merge(current.messages.filter((m) => m.id !== local.id), [res.message]) },
          };
        });
        setConversations((prev) =>
          prev
            .map((c) =>
              c.id === id
                ? {
                    ...c,
                    lastMessage: { body: res.message.body, senderRole: res.message.senderRole, createdAt: res.message.createdAt },
                    updatedAt: res.message.createdAt,
                  }
                : c
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
      } catch (err) {
        setThreads((t) => {
          const current = t[id] ?? EMPTY_THREAD;
          return {
            ...t,
            [id]: {
              ...current,
              messages: current.messages.map((m) => (m.id === local.id ? { ...m, pending: 'failed' } : m)),
            },
          };
        });
        // A closed chat will not succeed on retry, so say why.
        if (err instanceof Error && 'code' in err && (err as any).code === 'CHAT_CLOSED') {
          Alert.alert('Chat closed', errorMessage(err));
          refreshInbox();
        }
      }
    },
    [refreshInbox]
  );

  const send = useCallback(
    async (id: string, body: string) => {
      const text = body.trim();
      if (!text || !myRole) return;
      const local: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId: id,
        body: text,
        senderRole: myRole,
        // Sorts after everything already shown.
        createdAt: new Date(Date.now() + 1).toISOString(),
        pending: 'sending',
      };
      setThreads((t) => {
        const current = t[id] ?? EMPTY_THREAD;
        return { ...t, [id]: { ...current, messages: [...current.messages, local] } };
      });
      await deliver(id, local);
    },
    [deliver, myRole]
  );

  const retry = useCallback(
    async (id: string, message: ChatMessage) => {
      setThreads((t) => {
        const current = t[id] ?? EMPTY_THREAD;
        return {
          ...t,
          [id]: { ...current, messages: current.messages.map((m) => (m.id === message.id ? { ...m, pending: 'sending' } : m)) },
        };
      });
      await deliver(id, { ...message, pending: 'sending' });
    },
    [deliver]
  );

  const thread = useCallback((id: string) => threads[id] ?? EMPTY_THREAD, [threads]);
  const unreadTotal = useMemo(() => conversations.reduce((n, c) => n + c.unreadCount, 0), [conversations]);

  return (
    <ChatContext.Provider
      value={{
        enabled,
        myRole,
        connected,
        conversations,
        unreadTotal,
        inboxLoading,
        refreshInbox,
        openConversationId,
        openConversation,
        openForOrder,
        closeConversation,
        thread,
        loadOlder,
        send,
        retry,
      }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}

/** "Online", "Active 5 min ago", "Active 3 h ago"… */
export function presenceLabel(c: Pick<ChatCounterpart, 'online' | 'lastSeenAt'>, now = Date.now()): string {
  if (c.online) return 'Online';
  if (!c.lastSeenAt) return 'Offline';
  const minutes = Math.floor((now - new Date(c.lastSeenAt).getTime()) / 60000);
  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `Active ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Shows a phone number with a button that opens the dialer. */
export function showPhone(name: string, phone: string, openDialer: (digits: string) => void) {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) {
    Alert.alert(name, 'No phone number on file.');
    return;
  }
  Alert.alert(name, phone, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Call', onPress: () => openDialer(digits) },
  ]);
}
