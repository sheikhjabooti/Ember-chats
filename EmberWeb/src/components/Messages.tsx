import { FormEvent, Fragment, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dayLabel, shortTime } from "../format";
import type { Message } from "../types";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface MessageActions {
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  /** "Reply in a breakout". Only offered in group chats. */
  onBreakout?: (m: Message) => void;
}

const isDeleted = (m: Message) => m.deletionState === "deletedForEveryone";
const isSystem = (m: Message) => m.kind === "system";

// http(s) links and bare www. links, without trailing punctuation.
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,:;!?)\]'}]/gi;

/** Plain text with links made clickable. Everything else stays text, so nothing can inject HTML. */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const url = match[0];
    const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
    parts.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function MessageList({
  messages,
  meId,
  nameOf,
  volatile = false,
  showSenders,
  header,
  actions,
  seenLabel,
  unreadAfter,
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
  /** Where you'd read up to when you opened the chat. Draws a "New messages" line after it. */
  unreadAfter?: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const placedInitialScroll = useRef(false);
  const lastId = messages.at(-1)?.id;
  const lastMine = [...messages].reverse().find((m) => m.senderId === meId && !isSystem(m));

  // The first message from someone else that arrived after you last read.
  const firstUnreadId =
    unreadAfter === undefined
      ? undefined
      : messages.find((m) => m.senderId !== meId && !isSystem(m) && (unreadAfter === null || m.sentAt > unreadAfter))?.id;

  // On first load, start at the "New messages" line if there is one, else at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || placedInitialScroll.current || messages.length === 0) return;
    placedInitialScroll.current = true;
    const divider = firstUnreadId ? el.querySelector<HTMLElement>(".unread-divider") : null;
    if (divider) {
      el.scrollTop = Math.max(0, divider.offsetTop - el.clientHeight / 3);
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      stickToBottom.current = bottom;
      setAtBottom(bottom);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Afterwards, follow new messages only if the reader is already at the bottom.
  // Otherwise count them on the jump-to-bottom button.
  const prevLastId = useRef(lastId);
  useLayoutEffect(() => {
    const el = scroller.current;
    const arrived = prevLastId.current !== undefined && lastId !== prevLastId.current;
    prevLastId.current = lastId;
    if (!el || !placedInitialScroll.current) return;
    const latest = messages.at(-1);
    if (stickToBottom.current || latest?.senderId === meId) {
      el.scrollTop = el.scrollHeight;
      stickToBottom.current = true;
    } else if (arrived) {
      setNewBelow((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, seenLabel]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.(".msg-menu, .msg-more")) setMenuFor(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuFor]);

  function jumpToBottom() {
    const el = scroller.current;
    if (!el) return;
    // Instant on purpose: a smooth scroll over a long history is slow, and
    // stalls entirely in a background tab.
    el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setAtBottom(true);
    setNewBelow(0);
  }

  function jumpTo(messageId: string) {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(messageId);
    window.setTimeout(() => setFlash((f) => (f === messageId ? null : f)), 1600);
  }

  return (
    <div className="messages-wrap">
      <div
        ref={scroller}
        className={`messages ${volatile ? "volatile" : ""}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          stickToBottom.current = bottom;
          setAtBottom(bottom);
          if (bottom) setNewBelow(0);
        }}
      >
        {header}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
          const dividers = (
            <>
              {newDay && (
                <div className="day-divider" role="separator">
                  <span>{dayLabel(m.sentAt)}</span>
                </div>
              )}
              {m.id === firstUnreadId && (
                <div className="unread-divider" role="separator">
                  <span>New messages</span>
                </div>
              )}
            </>
          );

          if (isSystem(m)) {
            return (
              <Fragment key={m.id}>
                {dividers}
                <div className="system-msg" role="note" data-message-id={m.id}>
                  {m.text} <span className="msg-time">{shortTime(m.sentAt)}</span>
                </div>
              </Fragment>
            );
          }

          const mine = m.senderId === meId;
          const firstOfRun = newDay || !prev || prev.senderId !== m.senderId || isSystem(prev) || m.id === firstUnreadId;
          const nextNewDay = next && new Date(next.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
          const lastOfRun = !next || nextNewDay || next.senderId !== m.senderId || isSystem(next) || next.id === firstUnreadId;
          const deleted = isDeleted(m);
          const reactions = Object.entries(m.reactions ?? {}).filter(([, users]) => users.length > 0);
          const canAct = actions && !deleted;

          return (
            <Fragment key={m.id}>
              {dividers}
              <div
                data-message-id={m.id}
                className={`msg ${mine ? "mine" : "theirs"} ${firstOfRun ? "first" : ""} ${flash === m.id ? "flash" : ""}`}
              >
                {showSenders && !mine && firstOfRun && <span className="msg-sender">{nameOf(m.senderId)}</span>}
                <div className="msg-row">
                  <div className={`bubble ${deleted ? "deleted" : ""}`} title={new Date(m.sentAt).toLocaleString()}>
                    {m.replyTo && (
                      <button
                        type="button"
                        className="quote"
                        onClick={() => jumpTo(m.replyTo!.id)}
                        title="Show the original message"
                      >
                        <strong>{nameOf(m.replyTo.senderId)}</strong>
                        <span>{m.replyTo.deleted ? "Message deleted" : m.replyTo.text}</span>
                      </button>
                    )}
                    {deleted ? "This message was deleted" : <Linkified text={m.text ?? ""} />}
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
                      {actions.onBreakout && (
                        <button role="menuitem" onClick={() => (actions.onBreakout!(m), setMenuFor(null))}>
                          Reply in a breakout
                        </button>
                      )}
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
            </Fragment>
          );
        })}
      </div>
      {!atBottom && (
        <button className={`jump-bottom ${newBelow > 0 ? "has-new" : ""}`} onClick={jumpToBottom} aria-label="Jump to latest messages">
          {newBelow > 0 ? `${newBelow} new ↓` : "↓"}
        </button>
      )}
    </div>
  );
}

// --- drafts -------------------------------------------------------------------

const DRAFT_PREFIX = "ember.draft.";

function loadDraft(key?: string): string {
  if (!key) return "";
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(key: string | undefined, text: string) {
  if (!key) return;
  try {
    if (text.trim()) localStorage.setItem(DRAFT_PREFIX + key, text);
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage blocked: drafts just won't survive switching chats.
  }
}

/** The unsent draft for a chat, if any. Used for the sidebar preview. */
export function draftFor(key: string): string {
  return loadDraft(key).trim();
}

export function Composer({
  placeholder,
  disabled,
  banner,
  initialText,
  draftKey,
  submitLabel = "Send",
  onSend,
  onTyping,
  onCancel,
}: {
  placeholder: string;
  disabled?: boolean;
  /** Shown above the box, e.g. "Replying to Bob" or "Editing message". */
  banner?: ReactNode;
  /** Starting text (used for editing). Wins over a saved draft. */
  initialText?: string;
  /** Saves unsent text under this key so switching chats doesn't lose it. */
  draftKey?: string;
  submitLabel?: string;
  onSend: (text: string) => Promise<void> | void;
  onTyping?: (isTyping: boolean) => void;
  /** Escape key and the banner's close button. */
  onCancel?: () => void;
}) {
  const [text, setText] = useState(() => initialText ?? loadDraft(draftKey));
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
    saveDraft(draftKey, "");
    noteTyping("");
    setError(null);
    try {
      await onSend(trimmed);
    } catch (err) {
      setText(trimmed);
      saveDraft(draftKey, trimmed);
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
          saveDraft(draftKey, e.target.value);
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
