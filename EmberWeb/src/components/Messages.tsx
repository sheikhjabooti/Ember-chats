import { FormEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortTime } from "../format";
import type { Message } from "../types";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface MessageActions {
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
}

const isDeleted = (m: Message) => m.deletionState === "deletedForEveryone";
const isSystem = (m: Message) => m.kind === "system";

export function MessageList({
  messages,
  meId,
  nameOf,
  volatile = false,
  showSenders,
  header,
  actions,
  seenLabel,
}: {
  messages: Message[];
  meId: string;
  nameOf: (id: string) => string;
  volatile?: boolean;
  showSenders: boolean;
  header?: ReactNode;
  /** Omit for breakouts, where messages can't be edited or reacted to. */
  actions?: MessageActions;
  /** Shown under your most recent message, e.g. "Seen by Bob". */
  seenLabel?: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const lastId = messages.at(-1)?.id;
  const lastMine = [...messages].reverse().find((m) => m.senderId === meId && !isSystem(m));

  // Follow new messages only if the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, seenLabel]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.(".msg-menu, .msg-more")) setMenuFor(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuFor]);

  return (
    <div
      ref={scroller}
      className={`messages ${volatile ? "volatile" : ""}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {header}
      {messages.map((m, i) => {
        if (isSystem(m)) {
          return (
            <div key={m.id} className="system-msg" role="note">
              {m.text} <span className="msg-time">{shortTime(m.sentAt)}</span>
            </div>
          );
        }
        const mine = m.senderId === meId;
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const firstOfRun = !prev || prev.senderId !== m.senderId || isSystem(prev);
        const lastOfRun = !next || next.senderId !== m.senderId || isSystem(next);
        const deleted = isDeleted(m);
        const reactions = Object.entries(m.reactions ?? {}).filter(([, users]) => users.length > 0);
        const canAct = actions && !deleted;

        return (
          <div key={m.id} className={`msg ${mine ? "mine" : "theirs"} ${firstOfRun ? "first" : ""}`}>
            {showSenders && !mine && firstOfRun && <span className="msg-sender">{nameOf(m.senderId)}</span>}
            <div className="msg-row">
              <div className={`bubble ${deleted ? "deleted" : ""}`} title={new Date(m.sentAt).toLocaleString()}>
                {m.replyTo && (
                  <div className="quote">
                    <strong>{nameOf(m.replyTo.senderId)}</strong>
                    <span>{m.replyTo.deleted ? "Message deleted" : m.replyTo.text}</span>
                  </div>
                )}
                {deleted ? "This message was deleted" : m.text}
                {m.editedAt && !deleted && <span className="edited"> (edited)</span>}
              </div>
              {canAct && (
                <button
                  className="msg-more"
                  aria-label="Message actions"
                  aria-expanded={menuFor === m.id}
                  onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                >
                  ⋯
                </button>
              )}
              {canAct && menuFor === m.id && (
                <div className="msg-menu" role="menu">
                  <div className="react-row">
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        role="menuitem"
                        aria-label={`React ${emoji}`}
                        onClick={() => {
                          actions.onReact(m, emoji);
                          setMenuFor(null);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <button role="menuitem" onClick={() => (actions.onReply(m), setMenuFor(null))}>
                    Reply
                  </button>
                  {mine && (
                    <button role="menuitem" onClick={() => (actions.onEdit(m), setMenuFor(null))}>
                      Edit
                    </button>
                  )}
                  {mine && (
                    <button role="menuitem" className="danger" onClick={() => (actions.onDelete(m), setMenuFor(null))}>
                      Delete for everyone
                    </button>
                  )}
                </div>
              )}
            </div>
            {reactions.length > 0 && (
              <div className="reactions">
                {reactions.map(([emoji, users]) => (
                  <button
                    key={emoji}
                    className={`reaction ${users.includes(meId) ? "on" : ""}`}
                    title={users.map(nameOf).join(", ")}
                    aria-label={`${emoji} ${users.length}, ${users.includes(meId) ? "remove yours" : "add yours"}`}
                    disabled={!actions}
                    onClick={() => actions?.onReact(m, emoji)}
                  >
                    {emoji} {users.length}
                  </button>
                ))}
              </div>
            )}
            {lastOfRun && <span className="msg-time">{shortTime(m.sentAt)}</span>}
            {seenLabel && lastMine?.id === m.id && <span className="seen">{seenLabel}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Composer({
  placeholder,
  disabled,
  banner,
  initialText = "",
  submitLabel = "Send",
  onSend,
  onTyping,
  onCancel,
}: {
  placeholder: string;
  disabled?: boolean;
  /** Shown above the box, e.g. "Replying to Bob" or "Editing message". */
  banner?: ReactNode;
  initialText?: string;
  submitLabel?: string;
  onSend: (text: string) => Promise<void> | void;
  onTyping?: (isTyping: boolean) => void;
  /** Escape key and the banner's close button. */
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const isTyping = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);
  useEffect(() => {
    if (banner) input.current?.focus();
  }, [banner]);

  function noteTyping(value: string) {
    if (!onTyping) return;
    if (value && !isTyping.current) {
      isTyping.current = true;
      onTyping(true);
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () => {
        if (isTyping.current) {
          isTyping.current = false;
          onTyping(false);
        }
      },
      value ? 3000 : 0
    );
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    noteTyping("");
    setError(null);
    try {
      await onSend(trimmed);
    } catch (err) {
      setText(trimmed);
      setError(err instanceof Error ? err.message : "Not sent");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && onCancel) onCancel();
  }

  return (
    <form className="composer" onSubmit={submit}>
      {error && (
        <p className="error composer-error" role="alert">
          {error}
        </p>
      )}
      {banner && (
        <div className="composer-banner">
          <div className="composer-banner-text">{banner}</div>
          {onCancel && (
            <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
              ✕
            </button>
          )}
        </div>
      )}
      <textarea
        ref={input}
        rows={1}
        placeholder={placeholder}
        value={text}
        maxLength={4000}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          noteTyping(e.target.value);
        }}
        onKeyDown={onKeyDown}
        aria-label="Message"
      />
      <button type="submit" className="primary send" disabled={disabled || !text.trim()} aria-label={submitLabel}>
        {submitLabel === "Save" ? "✓" : "↑"}
      </button>
    </form>
  );
}
