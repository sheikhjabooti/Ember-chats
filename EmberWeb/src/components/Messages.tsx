import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortTime } from "../format";
import type { Message } from "../types";

export function MessageList({
  messages,
  meId,
  nameOf,
  volatile = false,
  showSenders,
  header,
}: {
  messages: Message[];
  meId: string;
  nameOf: (id: string) => string;
  volatile?: boolean;
  showSenders: boolean;
  header?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastId = messages.at(-1)?.id;

  // Follow new messages only if the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

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
        const mine = m.senderId === meId;
        const prev = messages[i - 1];
        const firstOfRun = !prev || prev.senderId !== m.senderId;
        return (
          <div key={m.id} className={`msg ${mine ? "mine" : "theirs"} ${firstOfRun ? "first" : ""}`}>
            {showSenders && !mine && firstOfRun && <span className="msg-sender">{nameOf(m.senderId)}</span>}
            <div className="bubble" title={new Date(m.sentAt).toLocaleString()}>
              {m.text}
            </div>
            {(!messages[i + 1] || messages[i + 1].senderId !== m.senderId) && (
              <span className="msg-time">{shortTime(m.sentAt)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Composer({
  placeholder,
  disabled,
  onSend,
  onTyping,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<void> | void;
  onTyping?: (isTyping: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const isTyping = useRef(false);

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);

  function noteTyping(value: string) {
    if (!onTyping) return;
    if (value && !isTyping.current) {
      isTyping.current = true;
      onTyping(true);
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      if (isTyping.current) {
        isTyping.current = false;
        onTyping(false);
      }
    }, value ? 3000 : 0);
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
  }

  return (
    <form className="composer" onSubmit={submit}>
      {error && (
        <p className="error composer-error" role="alert">
          {error}
        </p>
      )}
      <textarea
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
      <button type="submit" className="primary send" disabled={disabled || !text.trim()} aria-label="Send">
        ↑
      </button>
    </form>
  );
}
