import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { shortTime } from "../format";
import { People, useEnsurePeople } from "../people";
import type { EmberSocket } from "../socket";
import type { Breakout, BreakoutsForChat, Chat, Me, Message } from "../types";
import { Composer, MessageList } from "./Messages";
import { StartBreakoutDialog } from "./StartBreakoutDialog";

const PAGE = 30;

export function ChatPane(props: {
  chat: Chat;
  me: Me;
  socket: EmberSocket;
  people: People;
  title: string;
  breakouts: BreakoutsForChat;
  invites: Set<string>;
  onRefreshBreakouts: () => void;
  onOpenBreakout: (b: Breakout) => void;
  onOpenChat: (chatId: string) => void;
  onBack: () => void;
  onSent: (m: Message) => void;
}) {
  const { chat, me, socket, people } = props;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [picking, setPicking] = useState(false);

  const isKeptBreakout = chat.kind === "breakout";
  useEnsurePeople(people, [...chat.participantIds, ...messages.map((m) => m.senderId)]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .messages(chat.id, undefined, PAGE)
      .then((page) => {
        if (cancelled) return;
        setMessages(page);
        setHasOlder(page.length === PAGE);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    if (!isKeptBreakout) props.onRefreshBreakouts();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Live messages and typing for this chat.
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
    [socket, chat.id]
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

  async function send(text: string) {
    const sent = await api.sendMessage(chat.id, text);
    setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    props.onSent(sent);
  }

  const typingNames = Object.keys(typing)
    .filter((id) => id !== me.id)
    .map(people.nameOf);
  const others = chat.participantIds.filter((id) => id !== me.id);
  const { active, kept } = props.breakouts;

  return (
    <div className="chat">
      <header className="pane-head">
        <button className="ghost back" onClick={props.onBack} aria-label="Back to chats">
          ‹
        </button>
        <div className="pane-title">
          <h2>{props.title}</h2>
          <span className="muted small">
            {isKeptBreakout ? "Kept breakout" : `${chat.participantIds.length} people`}
          </span>
        </div>
        {isKeptBreakout && chat.parentChatId && (
          <button className="ghost" onClick={() => props.onOpenChat(chat.parentChatId!)}>
            Back to main chat
          </button>
        )}
        {!isKeptBreakout && others.length > 0 && (
          <button className="volatile-btn" onClick={() => setPicking(true)}>
            🔥 Start breakout
          </button>
        )}
      </header>

      {!isKeptBreakout && (active.length > 0 || kept.length > 0) && (
        <div className="breakout-strip" aria-label="Breakouts in this chat">
          {active.map((b) => {
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
          {kept.map((k) => (
            <button key={k.id} className="breakout-pill kept" onClick={() => props.onOpenChat(k.id)}>
              📌 Kept breakout with {k.participantIds.filter((id) => id !== me.id).map(people.nameOf).join(", ")}
              <span className="muted small"> {shortTime(k.lastMessageAt ?? k.createdAt)}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="error pad">{error}</p>}
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
        placeholder="Message"
        onSend={send}
        onTyping={(isTyping) => {
          api.typing(chat.id, isTyping).catch(() => {});
        }}
      />

      {picking && (
        <StartBreakoutDialog
          candidates={others}
          nameOf={people.nameOf}
          onClose={() => setPicking(false)}
          onStart={async (ids) => {
            const b = await api.startBreakout(chat.id, ids);
            setPicking(false);
            props.onRefreshBreakouts();
            props.onOpenBreakout(b);
          }}
        />
      )}
    </div>
  );
}
