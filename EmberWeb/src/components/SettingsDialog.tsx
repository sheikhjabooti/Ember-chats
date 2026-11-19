import { FormEvent, useState } from "react";
import { api } from "../api";
import type { Me } from "../types";
import { Dialog } from "./Dialog";

export function SettingsDialog({
  me,
  onClose,
  onSaved,
  onSignedOutEverywhere,
}: {
  me: Me;
  onClose: () => void;
  onSaved: (me: Me) => void;
  onSignedOutEverywhere: () => void;
}) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [statusMessage, setStatusMessage] = useState(me.statusMessage ?? "");
  const [tombstones, setTombstones] = useState(me.tombstoneLoggingEnabled);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.updateMe({
          displayName: displayName.trim(),
          statusMessage: statusMessage.trim(),
          tombstoneLoggingEnabled: tombstones,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    if (!window.confirm("Sign out on every device, including this one?")) return;
    setBusy(true);
    try {
      await api.logoutEverywhere();
      onSignedOutEverywhere();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out everywhere");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label>
          Display name
          <input value={displayName} maxLength={80} required onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          Status
          <input value={statusMessage} maxLength={200} onChange={(e) => setStatusMessage(e.target.value)} />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={tombstones} onChange={(e) => setTombstones(e.target.checked)} />
          <span>
            <strong>Log breakouts I start</strong>
            <span className="muted">
              Keeps a record that a breakout happened (who and when) after it clears. Never the messages.
            </span>
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-between">
          <button type="button" className="ghost danger" onClick={signOutEverywhere} disabled={busy}>
            Sign out everywhere
          </button>
          <div className="row-end">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
