"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { ApiError, api, errorMessage } from "./api";
import { useMerchant, type SocketEvent } from "./merchant-store";
import type { ChatMessage, Conversation } from "./types";

/**
 * Merchant <-> driver chat, the same threads the app shows. Messages are sent
 * over HTTPS and arrive over the merchant's live socket.
 */
interface Thread {
  messages: ChatMessage[];
  loading: boolean;
  hasOlder: boolean;
}

interface ChatState {
  conversations: Conversation[];
  unreadTotal: number;
  loaded: boolean;
  openId: string | null;
  open: (id: string | null) => void;
  /** Opens (or creates) the thread for an order. Resolves to its id, or null if chat isn't available. */
  openForOrder: (orderId: string) => Promise<string | null>;
  thread: (id: string) => Thread;
  loadOlder: (id: string) => Promise<void>;
  send: (id: string, body: string) => Promise<void>;
  retry: (id: string, message: ChatMessage) => Promise<void>;
}

const ChatContext = createContext<ChatState | null>(null);
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

const EMPTY: Thread = { messages: [], loading: false, hasOlder: false };
const PAGE = 50;
const INBOX_POLL_MS = 30_000;

function merge(existing: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const byRecent = (a: Conversation, b: Conversation) => b.updatedAt.localeCompare(a.updatedAt);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useMerchant();
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const openRef = useRef<string | null>(null);
  const threadsRef = useRef(threads);
  const convRef = useRef(conversations);
  useEffect(() => {
    openRef.current = openId;
    threadsRef.current = threads;
    convRef.current = conversations;
  });

  const refreshInbox = useCallback(async () => {
    try {
      const res = await api<{ conversations: Conversation[] }>("merchant", "GET", "/api/chat/conversations");
      setConversations(res.conversations.sort(byRecent));
    } catch {
      // Keep what we have; the next refresh tries again.
    } finally {
      setLoaded(true);
    }
  }, []);

  const upsert = useCallback((c: Conversation) => {
    setConversations((prev) => [c, ...prev.filter((p) => p.id !== c.id)].sort(byRecent));
  }, []);

  /** Loads the newest page (this also marks the thread read on the server). */
  const loadLatest = useCallback(
    async (id: string) => {
      setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY), loading: true } }));
      try {
        const res = await api<{ conversation: Conversation; messages: ChatMessage[] }>(
          "merchant",
          "GET",
          `/api/chat/conversations/${id}/messages?limit=${PAGE}`
        );
        upsert({ ...res.conversation, unreadCount: 0 });
        setThreads((t) => {
          const cur = t[id] ?? EMPTY;
          const local = cur.messages.filter((m) => m.pending);
          return {
            ...t,
            [id]: {
              messages: merge(merge(cur.messages.filter((m) => !m.pending), res.messages), local),
              loading: false,
              hasOlder: cur.messages.length === 0 ? res.messages.length === PAGE : cur.hasOlder,
            },
          };
        });
      } catch (err) {
        setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY), loading: false } }));
        toast({ tone: "error", title: "Couldn’t load messages", body: errorMessage(err) });
      }
    },
    [upsert, toast]
  );

  const loadOlder = useCallback(async (id: string) => {
    const cur = threadsRef.current[id];
    if (!cur || cur.loading || !cur.hasOlder) return;
    const oldest = cur.messages.find((m) => !m.pending);
    if (!oldest) return;
    setThreads((t) => ({ ...t, [id]: { ...cur, loading: true } }));
    try {
      const res = await api<{ messages: ChatMessage[] }>(
        "merchant",
        "GET",
        `/api/chat/conversations/${id}/messages?limit=${PAGE}&before=${encodeURIComponent(oldest.createdAt)}`
      );
      setThreads((t) => ({
        ...t,
        [id]: { messages: merge((t[id] ?? EMPTY).messages, res.messages), loading: false, hasOlder: res.messages.length === PAGE },
      }));
    } catch {
      setThreads((t) => ({ ...t, [id]: { ...(t[id] ?? EMPTY), loading: false } }));
    }
  }, []);

  // Live events from the merchant's socket.
  useEffect(
    () =>
      subscribe((event: SocketEvent) => {
        if (event.type === "message") {
          const message: ChatMessage = event.message;
          const id: string = event.conversationId;
          const mine = message.senderRole === "restaurant";
          const viewing = openRef.current === id && document.visibilityState === "visible";
          setThreads((t) => (t[id] ? { ...t, [id]: { ...t[id], messages: merge(t[id].messages, [message]) } } : t));
          const known = convRef.current.some((c) => c.id === id);
          setConversations((prev) =>
            prev
              .map((c) =>
                c.id !== id
                  ? c
                  : {
                      ...c,
                      lastMessage: { body: message.body, senderRole: message.senderRole, createdAt: message.createdAt },
                      unreadCount: mine || viewing ? 0 : c.unreadCount + 1,
                      updatedAt: message.createdAt,
                    }
              )
              .sort(byRecent)
          );
          if (!known) refreshInbox();
          if (!mine && viewing) api("merchant", "POST", `/api/chat/conversations/${id}/read`).catch(() => {});
        } else if (event.type === "read") {
          setConversations((prev) =>
            prev.map((c) =>
              c.id !== event.conversationId
                ? c
                : event.role === "restaurant"
                  ? { ...c, unreadCount: 0 }
                  : { ...c, otherLastReadAt: event.readAt }
            )
          );
        } else if (event.type === "presence") {
          setConversations((prev) =>
            prev.map((c) =>
              c.counterpart.userId === event.userId
                ? { ...c, counterpart: { ...c.counterpart, online: event.online, lastSeenAt: event.lastSeenAt } }
                : c
            )
          );
        } else if (event.type === "orders") {
          // A driver may just have accepted an order: a new thread.
          refreshInbox();
        } else if (event.type === "ready") {
          refreshInbox();
          if (openRef.current) loadLatest(openRef.current);
        }
      }),
    [subscribe, refreshInbox, loadLatest]
  );

  useEffect(() => {
    // Fetching from the API is the external system this effect syncs with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshInbox();
    const t = setInterval(refreshInbox, INBOX_POLL_MS);
    return () => clearInterval(t);
  }, [refreshInbox]);

  const open = useCallback(
    (id: string | null) => {
      setOpenId(id);
      if (!id) return;
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      loadLatest(id);
    },
    [loadLatest]
  );

  const openForOrder = useCallback(
    async (orderId: string) => {
      try {
        const res = await api<{ conversation: Conversation }>("merchant", "POST", "/api/chat/open", { orderId });
        upsert(res.conversation);
        open(res.conversation.id);
        return res.conversation.id;
      } catch (err) {
        toast({ tone: "error", title: "Chat not available", body: errorMessage(err) });
        return null;
      }
    },
    [open, upsert, toast]
  );

  const deliver = useCallback(
    async (id: string, local: ChatMessage) => {
      try {
        const res = await api<{ message: ChatMessage }>("merchant", "POST", `/api/chat/conversations/${id}/messages`, {
          body: local.body,
        });
        setThreads((t) => {
          const cur = t[id] ?? EMPTY;
          return { ...t, [id]: { ...cur, messages: merge(cur.messages.filter((m) => m.id !== local.id), [res.message]) } };
        });
        setConversations((prev) =>
          prev
            .map((c) =>
              c.id === id
                ? {
                    ...c,
                    lastMessage: { body: res.message.body, senderRole: "restaurant" as const, createdAt: res.message.createdAt },
                    updatedAt: res.message.createdAt,
                  }
                : c
            )
            .sort(byRecent)
        );
      } catch (err) {
        setThreads((t) => {
          const cur = t[id] ?? EMPTY;
          return { ...t, [id]: { ...cur, messages: cur.messages.map((m) => (m.id === local.id ? { ...m, pending: "failed" } : m)) } };
        });
        if (err instanceof ApiError && err.code === "CHAT_CLOSED") {
          toast({ tone: "error", title: "Chat closed", body: errorMessage(err) });
          refreshInbox();
        }
      }
    },
    [refreshInbox, toast]
  );

  const send = useCallback(
    async (id: string, body: string) => {
      const text = body.trim();
      if (!text) return;
      const local: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId: id,
        body: text,
        senderRole: "restaurant",
        createdAt: new Date(Date.now() + 1).toISOString(),
        pending: "sending",
      };
      setThreads((t) => {
        const cur = t[id] ?? EMPTY;
        return { ...t, [id]: { ...cur, messages: [...cur.messages, local] } };
      });
      await deliver(id, local);
    },
    [deliver]
  );

  const retry = useCallback(
    async (id: string, message: ChatMessage) => {
      setThreads((t) => {
        const cur = t[id] ?? EMPTY;
        return { ...t, [id]: { ...cur, messages: cur.messages.map((m) => (m.id === message.id ? { ...m, pending: "sending" } : m)) } };
      });
      await deliver(id, { ...message, pending: "sending" });
    },
    [deliver]
  );

  const thread = useCallback((id: string) => threads[id] ?? EMPTY, [threads]);
  const unreadTotal = useMemo(() => conversations.reduce((n, c) => n + c.unreadCount, 0), [conversations]);

  return (
    <ChatContext.Provider
      value={{ conversations, unreadTotal, loaded, openId, open, openForOrder, thread, loadOlder, send, retry }}
    >
      {children}
    </ChatContext.Provider>
  );
}

/** "Online", "Active 5 min ago"… */
export function presenceLabel(c: { online: boolean; lastSeenAt: string | null }, now = Date.now()) {
  if (c.online) return "Online";
  if (!c.lastSeenAt) return "Offline";
  const minutes = Math.floor((now - new Date(c.lastSeenAt).getTime()) / 60000);
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Active ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Active ${days} ${days === 1 ? "day" : "days"} ago`;
}
