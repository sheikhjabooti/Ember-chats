import { useEffect, useState } from "react";
import { api } from "../api";
import { People, useEnsurePeople } from "../people";
import type { EmberSocket } from "../socket";
import type { Breakout, Me, Message, WarningReason } from "../types";
import { Composer, MessageList } from "./Messages";

type Phase = "joining" | "live" | "kept" | "cleared" | "unavailable";

const REASON_TEXT: Record<WarningReason, string> = {
  inactivity: "No one has said anything in a while.",
  empty: "Everyone has left this breakout.",
  ended: "Someone ended this breakout.",
};

/**
 * A live breakout. Everything here is driven by the server: the
 * snapshot on join, messages, the clearance countdown, and whether it
 * was kept or cleared. The page keeps nothing once you leave.
 */
export function BreakoutPane(props: {
  breakoutId: string;
  initial?: Breakout;
  parentTitle: string;
  me: Me;
  socket: EmberSocket;
  people: People;
  onBack: () => void;
  onOpenKept: (chatId: string) => void;
}) {
  const { breakoutId, socket, people, me } = props;
  const [breakout, setBreakout] = useState<Breakout | undefined>(props.initial);
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("joining");
  const [warning, setWarning] = useState<{ seconds: number; reason: WarningReason } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEnsurePeople(people, breakout?.participantIds ?? []);

  useEffect(() => {
    const off = socket.on((frame) => {
      if (!("chatId" in frame) || frame.chatId !== breakoutId) return;
      switch (frame.type) {
        case "breakout:snapshot":
          setBreakout(frame.breakout);
          setMessages(frame.messages); // replaces, so a reconnect never duplicates
          setPhase((p) => (p === "joining" ? "live" : p));
          break;
        case "message":
          setMessages((prev) => (prev.some((m) => m.id === frame.message.id) ? prev : [...prev, frame.message]));
          break;
        case "expiryWarning":
          setWarning({ seconds: frame.secondsRemaining, reason: frame.reason });
          break;
        case "warningCancelled":
          setWarning(null);
          break;
        case "promoted":
        case "breakout:promoted":
          setWarning(null);
          setPhase("kept");
          break;
        case "purged":
        case "breakout:cleared":
          setWarning(null);
          setPhase((p) => (p === "kept" ? p : "cleared"));
          break;
        case "error":
          setPhase((p) => (p === "joining" ? "unavailable" : p));
          break;
      }
    });
    socket.subscribeBreakout(breakoutId);
    return () => {
      off();
      socket.unsubscribeBreakout(breakoutId);
    };
  }, [socket, breakoutId]);

  async function keep() {
    setBusy(true);
    setActionError(null);
    try {
      await api.keepBreakout(breakoutId);
      setPhase("kept");
      setWarning(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not keep this chat");
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setActionError(null);
    try {
      await api.endBreakout(breakoutId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not end this breakout");
    }
  }

  async function send(text: string) {
    if (!socket.sendBreakoutMessage(breakoutId, text)) {
      throw new Error("You're offline. The message wasn't sent.");
    }
  }

  const others = (breakout?.participantIds ?? []).filter((id) => id !== me.id).map(people.nameOf);
  const live = phase === "live";

  return (
    <div className="chat breakout">
      <header className="pane-head">
        <button className="ghost back" onClick={props.onBack} aria-label={`Back to ${props.parentTitle}`}>
          ‹
        </button>
        <div className="pane-title">
          <h2>Breakout{others.length > 0 ? ` with ${others.join(", ")}` : ""}</h2>
          <span className="muted small">From {props.parentTitle}</span>
        </div>
        {(live || phase === "joining") && (
          <span className={`volatile-pill ${warning ? "warn" : ""}`}>
            <span className="live-dot" aria-hidden />
            {warning ? `Clears in ${warning.seconds}s` : "Volatile"}
          </span>
        )}
        {live && (
          <>
            <button className="ghost" onClick={end}>
              End breakout
            </button>
            <button className="volatile-btn solid" onClick={keep} disabled={busy}>
              Keep chat
            </button>
          </>
        )}
      </header>

      {live && !warning && (
        <div className="volatile-banner">
          Not saved anywhere. This clears itself once everyone has left, unless someone taps Keep.
        </div>
      )}

      {live && warning && (
        <div className="clearance" role="alert">
          <div>
            <strong>{REASON_TEXT[warning.reason]}</strong>
            <span>
              {" "}
              It will be cleared in <span className="count">{warning.seconds}</span> seconds.
              {warning.reason === "inactivity" && " Sending a message keeps it going."}
            </span>
          </div>
          <button className="volatile-btn solid" onClick={keep} disabled={busy}>
            Keep chat
          </button>
        </div>
      )}

      {actionError && <p className="error pad">{actionError}</p>}

      {phase === "joining" && (
        <div className="messages volatile">
          <p className="muted pad">Joining…</p>
        </div>
      )}

      {live && (
        <MessageList
          messages={messages}
          meId={me.id}
          nameOf={people.nameOf}
          volatile
          showSenders={(breakout?.participantIds.length ?? 0) > 2}
          header={messages.length === 0 && <p className="muted center pad">Nothing said yet. Only the people here can see this.</p>}
        />
      )}

      {phase === "kept" && (
        <div className="outcome">
          <div className="outcome-mark" aria-hidden>
            📌
          </div>
          <h3>Kept</h3>
          <p className="muted">This breakout is now a permanent chat, listed under {props.parentTitle}.</p>
          <button className="primary" onClick={() => props.onOpenKept(breakoutId)}>
            Open saved chat
          </button>
        </div>
      )}

      {(phase === "cleared" || phase === "unavailable") && (
        <div className="outcome">
          <div className="outcome-mark" aria-hidden>
            🔥
          </div>
          <h3>{phase === "cleared" ? "Cleared" : "Already gone"}</h3>
          <p className="muted">
            {phase === "cleared"
              ? "This breakout is gone. Nothing from it was saved."
              : "This breakout was cleared before you got here, or you weren't part of it."}
          </p>
          <button className="ghost" onClick={props.onBack}>
            Back to {props.parentTitle}
          </button>
        </div>
      )}

      {live && <Composer placeholder="Message the breakout" onSend={send} />}
    </div>
  );
}
