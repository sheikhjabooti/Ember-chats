import { useEffect, useState } from "react";
import { api } from "../api";
import { People, useEnsurePeople } from "../people";
import type { EmberSocket } from "../socket";
import type { Breakout, KeepVote, Me, Message, WarningReason } from "../types";
import { Composer, MessageList } from "./Messages";

type Phase = "joining" | "live" | "kept" | "cleared" | "unavailable";

const REASON_TEXT: Record<WarningReason, string> = {
  inactivity: "No one has said anything in a while.",
  empty: "Everyone has left this breakout.",
  ended: "Someone ended this breakout.",
};

/**
 * A live breakout. Everything here is driven by the server: the
 * snapshot on join, messages, typing, the clearance countdown, the keep
 * vote, and whether it was kept or cleared. Nothing is stored here once
 * you leave.
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
  const [vote, setVote] = useState<KeepVote | null>(props.initial?.keepVote ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEnsurePeople(people, breakout?.participantIds ?? []);

  useEffect(() => {
    const off = socket.on((frame) => {
      if (!("chatId" in frame) || frame.chatId !== breakoutId) return;
      switch (frame.type) {
        case "breakout:snapshot":
          setBreakout(frame.breakout);
          setVote(frame.breakout.keepVote ?? null);
          setMessages(frame.messages); // replaces, so a reconnect never duplicates
          setPhase((p) => (p === "joining" ? "live" : p));
          break;
        case "message":
          setMessages((prev) => (prev.some((m) => m.id === frame.message.id) ? prev : [...prev, frame.message]));
          setTyping((prev) => {
            const next = { ...prev };
            delete next[frame.message.senderId];
            return next;
          });
          break;
        case "typing":
          setTyping((prev) => {
            const next = { ...prev };
            if (frame.isTyping) next[frame.userId] = Date.now();
            else delete next[frame.userId];
            return next;
          });
          break;
        case "expiryWarning":
          setWarning({ seconds: frame.secondsRemaining, reason: frame.reason });
          break;
        case "warningCancelled":
          setWarning(null);
          break;
        case "keepRequested":
          setWarning(null);
          setNotice(null);
          setVote({ requestedBy: frame.requestedBy, approvedBy: frame.approvedBy, secondsRemaining: frame.secondsRemaining });
          break;
        case "keepDeclined":
          setVote(null);
          setNotice(
            frame.declinedBy === me.id ? "You declined. This breakout won't be saved." : `${people.nameOf(frame.declinedBy)} declined, so this breakout won't be saved.`
          );
          break;
        case "keepFailed":
          setVote(null);
          setNotice("Saving failed. The breakout is still open, so you can try again.");
          break;
        case "promoted":
        case "breakout:promoted":
          setWarning(null);
          setVote(null);
          setPhase("kept");
          break;
        case "purged":
        case "breakout:cleared":
          setWarning(null);
          setVote(null);
          setPhase((p) => (p === "kept" ? p : "cleared"));
          break;
        case "error":
          if (phase === "joining") setPhase("unavailable");
          else setNotice(frame.message);
          break;
      }
    });
    socket.subscribeBreakout(breakoutId);
    return () => {
      off();
      socket.unsubscribeBreakout(breakoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, breakoutId]);

  // Drop typing indicators that were never switched off.
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

  async function act(fn: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const keep = () => act(() => api.keepBreakout(breakoutId), "Could not keep this chat");
  const respond = (allow: boolean) => act(() => api.respondToKeep(breakoutId, allow), "Could not answer");
  const end = () => act(() => api.endBreakout(breakoutId), "Could not end this breakout");

  async function send(text: string) {
    if (!socket.sendBreakoutMessage(breakoutId, text)) {
      throw new Error("You're offline. The message wasn't sent.");
    }
  }

  const others = (breakout?.participantIds ?? []).filter((id) => id !== me.id);
  const live = phase === "live";
  const typingNames = Object.keys(typing).filter((id) => id !== me.id).map(people.nameOf);
  const iApproved = vote ? vote.approvedBy.includes(me.id) : false;

  return (
    <div className="chat breakout">
      <header className="pane-head">
        <button className="ghost back" onClick={props.onBack} aria-label={`Back to ${props.parentTitle}`}>
          ‹
        </button>
        <div className="pane-title">
          <h2>Breakout{others.length > 0 ? ` with ${others.map(people.nameOf).join(", ")}` : ""}</h2>
          <span className="muted small">From {props.parentTitle} · only the people here can see it</span>
        </div>
        {(live || phase === "joining") && (
          <span className={`volatile-pill ${warning ? "warn" : ""}`}>
            <span className="live-dot" aria-hidden />
            {warning ? `Clears in ${warning.seconds}s` : vote ? `Saving in ${vote.secondsRemaining}s` : "Volatile"}
          </span>
        )}
        {live && (
          <>
            <button className="ghost" onClick={end} disabled={busy}>
              End breakout
            </button>
            {!vote && (
              <button className="volatile-btn solid" onClick={keep} disabled={busy}>
                Keep chat
              </button>
            )}
          </>
        )}
      </header>

      {live && !warning && !vote && (
        <div className="volatile-banner">
          Not saved anywhere. Clears itself once everyone has left, unless someone asks to keep it and nobody says no.
        </div>
      )}

      {live && vote && !iApproved && (
        <div className="clearance vote" role="alert">
          <div>
            <strong>{people.nameOf(vote.requestedBy)} wants to keep this chat.</strong>
            <span>
              {" "}
              It will be saved for everyone here in <span className="count">{vote.secondsRemaining}</span> seconds
              unless someone declines.
            </span>
          </div>
          <div className="row-end">
            <button className="ghost on-ember" onClick={() => respond(false)} disabled={busy}>
              Decline
            </button>
            <button className="volatile-btn solid" onClick={() => respond(true)} disabled={busy}>
              Allow
            </button>
          </div>
        </div>
      )}

      {live && vote && iApproved && (
        <div className="volatile-banner waiting" role="status">
          {vote.requestedBy === me.id ? "You asked to keep this chat." : "You allowed keeping this chat."} It will be saved in{" "}
          <strong>{vote.secondsRemaining}s</strong> unless someone declines.
        </div>
      )}

      {live && warning && !vote && (
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

      {notice && (
        <p className="notice pad" role="status">
          {notice}
        </p>
      )}

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
          header={
            <>
              {breakout?.quotedMessage && (
                <blockquote className="breakout-quote in-chat">
                  <span className="muted small">Started from {people.nameOf(breakout.quotedMessage.senderId)}'s message</span>
                  <span>{breakout.quotedMessage.text}</span>
                </blockquote>
              )}
              {messages.length === 0 && <p className="muted center pad">Nothing said yet. Only the people here can see this.</p>}
            </>
          }
        />
      )}

      {phase === "kept" && (
        <div className="outcome">
          <h3>Kept</h3>
          <p className="muted">This breakout is now a permanent chat. You'll find it under Kept breakouts.</p>
          <button className="primary" onClick={() => props.onOpenKept(breakoutId)}>
            Open saved chat
          </button>
        </div>
      )}

      {(phase === "cleared" || phase === "unavailable") && (
        <div className="outcome">
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

      {live && (
        <>
          <div className="typing" aria-live="polite">
            {typingNames.length > 0 && `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`}
          </div>
          <Composer
            placeholder="Message the breakout"
            onSend={send}
            onTyping={(isTyping) => socket.setBreakoutTyping(breakoutId, isTyping)}
          />
        </>
      )}
    </div>
  );
}
