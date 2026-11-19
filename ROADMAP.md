# Ember roadmap

Where things stand (November 2026): stage 1 is done. The server and web
client cover the everyday chat basics (replies, reactions, edits, unread
counts, receipts, group management) and breakouts are invite only, with
keeping decided by a vote.
The SwiftUI iOS app is frozen because there's no Mac to build it (see
the end of this file). Phones get the web app as an installable PWA
first, then an Expo app built in the cloud.

The plan is in four stages. Each one leaves the app in a usable state.

## Stage 1: Finish the basics (done)

- [x] Only the invitees learn a breakout exists; nothing is posted in the
      parent chat.
- [x] Keeping is a vote: the others get 15 seconds to decline, silence
      counts as yes, and any decline cancels it.
- [x] Kept breakouts have their own list instead of sitting in the chat.
- [x] Real system messages ("Alice added Bob").
- [x] Unread counts and "Seen" receipts that survive a reload.
- [x] Replies, reactions, edit, delete for everyone.
- [x] Group management: rename, add or remove people, leave, admin
      handover.
- [x] Typing indicators inside breakouts.
- [x] Breakouts only from groups.
- [x] GitHub Actions: server tests and web build on every push.
- [x] Rate limiting on login, sign up, search, sending and chat changes.
- [x] WebSocket logs in with its first message, not a token in the URL.
- [x] Sign out everywhere.
- [x] Removed the Firebase stub.

Carried over to later:

- [ ] Browser tests (Playwright) for the breakout flow with two signed in
      users. Today the flow is covered by API level end to end tests and
      by hand.
- [ ] Shorter lived tokens with refresh. Tokens still last 30 days, but
      "sign out everywhere" can now revoke them.

## Quality of life

Done:

- [x] Drafts kept per chat (never for breakouts, which stay off disk)
- [x] Clickable links
- [x] Date dividers and a "New messages" line
- [x] Jump-to-latest button with a count of new messages
- [x] Click a reply's quote to jump to the original
- [x] Unread count in the browser tab title
- [x] Sidebar search
- [x] Desktop notifications (opt in, while Ember is in the background)
- [x] Reply in a breakout

Ideas for later, all small:

- [ ] Press Up in an empty box to edit your last message
- [ ] Copy text in the message menu
- [ ] A consistent colour per person for avatars and names
- [ ] Light / dark / system switch in Settings
- [ ] Mute and pin chats
- [ ] Online dots and "last seen"
- [ ] Show messages as sending, with Retry if it fails
- [ ] Search inside a chat
- [ ] Show who is in a breakout right now
- [ ] Show the time left before a quiet breakout starts clearing
- [ ] Rename or leave a kept breakout

## Stage 2: Put it online and on phones

- [ ] One `docker compose up` that runs the server and serves the built
      web app from the same origin.
- [ ] Deploy (Fly.io or Render, both covered in `EmberServer/README.md`)
      with HTTPS and a real `JWT_SECRET`.
- [ ] **Make the web app an installable PWA.** This is the way onto
      iPhones without a Mac: add a manifest and a service worker, then
      "Add to Home Screen" gives an app icon and full screen.
- [ ] Web push notifications for new messages and breakout invites
      (works for installed PWAs on iOS 16.4 and later). Replaces the FCM
      stub for now.
- [ ] Online and last seen presence (the server already knows who has a
      socket open).
- [ ] Photos and files through presigned uploads (S3 or Cloudflare R2).
      Files sent inside a breakout must be deleted when it clears, or
      the "nothing is saved" promise breaks.

## Stage 3: Make breakouts better than "a temporary group chat"

The features that make Ember worth using over WhatsApp or Discord.

- [ ] **End to end encryption for breakouts.** Right now "not saved"
      means not on disk, but the server can still read messages while
      they're in memory. With participants encrypting to each other, the
      server only relays ciphertext and the promise holds even against
      whoever runs the server. Kept chats would need the same treatment.
- [ ] Choose the timeout when starting a breakout (5 minutes, 30 minutes,
      until everyone leaves).
- [ ] Invite more people into a live breakout, and leave one without
      ending it for everyone else.
- [ ] Show who is currently in the breakout (the server tracks viewers).
- [ ] Notify participants who kept it, and when.
- [ ] "Bring it back to the group": post a short summary or a chosen
      message from the breakout into the parent chat.
- [ ] Breakouts that start from a single message ("reply in a breakout").

## Stage 4: Scale and native apps

Only worth doing once real people use it.

- [ ] Move live breakouts to Redis (memory store plus pub/sub) so more
      than one server instance can run. The store already sits behind an
      interface meant for this.
- [ ] Move from SQLite to Postgres (only `src/db/*Repo.ts` changes).
- [ ] Native mobile with **Expo (React Native)**, all from Windows. No Mac
      is needed at any point:
      - develop on a real iPhone or Android phone with the Expo Go app
      - reuse the web client's `api.ts`, `socket.ts` and `types.ts`
      - build the App Store and Play Store binaries in the cloud with EAS
        Build, and submit with EAS Submit (the App Store needs an Apple
        Developer account, 99 USD a year)
      - real push notifications through Expo's push service

## The SwiftUI app (`Ember/`)

There's no Mac on the horizon, so the SwiftUI app is **frozen**. It
stays in the repo as a reference for the iOS design (amber dashed
bubbles, the volatile pill, the clearance sheet), but it won't be built
or kept in sync with the server. Phones are covered first by the PWA
(stage 2) and then by the Expo app (stage 4). It no longer matches the
server either (it still puts the token in the WebSocket URL, which the
server now refuses). If it's still unused once the Expo app ships,
delete it.
