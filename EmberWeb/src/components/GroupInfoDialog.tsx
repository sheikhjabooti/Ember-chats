import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { initials } from "../format";
import type { People } from "../people";
import type { Chat, Me, Profile } from "../types";
import { Dialog } from "./Dialog";

/** Group name, members, add or remove people (admins), and leave. */
export function GroupInfoDialog({
  chat,
  me,
  people,
  onClose,
  onChanged,
  onLeft,
}: {
  chat: Chat;
  me: Me;
  people: People;
  onClose: () => void;
  onChanged: (chat: Chat) => void;
  onLeft: () => void;
}) {
  const isAdmin = chat.adminIds.includes(me.id);
  const [title, setTitle] = useState(chat.title ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchUsers(q)
        .then((found) => {
          people.remember(found);
          setResults(found.filter((p) => !chat.participantIds.includes(p.id)));
        })
        .catch((err) => setError(err.message));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, chat.participantIds]);

  async function run(action: () => Promise<Chat | void>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      if (updated) onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    run(() => api.renameChat(chat.id, title.trim() || null));
  }

  return (
    <Dialog title="Group info" onClose={onClose}>
      <div className="stack">
        {isAdmin ? (
          <form className="inline-form" onSubmit={rename}>
            <label>
              Group name
              <input value={title} maxLength={80} placeholder="No name (shows member names)" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <button className="ghost" type="submit" disabled={busy || title.trim() === (chat.title ?? "")}>
              Save
            </button>
          </form>
        ) : (
          <p>
            <strong>{chat.title ?? "Unnamed group"}</strong>
            <span className="muted small"> · only admins can rename or manage members</span>
          </p>
        )}

        <div>
          <h3 className="section-title">{chat.participantIds.length} members</h3>
          <ul className="member-list">
            {chat.participantIds.map((id) => (
              <li key={id}>
                <span className="avatar small" aria-hidden>
                  {initials(people.nameOf(id))}
                </span>
                <span className="member-name">
                  {people.nameOf(id)}
                  {id === me.id && <span className="muted"> (you)</span>}
                </span>
                {chat.adminIds.includes(id) && <span className="badge">Admin</span>}
                {isAdmin && id !== me.id && (
                  <button
                    className="ghost small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove ${people.nameOf(id)} from the group?`)) {
                        run(async () => {
                          await api.removeMember(chat.id, id);
                          return api.chat(chat.id);
                        });
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {isAdmin && (
          <div className="stack">
            <label>
              Add people
              <input placeholder="Name, or exact email" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {results.length > 0 && (
              <ul className="pick-list">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      className="pick"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const updated = await api.addMembers(chat.id, [p.id]);
                          setQuery("");
                          return updated;
                        })
                      }
                    >
                      <span className="avatar small" aria-hidden>
                        {initials(p.displayName)}
                      </span>
                      <span>{p.displayName}</span>
                      <strong className="add-label">Add</strong>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row-between">
          <button
            className="ghost danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Leave this group? You'll stop getting its messages.")) {
                run(async () => {
                  await api.removeMember(chat.id, me.id);
                  onLeft();
                });
              }
            }}
          >
            Leave group
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
