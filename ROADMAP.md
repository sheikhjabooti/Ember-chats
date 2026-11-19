# Ember roadmap

Where things stand (November 2026): the server and web client work end to
end. You can sign up, find people, chat in DMs and groups in real time, and
start breakouts that count down, clear themselves, or get kept as threads.
The SwiftUI iOS app is frozen because there's no Mac to build it (see
the end of this file). Phones get the web app as an installable PWA
first, then an Expo app built in the cloud.

The plan is in four stages. Each one leaves the app in a usable state.

## Stage 1: Finish the basics (next)

Gaps you'd notice within five minutes of using it.

**Product decisions to make first**

- [ ] **Who sees that a breakout started?** Right now everyone in the
      parent chat gets "Alice started a breakout with Bob", including the
      people left out. That ruins the obvious use case (planning Carol's
      surprise party in a chat Carol is in). Options: tell only the
      invitees, or show everyone a vague "a breakout is happening". My
      pick: invitees only.
- [ ] **Who can keep a breakout?** Today any one participant can save
      everyone's words permanently. Options: anyone (current), ask the
      others first, or everyone must agree. My pick: anyone can tap Keep,
      the others get a 15 second "Bob wants to keep this. Allow / Decline"
      prompt, and any Decline cancels it.

**Chat features the database already has columns for**

- [ ] Real system messages (a `kind` on messages) instead of posting the
      breakout notice as if Alice typed it.
- [ ] Unread counts and read receipts that survive a reload (`readBy` is
      modeled, nothing writes it yet).
- [ ] Reply to a message (`reply_to_message_id` exists).
- [ ] Reactions (`reactions_json` exists).
- [ ] Edit and delete for everyone (`edited_at`, `deletion_state` exist).
- [ ] Group management: rename, add or remove people, leave a group
      (`role` exists).
- [ ] Typing indicator inside breakouts.
- [ ] Hide "Start breakout" in 1:1 chats, where it means nothing.

**Engineering hygiene**

- [ ] GitHub Actions: run `npm test` for the server and `npm run build`
      for the web on every push.
- [ ] Browser tests (Playwright) for the breakout flow with two signed in
      users.
- [ ] Rate limiting on login, sign up, search and sending.
- [ ] Stop putting the login token in the WebSocket URL (URLs end up in
      logs). Authenticate with the first message instead.
- [ ] Shorter lived tokens plus refresh, and "sign out everywhere".
- [ ] Delete the unused Firebase stub in the iOS code.

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
(stage 2) and then by the Expo app (stage 4). If it's still unused once
the Expo app ships, delete it.
