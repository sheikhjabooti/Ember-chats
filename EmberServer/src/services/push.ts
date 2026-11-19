/**
 * Push notifications via Firebase Cloud Messaging.
 *
 * This is intentionally left as a documented stub rather than a fake
 * implementation: sending real pushes requires a Firebase service
 * account JSON that only you can provision. Wire it up with:
 *
 *   npm install firebase-admin
 *
 *   import { initializeApp, cert } from "firebase-admin/app";
 *   import { getMessaging } from "firebase-admin/messaging";
 *   initializeApp({ credential: cert(require("../../firebase-service-account.json")) });
 *
 *   export async function sendPush(token: string, title: string, body: string) {
 *     await getMessaging().send({ token, notification: { title, body } });
 *   }
 *
 * Until then, `sendPush` just logs — every call site below is already
 * wired to call it, so once you drop in real credentials, pushes start
 * flowing with no other code changes.
 */
export async function sendPush(fcmToken: string | null | undefined, title: string, body: string): Promise<void> {
  if (!fcmToken) return;
  console.log(`[push:stub] -> ${fcmToken.slice(0, 8)}… "${title}": ${body}`);
}
