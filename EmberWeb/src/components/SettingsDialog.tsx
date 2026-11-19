import { FormEvent, useState } from "react";
import { api } from "../api";
import { notificationsAllowed, notificationsSupported, notificationsWanted, setNotificationsWanted } from "../notify";
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
  const [desktop, setDesktop] = useState(() => notificationsWanted() && notificationsAllowed());
  const [desktopNote, setDesktopNote] = useState<string | null>(null);

  async function toggleDesktop(on: boolean) {
    const enabled = await setNotificationsWanted(on);
    setDesktop(enabled);
    setDesktopNote(
      on && !enabled ? "Your browser blocked notifications for this site. Allow them in the site settings, then try again." : null
    );
  }

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
        {notificationsSupported && (
          <label className="toggle">
            <input type="checkbox" checked={desktop} onChange={(e) => toggleDesktop(e.target.checked)} />
            <span>
              <strong>Desktop notifications</strong>
              <span className="muted">New messages and breakout invites while Ember is in the background.</span>
              {desktopNote && <span className="error">{desktopNote}</span>}
            </span>
          </label>
        )}
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
