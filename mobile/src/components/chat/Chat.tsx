import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Card, Divider, EmptyState, Hint, IconButton, Screen } from '@/components/ui';
import { Brand } from '@/constants/brand';
import {
  ChatMessage,
  Conversation,
  presenceLabel,
  showPhone,
  useChat,
} from '@/context/ChatContext';

const C = Brand.colors;

const dial = (digits: string) => Linking.openURL(`tel:${digits}`).catch(() => {});

/** Re-renders every 30 s so "Active 5 min ago" stays current. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

const dayLabel = (iso: string, now: number) => {
  const d = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Inbox time: "14:05" today, "Yesterday", or "12 Oct". */
const inboxTime = (iso: string, now: number) => {
  const label = dayLabel(iso, now);
  return label === 'Today' ? timeOf(iso) : label;
};

function OnlineDot({ online, size = 12 }: { online: boolean; size?: number }) {
  if (!online) return null;
  return (
    <View
      style={[
        styles.onlineDot,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

/* ========================================================================== */
/* Inbox                                                                       */
/* ========================================================================== */

export function InboxScreen() {
  const { conversations, inboxLoading, refreshInbox, openConversation, myRole } = useChat();
  const now = useNow();
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    refreshInbox().finally(() => setLoadedOnce(true));
  }, [refreshInbox]);

  const active = conversations.filter((c) => c.canMessage);
  const past = conversations.filter((c) => !c.canMessage);
  const other = myRole === 'restaurant' ? 'drivers' : 'restaurants';

  const renderRow = (c: Conversation, i: number) => {
    const fromMe = c.lastMessage?.senderRole === myRole;
    const preview = c.lastMessage
      ? `${fromMe ? 'You: ' : ''}${c.lastMessage.body}`
      : c.activeOrders.length
      ? `Order ${c.activeOrders.join(', ')} · say hello`
      : 'No messages yet';
    return (
      <View key={c.id} style={styles.gap12}>
        {i > 0 && <Divider />}
        <Pressable
          onPress={() => openConversation(c.id)}
          style={({ pressed }) => [styles.inboxRow, pressed && styles.pressed]}>
          <View>
            <Avatar name={c.counterpart.name} tone={c.counterpart.role === 'driver' ? 'info' : 'primary'} size={46} />
            <View style={styles.avatarDot}>
              <OnlineDot online={c.counterpart.online} />
            </View>
          </View>
          <View style={styles.flexText}>
            <View style={styles.rowBetween}>
              <Text style={[styles.cardTitle, styles.shrink]} numberOfLines={1}>
                {c.counterpart.name}
              </Text>
              {c.lastMessage && (
                <Text style={[styles.time, c.unreadCount > 0 && styles.timeUnread]}>
                  {inboxTime(c.lastMessage.createdAt, now)}
                </Text>
              )}
            </View>
            <View style={styles.rowBetween}>
              <Text
                style={[styles.preview, c.unreadCount > 0 && styles.previewUnread]}
                numberOfLines={1}>
                {preview}
              </Text>
              {c.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  if (!loadedOnce && inboxLoading && conversations.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <Screen>
      {conversations.length === 0 ? (
        <Card>
          <EmptyState
            icon="chatbubbles-outline"
            title="No chats yet"
            subtitle={
              myRole === 'restaurant'
                ? 'You can message a driver once they accept one of your orders.'
                : 'You can message a restaurant once you accept one of its orders.'
            }
          />
          <Button label="Refresh" icon="refresh" variant="secondary" onPress={refreshInbox} />
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <Text style={styles.section}>{`Active orders · ${active.length}`}</Text>
              <Card>{active.map(renderRow)}</Card>
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.section}>Past chats</Text>
              <Card>{past.map(renderRow)}</Card>
            </>
          )}
          <Hint icon="information-circle-outline">{`You can message ${other} while you have an order together.`}</Hint>
        </>
      )}
    </Screen>
  );
}

/* ========================================================================== */
/* Thread (full screen)                                                        */
/* ========================================================================== */

type Row =
  | { kind: 'message'; message: ChatMessage; showSeen: boolean }
  | { kind: 'day'; id: string; label: string };

/** Full-screen conversation, shown on top of whatever screen opened it. */
export function ChatThreadModal() {
  const { openConversationId, closeConversation } = useChat();
  return (
    <Modal
      visible={!!openConversationId}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={closeConversation}>
      {openConversationId && <ChatThread id={openConversationId} onClose={closeConversation} />}
    </Modal>
  );
}

function ChatThread({ id, onClose }: { id: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { conversations, thread, loadOlder, send, retry, myRole, connected } = useChat();
  const conversation = conversations.find((c) => c.id === id);
  const { messages, loading, hasOlder } = thread(id);
  const [draft, setDraft] = useState('');
  const now = useNow();

  // Newest first for the inverted list, with day separators and "Seen" on my last read message.
  const rows = useMemo<Row[]>(() => {
    const seenAt = conversation?.otherLastReadAt ?? null;
    const lastMine = [...messages].reverse().find((m) => m.senderRole === myRole && !m.pending);
    const out: Row[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      out.push({
        kind: 'message',
        message: m,
        showSeen: !!lastMine && m.id === lastMine.id && !!seenAt && seenAt >= m.createdAt,
      });
      const prev = messages[i - 1];
      if (!prev || dayLabel(prev.createdAt, now) !== dayLabel(m.createdAt, now)) {
        out.push({ kind: 'day', id: `day-${m.id}`, label: dayLabel(m.createdAt, now) });
      }
    }
    return out;
  }, [messages, conversation?.otherLastReadAt, myRole, now]);

  if (!conversation) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.primary} />
        <Button label="Close" variant="secondary" onPress={onClose} />
      </View>
    );
  }

  const { counterpart } = conversation;
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(id, text);
  };

  return (
    <KeyboardAvoidingView
      style={styles.threadRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={[styles.threadHeader, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
        <IconButton icon="chevron-back" label="Close chat" testID="chat-close" onPress={onClose} />
        <View>
          <Avatar name={counterpart.name} tone={counterpart.role === 'driver' ? 'info' : 'primary'} size={40} />
          <View style={styles.avatarDot}>
            <OnlineDot online={counterpart.online} size={11} />
          </View>
        </View>
        <View style={styles.flexText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {counterpart.name}
          </Text>
          <Text style={[styles.presence, counterpart.online && styles.presenceOnline]} numberOfLines={1}>
            {presenceLabel(counterpart, now)}
          </Text>
        </View>
        <IconButton icon="call-outline" label="Call" onPress={() => showPhone(counterpart.name, counterpart.phone, dial)} />
      </View>

      {conversation.activeOrders.length > 0 && (
        <View style={styles.orderStrip}>
          <Ionicons name="receipt-outline" size={14} color={C.ink2} />
          <Text style={styles.orderStripText} numberOfLines={1}>
            {`Order ${conversation.activeOrders.join(', ')}`}
          </Text>
          {!connected && <Text style={styles.reconnecting}>Reconnecting…</Text>}
        </View>
      )}

      {/* Messages */}
      <FlatList
        style={styles.flex1}
        contentContainerStyle={styles.messages}
        data={rows}
        inverted
        keyExtractor={(r) => (r.kind === 'day' ? r.id : r.message.id)}
        onEndReached={() => hasOlder && loadOlder(id)}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={loading ? <ActivityIndicator color={C.primary} style={styles.loader} /> : undefined}
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.emptyThread}>
              <Text style={styles.preview}>No messages yet. Say hello 👋</Text>
            </View>
          )
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Text style={styles.dayLabel}>{item.label}</Text>
          ) : (
            <Bubble
              message={item.message}
              mine={item.message.senderRole === myRole}
              seen={item.showSeen}
              onRetry={() => retry(id, item.message)}
            />
          )
        }
      />

      {/* Composer */}
      {conversation.canMessage ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={C.ink3}
            testID="chat-input"
            accessibilityLabel="Message"
            multiline
            maxLength={2000}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() }}
            testID="chat-send"
            style={({ pressed }) => [
              styles.sendButton,
              !draft.trim() && styles.sendDisabled,
              pressed && styles.pressed,
            ]}>
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.closedBar, { paddingBottom: insets.bottom + 12 }]}>
          <Ionicons name="lock-closed-outline" size={16} color={C.ink3} />
          <Text style={styles.closedText}>
            This chat opens again when you have an active order together.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  mine,
  seen,
  onRetry,
}: {
  message: ChatMessage;
  mine: boolean;
  seen: boolean;
  onRetry: () => void;
}) {
  const failed = message.pending === 'failed';
  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
      <Pressable
        disabled={!failed}
        onPress={onRetry}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, failed && styles.bubbleFailed]}>
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
      </Pressable>
      <Text style={styles.meta}>
        {failed
          ? 'Not sent · tap to retry'
          : message.pending === 'sending'
          ? 'Sending…'
          : `${timeOf(message.createdAt)}${seen ? ' · Seen' : ''}`}
      </Text>
    </View>
  );
}

/* ========================================================================== */
/* Styles                                                                      */
/* ========================================================================== */

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  flexText: { flex: 1, minWidth: 0, gap: 2 },
  shrink: { flexShrink: 1 },
  gap12: { gap: 12 },
  pressed: { opacity: 0.7 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  section: { ...Brand.type.micro, color: C.ink3, textTransform: 'uppercase', marginTop: 8, paddingHorizontal: 4 },
  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  inboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { ...Brand.type.caption, color: C.ink3, flex: 1 },
  previewUnread: { color: C.ink, fontWeight: '600' },
  time: { ...Brand.type.caption, color: C.ink3 },
  timeUnread: { color: C.primary, fontWeight: '600' },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  avatarDot: { position: 'absolute', right: -1, bottom: -1 },
  onlineDot: { backgroundColor: C.success, borderWidth: 2, borderColor: C.surface },

  threadRoot: { flex: 1, backgroundColor: C.bg },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  presence: { fontSize: 12, color: C.ink3 },
  presenceOnline: { color: C.success, fontWeight: '600' },
  orderStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.surfaceAlt,
  },
  orderStripText: { ...Brand.type.captionStrong, color: C.ink2, flex: 1 },
  reconnecting: { ...Brand.type.caption, color: C.warning },

  messages: { paddingHorizontal: 12, paddingVertical: 12, gap: 6 },
  loader: { marginVertical: 12 },
  emptyThread: { alignItems: 'center', paddingVertical: 40, transform: [{ scaleY: -1 }] },
  dayLabel: {
    alignSelf: 'center',
    ...Brand.type.captionStrong,
    color: C.ink3,
    marginVertical: 8,
  },
  bubbleWrap: { maxWidth: '80%', gap: 2 },
  bubbleWrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  bubbleMine: { backgroundColor: C.primary, borderBottomRightRadius: 6 },
  bubbleTheirs: {
    backgroundColor: C.surface,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  bubbleFailed: { opacity: 0.6 },
  bubbleText: { ...Brand.type.body, color: C.ink },
  bubbleTextMine: { color: '#FFFFFF' },
  meta: { fontSize: 11, color: C.ink3, paddingHorizontal: 4 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: C.surfaceAlt,
    ...Brand.type.body,
    color: C.ink,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  closedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  closedText: { ...Brand.type.caption, color: C.ink3, flex: 1 },
});
