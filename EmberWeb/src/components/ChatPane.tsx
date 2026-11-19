import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { People, useEnsurePeople } from "../people";
import type { EmberSocket } from "../socket";
import type { Breakout, Chat, Me, Message } from "../types";
import { GroupInfoDialog } from "./GroupInfoDialog";
import { Composer, MessageList } from "./Messages";
import { StartBreakoutDialog } from "./StartBreakoutDialog";

const PAGE = 30;

export function ChatPane(props: {
  chat: Chat;
  me: Me;
  socket: EmberSocket;
  people: People;
  title: string;
  /** For kept breakouts: the chat it came from. */
  parentTitle?: string;
  activeBreakouts: Breakout[];
  invites: Set<string>;
  onRefreshBreakouts: () => void;
  onOpenBreakout: (b: Breakout) => void;
  onOpenChat: (chatId: string) => void;
  onBack: () => void;
  onSent: (m: Message) => void;
  onRead: (chatId: string) => void;
  onChatChanged: (chat: Chat) => void;
  onLeft: (chatId: string) => void;
}) {
  const { chat, me, socket, people } = props;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [picking, setPicking] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  /** The message a new breakout will quote ("Reply in a breakout"). */
  const [breakoutFrom, setBreakoutFrom] = useState<Message | null>(null);
  // Where you'd read up to when you opened this chat, for the "New messages" line.
  // Captured once: reading the chat moves the real value forward straight away.
  const [unreadAfter] = useState<string | null>(() => chat.readState?.[me.id] ?? null);

  const isGroup = chat.kind === "group";
  const isKeptBreakout = chat.kind === "breakout";
  useEnsurePeople(people, [...chat.participantIds, ...messages.map((m) => m.senderId)]);

  // --- reading -------------------------------------------------------------

  const readTimer = useRef<number | undefined>(undefined);
  const markRead = useCallback(() => {
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      api
        .markRead(chat.id)
        .then(() => props.onRead(chat.id))
        .catch(() => {});
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(readTimer.current);
    };
  }, [markRead]);

  // --- loading -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReplyTo(null);
    setEditing(null);
    api
      .messages(chat.id, undefined, PAGE)
      .then((page) => {
        if (cancelled) return;
        setMessages(page);
        setHasOlder(page.length === PAGE);
        markRead();
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    if (isGroup) props.onRefreshBreakouts();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // --- live updates --------------------------------------------------------

  useEffect(
    () =>
      socket.on((frame) => {
        if (frame.type === "message" && frame.chatId === chat.id) {
          setMessages((prev) => (prev.some((m) => m.id === frame.message.id) ? prev : [...prev, frame.message]));
          setTyping((prev) => {
            const next = { ...prev };
            delete next[frame.message.senderId];
            return next;
          });
          if (frame.message.senderId !== me.id) markRead();
        }
        if (frame.type === "message:updated" && frame.chatId === chat.id) {
          const updated = frame.message;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === updated.id) return updated;
              // Keep reply quotes in step with the message they quote.
              if (m.replyTo?.id === updated.id) {
                return { ...m, replyTo: { ...m.replyTo, text: updated.text ?? null, deleted: updated.deletionState === "deletedForEveryone" } };
              }
              return m;
            })
          );
        }
        if (frame.type === "typing" && frame.chatId === chat.id) {
          setTyping((prev) => {
            const next = { ...prev };
            if (frame.isTyping) next[frame.userId] = Date.now();
            else delete next[frame.userId];
            return next;
          });
        }
      }),
    [socket, chat.id, me.id, markRead]
  );

  // Drop typing indicators that were never switched off (closed tab etc.).
  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((prev) => {
        const cutoff = Date.now() - 6000;
        const stale = Object.entries(prev).filter(([, at]) => at < cutoff);
        if (stale.length === 0) return prev;
        const next = { ...prev };
        for (const [id] of stale) delete next[id];
        return next;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const page = await api.messages(chat.id, oldest.sentAt, PAGE);
    setMessages((prev) => [...page, ...prev]);
    setHasOlder(page.length === PAGE);
  }, [chat.id, messages]);

  // --- actions -------------------------------------------------------------

  const replace = (updated: Message) => setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));

  async function send(text: string) {
    if (editing) {
      replace(await api.editMessage(chat.id, editing.id, text));
      setEditing(null);
      return;
    }
    const sent = await api.sendMessage(chat.id, text, replyTo?.id);
    setReplyTo(null);
    setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    props.onSent(sent);
  }

  const actions = {
    onReply: (m: Message) => {
      setEditing(null);
      setReplyTo(m);
    },
    onEdit: (m: Message) => {
      setReplyTo(null);
      setEditing(m);
    },
    onDelete: async (m: Message) => {
      if (!window.confirm("Delete this message for everyone? This can't be undone.")) return;
      try {
        replace(await api.deleteMessage(chat.id, m.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      }
    },
    onBreakout: isGroup
      ? (m: Message) => {
          setBreakoutFrom(m);
          setPicking(true);
        }
      : undefined,
    onReact: async (m: Message, emoji: string) => {
      try {
        replace(await api.react(chat.id, m.id, emoji));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not react");
      }
    },
  };

  // --- derived -------------------------------------------------------------

  const typingNames = Object.keys(typing)
    .filter((id) => id !== me.id)
    .map(people.nameOf);
  const others = chat.participantIds.filter((id) => id !== me.id);

  /** "Seen" for a DM, "Seen by Bob, Carol" in a group, under your latest message. */
  const seenLabel = useMemo(() => {
    const lastMine = [...messages].reverse().find((m) => m.senderId === me.id && m.kind !== "system");
    if (!lastMine) return null;
    const seers = others.filter((id) => {
      const at = chat.readState?.[id];
      return at && at >= lastMine.sentAt;
    });
    if (seers.length === 0) return null;
    if (!isGroup && !isKeptBreakout) return "Seen";
    if (seers.length === others.length) return "Seen by everyone";
    return `Seen by ${seers.map(people.nameOf).join(", ")}`;
  }, [messages, chat.readState, others, me.id, isGroup, isKeptBreakout, people.nameOf]);

  const composerBanner = editing ? (
    <>
      <strong>Editing</strong> <span className="muted">{editing.text}</span>
    </>
  ) : replyTo ? (
    <>
      <strong>Replying to {replyTo.senderId === me.id ? "yourself" : people.nameOf(replyTo.senderId)}</strong>{" "}
      <span className="muted">{replyTo.text}</span>
    </>
  ) : null;

  const subtitle = isKeptBreakout
    ? `Kept breakout${props.parentTitle ? ` from ${props.parentTitle}` : ""}`
    : isGroup
      ? `${chat.participantIds.length} people`
      : "Direct message";

  return (
    <div className="chat">
      <header className="pane-head">
        <button className="ghost back" onClick={props.onBack} aria-label="Back to chats">
          ‹
        </button>
        <div className="pane-title">
          <h2>{props.title}</h2>
          <span className="muted small">{subtitle}</span>
        </div>
        {isKeptBreakout && chat.parentChatId && props.parentTitle && (
          <button className="ghost" onClick={() => props.onOpenChat(chat.parentChatId!)}>
            Open {props.parentTitle}
          </button>
        )}
        {isGroup && (
          <>
            <button className="ghost" onClick={() => setShowInfo(true)}>
              Group info
            </button>
            {others.length > 0 && (
              <button
                className="volatile-btn"
                onClick={() => {
                  setBreakoutFrom(null);
                  setPicking(true);
                }}
              >
                Start breakout
              </button>
            )}
          </>
        )}
      </header>

      {isGroup && props.activeBreakouts.length > 0 && (
        <div className="breakout-strip" aria-label="Live breakouts you're in">
          {props.activeBreakouts.map((b) => {
            const invited = props.invites.has(b.id);
            return (
              <button key={b.id} className={`breakout-pill live ${invited ? "invited" : ""}`} onClick={() => props.onOpenBreakout(b)}>
                <span className="live-dot" aria-hidden />
                {b.createdByUserId === me.id ? "Your breakout" : `${people.nameOf(b.createdByUserId)}'s breakout`}
                <span className="muted small">
                  {" "}
                  with {b.participantIds.filter((id) => id !== me.id).map(people.nameOf).join(", ")}
                </span>
                <strong>{invited ? "Join" : "Open"}</strong>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="error pad" role="alert">
          {error}{" "}
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {loading ? (
        <div className="messages">
          <p className="muted pad">Loading messages…</p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          meId={me.id}
          nameOf={people.nameOf}
          showSenders={chat.participantIds.length > 2}
          actions={actions}
          seenLabel={seenLabel}
          unreadAfter={unreadAfter}
          header={
            <>
              {hasOlder && (
                <button className="ghost load-older" onClick={loadOlder}>
                  Load earlier messages
                </button>
              )}
              {messages.length === 0 && <p className="muted center pad">No messages yet. Say hi.</p>}
            </>
          }
        />
      )}

      <div className="typing" aria-live="polite">
        {typingNames.length > 0 && `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`}
      </div>

      <Composer
        key={editing?.id ?? "new"}
        placeholder="Message"
        initialText={editing ? editing.text ?? "" : undefined}
        draftKey={editing ? undefined : chat.id}
        submitLabel={editing ? "Save" : "Send"}
        banner={composerBanner}
        onCancel={editing || replyTo ? () => (setEditing(null), setReplyTo(null)) : undefined}
        onSend={send}
        onTyping={(isTyping) => {
          if (!editing) api.typing(chat.id, isTyping).catch(() => {});
        }}
      />

      {picking && (
        <StartBreakoutDialog
          candidates={others}
          nameOf={people.nameOf}
          quote={breakoutFrom ? { senderName: people.nameOf(breakoutFrom.senderId), text: breakoutFrom.text ?? "" } : undefined}
          preselected={breakoutFrom && breakoutFrom.senderId !== me.id ? [breakoutFrom.senderId] : []}
          onClose={() => {
            setPicking(false);
            setBreakoutFrom(null);
          }}
          onStart={async (ids) => {
            const b = await api.startBreakout(chat.id, ids, breakoutFrom?.id);
            setPicking(false);
            setBreakoutFrom(null);
            props.onRefreshBreakouts();
            props.onOpenBreakout(b);
          }}
        />
      )}

      {showInfo && (
        <GroupInfoDialog
          chat={chat}
          me={me}
          people={people}
          onClose={() => setShowInfo(false)}
          onChanged={props.onChatChanged}
          onLeft={() => {
            setShowInfo(false);
            props.onLeft(chat.id);
          }}
        />
      )}
    </div>
  );
}
