import { useState } from "react";
import { initials } from "../format";
import { Dialog } from "./Dialog";

export function StartBreakoutDialog({
  candidates,
  nameOf,
  quote,
  preselected = [],
  onClose,
  onStart,
}: {
  candidates: string[];
  nameOf: (id: string) => string;
  /** The message this breakout replies to, shown at the top. */
  quote?: { senderName: string; text: string };
  preselected?: string[];
  onClose: () => void;
  onStart: (ids: string[]) => Promise<void>;
}) {
  // In a 1:1 chat there is only one possible person, so preselect them.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.length === 1 ? candidates : preselected.filter((id) => candidates.includes(id)))
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await onStart([...selected]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the breakout");
      setBusy(false);
    }
  }

  return (
    <Dialog title={quote ? "Reply in a breakout" : "Start a breakout"} onClose={onClose}>
      <div className="stack">
        {quote && (
          <blockquote className="breakout-quote">
            <strong>{quote.senderName}</strong>
            <span>{quote.text}</span>
          </blockquote>
        )}
        <p className="muted">
          A side conversation with some people from this chat. Only they will know it exists. Messages are never
          saved: it clears itself once everyone has left, unless someone asks to <strong>keep</strong> it and nobody
          says no.
        </p>
        <ul className="pick-list">
          {candidates.map((id) => (
            <li key={id}>
              <label className={`pick ${selected.has(id) ? "on" : ""}`}>
                <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                <span className="avatar small" aria-hidden>
                  {initials(nameOf(id))}
                </span>
                <span>{nameOf(id)}</span>
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="volatile-btn solid" disabled={busy || selected.size === 0} onClick={start}>
            Start with {selected.size || "…"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
