// Desktop notifications through the browser's Notification API. They only
// show while Ember is in the background, and only if the user turned them on
// in Settings (and the browser allowed it).

const PREF_KEY = "ember.desktopNotifications";

export const notificationsSupported = typeof window !== "undefined" && "Notification" in window;

export function notificationsWanted(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export function notificationsAllowed(): boolean {
  return notificationsSupported && Notification.permission === "granted";
}

/** Turns notifications on or off. Turning on asks the browser for permission. Returns whether they're now on. */
export async function setNotificationsWanted(on: boolean): Promise<boolean> {
  if (on && notificationsSupported && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  const enabled = on && notificationsAllowed();
  try {
    localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
  } catch {
    // Storage blocked: the setting won't stick across reloads.
  }
  return enabled;
}

/** True when the user isn't looking at Ember right now. */
export function appInBackground(): boolean {
  return document.visibilityState !== "visible" || !document.hasFocus();
}

/**
 * Shows a notification if they're enabled. `tag` replaces an earlier
 * notification with the same tag, so a busy chat doesn't stack up dozens.
 */
export function notify(title: string, body: string, tag: string, onClick: () => void) {
  if (!notificationsWanted() || !notificationsAllowed()) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 180), tag });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some browsers (e.g. Android Chrome) only allow notifications from a
    // service worker. That arrives with the PWA work.
  }
}
