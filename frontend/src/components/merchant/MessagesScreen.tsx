"use client";

import { motion } from "motion/react";
import { ArrowLeft, Check, CheckCheck, Loader2, Lock, MessagesSquare, Phone, RotateCw, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Avatar, Card, EmptyState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/format";
import { presenceLabel, useChat } from "@/lib/merchant-chat";
import type { ChatMessage, Conversation } from "@/lib/types";

const time = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function MessagesScreen() {
  const { conversations, loaded, openId, open } = useChat();
  const current = conversations.find((c) => c.id === openId) ?? null;

  return (
    <Card className="grid h-[calc(100dvh-170px)] min-h-[520px] overflow-hidden md:grid-cols-[340px_minmax(0,1fr)]">
      <div className={cn("flex min-h-0 flex-col border-r border-line", current && "max-md:hidden")}>
        <div className="border-b border-line px-5 py-4">
          <p className="font-bold text-ink">Chats</p>
          <p className="text-xs text-ink-3">A chat opens when a driver accepts one of your orders.</p>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {!loaded ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState icon={<MessagesSquare className="size-6" />} title="No chats yet" body="When a driver accepts an order you can message them here." />
          ) : (
            conversations.map((c) => <InboxRow key={c.id} c={c} active={c.id === openId} onClick={() => open(c.id)} />)
          )}
        </div>
      </div>
      <div className={cn("flex min-h-0 flex-col", !current && "max-md:hidden")}>
        {current ? (
          <ThreadView key={current.id} c={current} onBack={() => open(null)} />
        ) : (
          <div className="grid flex-1 place-items-center">
            <EmptyState icon={<MessagesSquare className="size-6" />} title="Pick a chat" body="Messages arrive here instantly, the same as in the app." />
          </div>
        )}
      </div>
    </Card>
  );
}

function InboxRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  const last = c.lastMessage;
  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left transition", active ? "bg-brand-soft" : "hover:bg-surface-alt/60")}
    >
      <Avatar name={c.counterpart.name} tone="info" online={c.counterpart.online} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold text-ink">{c.counterpart.name}</span>
          {last && <span className="shrink-0 text-[11px] text-ink-3">{time(last.createdAt)}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", c.unreadCount ? "font-semibold text-ink" : "text-ink-3")}>
            {last ? `${last.senderRole === "restaurant" ? "You: " : ""}${last.body}` : c.counterpart.subtitle || "No messages yet"}
          </span>
          {c.unreadCount > 0 && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{c.unreadCount}</span>
          )}
        </span>
      </span>
    </button>
  );
}

function ThreadView({ c, onBack }: { c: Conversation; onBack: () => void }) {
  const { thread, loadOlder, send, retry } = useChat();
  const t = thread(c.id);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  // Stay pinned to the newest message unless the user scrolled up to read.
  const count = t.messages.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && t.hasOlder && !t.loading) {
      const before = el.scrollHeight;
      loadOlder(c.id).then(() => requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - before + el.scrollTop;
      }));
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !c.canMessage) return;
    atBottom.current = true;
    send(c.id, text);
    setText("");
  };

  // The last message of mine the driver has read.
  const readUpTo = c.otherLastReadAt;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <button onClick={onBack} className="rounded-xl p-2 text-ink-3 hover:bg-surface-alt md:hidden" aria-label="Back to chats">
          <ArrowLeft className="size-5" />
        </button>
        <Avatar name={c.counterpart.name} tone="info" online={c.counterpart.online} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{c.counterpart.name}</p>
          <p className={cn("truncate text-xs", c.counterpart.online ? "text-success" : "text-ink-3")}>
            {presenceLabel(c.counterpart)}
            {c.activeOrders.length ? ` · ${c.activeOrders.join(", ")}` : ""}
          </p>
        </div>
        {c.counterpart.phone && (
          <a href={`tel:${c.counterpart.phone}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink-2 ring-1 ring-line-strong transition hover:bg-surface-alt">
            <Phone className="size-4" /> <span className="hidden sm:inline">{c.counterpart.phone}</span>
          </a>
        )}
      </div>

      <div ref={scroller} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface-alt/40 px-5 py-4">
        {t.loading && (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-ink-3" />
          </div>
        )}
        {!t.loading && t.messages.length === 0 && <p className="py-10 text-center text-sm text-ink-3">Say hello to {c.counterpart.name.split(" ")[0]}.</p>}
        {t.messages.map((m, i) => {
          const prev = t.messages[i - 1];
          const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
          return (
            <div key={m.id}>
              {newDay && (
                <p className="py-3 text-center text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{dayLabel(m.createdAt)}</p>
              )}
              <Bubble m={m} read={!!readUpTo && m.createdAt <= readUpTo} onRetry={() => retry(c.id, m)} />
            </div>
          );
        })}
      </div>

      {c.canMessage ? (
        <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={1}
            maxLength={2000}
            placeholder="Write a message"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl bg-surface-alt px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-ink/10"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand text-white transition hover:bg-brand-pressed disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="size-4" />
          </button>
        </form>
      ) : (
        <p className="flex items-center justify-center gap-2 border-t border-line p-4 text-sm text-ink-3">
          <Lock className="size-4" /> This chat closed when the order finished.
        </p>
      )}
    </>
  );
}

function Bubble({ m, read, onRetry }: { m: ChatMessage; read: boolean; onRetry: () => void }) {
  const mine = m.senderRole === "restaurant";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3.5 py-2 text-[15px] break-words whitespace-pre-wrap",
          mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-surface text-ink shadow-sm"
        )}
      >
        {m.body}
        <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", mine ? "text-white/70" : "text-ink-3")}>
          {time(m.createdAt)}
          {mine &&
            (m.pending === "sending" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : m.pending === "failed" ? null : read ? (
              <CheckCheck className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            ))}
        </span>
        {m.pending === "failed" && (
          <button onClick={onRetry} className="mt-1 flex items-center gap-1 text-xs font-bold text-white underline">
            <RotateCw className="size-3" /> Not sent. Retry
          </button>
        )}
      </div>
    </motion.div>
  );
}
