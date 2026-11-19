import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { initials } from "../format";
import type { People } from "../people";
import type { Chat, Profile } from "../types";
import { Dialog } from "./Dialog";

/** Search people, pick one for a direct chat or several for a group. */
export function NewChatDialog({
  people,
  onClose,
  onCreated,
}: {
  people: People;
  onClose: () => void;
  onCreated: (chat: Chat) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchUsers(q)
        .then((found) => {
          setResults(found);
          people.remember(found);
        })
        .catch((err) => setError(err.message))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const toggle = (p: Profile) =>
    setSelected((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]));

  const isGroup = selected.length > 1;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const chat = await api.createChat(
        isGroup ? "group" : "direct",
        selected.map((p) => p.id),
        isGroup ? title.trim() || undefined : undefined
      );
      onCreated(chat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the chat");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="New chat" onClose={onClose}>
      <form className="stack" onSubmit={create}>
        <label>
          Find people
          <input
            autoFocus
            placeholder="Name, or exact email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {selected.length > 0 && (
          <div className="chips">
            {selected.map((p) => (
              <button type="button" key={p.id} className="chip" onClick={() => toggle(p)} aria-label={`Remove ${p.displayName}`}>
                {p.displayName} ✕
              </button>
            ))}
          </div>
        )}

        <ul className="pick-list">
          {searching && <li className="muted">Searching…</li>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <li className="muted">Nobody found. They need to sign up first.</li>
          )}
          {results.map((p) => {
            const on = selected.some((x) => x.id === p.id);
            return (
              <li key={p.id}>
                <label className={`pick ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p)} />
                  <span className="avatar small" aria-hidden>
                    {initials(p.displayName)}
                  </span>
                  <span>{p.displayName}</span>
                </label>
              </li>
            );
          })}
        </ul>

        {isGroup && (
          <label>
            Group name (optional)
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row-end">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || selected.length === 0}>
            {isGroup ? `Create group (${selected.length + 1})` : "Start chat"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
