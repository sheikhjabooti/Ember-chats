# Ember Server

REST + WebSocket backend for the Ember iOS app: standard persisted chats
(SQLite via `better-sqlite3`) and volatile breakout chats (pure
in-memory, server-side `VolatileChatStore` — same lifecycle semantics as
the iOS client's actor).

This has been run and smoke-tested end to end in this repo's dev
environment (register → login → chat → messages → start breakout →
breakout messages → Keep Chat → promoted-and-purged; and separately,
End Breakout without Keep Chat → auto-purge after the warning window,
confirmed absent from the persisted chat list). It has **not** been
tested inside an actual `docker build` in this environment (no Docker
daemon available here) — see "A note on what's verified" below.

## Why SQLite (not Postgres/Prisma)

The original spec allowed either Firebase or a custom backend. This
implementation uses a custom Express + `ws` backend with `better-sqlite3`
rather than Prisma/Postgres, specifically so it:

- has zero external services to provision before it runs
- ships prebuilt native binaries (fetched from GitHub releases at
  `npm install` time) instead of needing a bespoke binary-fetch step
- is a single container + one persistent volume to deploy

This is genuinely sufficient for small-to-medium deployments. If you
outgrow a single SQLite file (heavy concurrent writes, multi-region,
horizontal scaling of the app tier), the repository layer is isolated
in `src/db/*Repo.ts` — swap those two files for a Postgres client (e.g.
`pg` or Prisma) without touching any route or service code, since routes
only call the repo functions, never raw SQL.

## Endpoints

```
POST   /auth/register              { email|phone, password, displayName }
POST   /auth/login                 { email|phone, password }
GET    /auth/me                    (bearer token)

PATCH  /users/me                   { displayName?, statusMessage?, tombstoneLoggingEnabled?, notificationsEnabled?, fcmToken? }
GET    /users/search?q=<text>      exact email/phone or display-name prefix; profiles only, no contact details
GET    /users/:id                  public profile (id, displayName, avatarUrl, statusMessage)

GET    /chats                      list chats for the current user
POST   /chats                      { kind: "direct"|"group", title?, participantIds }
                                   400 on unknown user ids; a direct chat that already
                                   exists is returned (200) instead of duplicated
GET    /chats/:id
GET    /chats/:id/messages         ?before=<ISO date>&limit=<n>
POST   /chats/:id/messages         { text, replyToMessageId? }
POST   /chats/:id/typing           { isTyping }
POST   /chats/:id/breakout         { participantIds }  -> starts a breakout chat
GET    /chats/:id/breakouts        { active: [...live breakouts you're in], kept: [...saved breakout threads] }

GET    /breakouts/:id
GET    /breakouts/:id/messages
POST   /breakouts/:id/messages     { text }             (REST fallback; prefer WS)
POST   /breakouts/:id/keep          -> promotes to a persisted chat
POST   /breakouts/:id/end           -> starts the clearance warning window

POST   /media/presign              stubbed 501 — see src/routes/media.ts
GET    /health
```

## WebSocket

Connect to `wss://<host>/ws?token=<JWT from /auth/login>`.

Server -> client events (persisted chats, pushed automatically):
`{"type":"message", chatId, message}`
`{"type":"typing", chatId, userId, isTyping}`
`{"type":"breakout:started", parentChatId, breakout}`
`{"type":"breakout:promoted", chatId, parentChatId, chat}`
`{"type":"breakout:cleared", chatId, parentChatId}` (cleared without being kept)

Kept breakouts never appear in `GET /chats`. Show them as threads under
their parent chat using `GET /chats/:id/breakouts`.

Client -> server (breakout chats only — persisted chats use the REST
endpoints above, delivery is server-pushed):
`{"type":"breakout:subscribe", chatId}` -> replies with
  `{"type":"breakout:snapshot", chatId, breakout, messages}` then streams
  `{"type":"message", chatId, message}`,
  `{"type":"expiryWarning", chatId, secondsRemaining, reason}`,
  `{"type":"warningCancelled", chatId}`,
  `{"type":"purged", chatId}`, `{"type":"promoted", chatId}`
`{"type":"breakout:send", chatId, text}`
`{"type":"breakout:unsubscribe", chatId}`
`{"type":"ping"}` -> `{"type":"pong"}`

### Breakout lifecycle (the server is the source of truth)

Clients should render these events, not run their own timers, so every
participant sees the same countdown. A countdown starts for one of
three reasons, and `reason` says which:

| reason       | starts when                                              | cancelled by            |
|--------------|----------------------------------------------------------|-------------------------|
| `inactivity` | no messages for `BREAKOUT_DEFAULT_INACTIVITY_SECONDS`    | anyone sending a message |
| `empty`      | nobody subscribed for `BREAKOUT_EMPTY_GRACE_SECONDS`     | anyone subscribing again |
| `ended`      | someone called `POST /breakouts/:id/end`                 | only Keep Chat           |

A `breakout:subscribe` counts as viewing the chat. Several connections
from the same user count as one viewer. If the countdown
(`BREAKOUT_WARNING_WINDOW_SECONDS`) runs out, the chat is purged from
memory. Keep Chat writes the chat and its history in a single database
transaction. If that fails, the chat stays live and the call can be
retried. Simultaneous Keep taps are safe.

## Local development

```sh
npm install
cp .env.example .env        # edit JWT_SECRET at minimum
npm run dev                 # ts-node-dev, auto-restarts on change
```

The SQLite schema (`src/db/schema.sql`) is applied automatically on
startup — no separate migration command needed for this setup.

## Tests

```sh
npm test
```

Two suites, both run against an in-memory database with shortened
timers:

- `test/volatileChatStore.test.ts`: the store on its own. Append,
  End countdown and purge, Keep (including a failed save being
  retryable and concurrent Keeps), the "everyone left" countdown and
  cancelling it by coming back, and inactivity vs explicit end.
- `test/api.test.ts`: boots the real HTTP + WebSocket server on a random
  port and drives it like a client. Auth, user search, chat creation
  rules, the full invite / join / chat / keep / thread flow, End
  Breakout clearing with no trace, auto-clearing when everyone leaves,
  and who may be pulled into a breakout.

Requires Node 22 or newer (developed on Node 26).

## Docker

```sh
docker build -t ember-server .
docker run -p 4000:4000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v ember_data:/data \
  ember-server
```

Or with Compose (reads `JWT_SECRET`/`CORS_ORIGIN` from a `.env` file
next to `docker-compose.yml`):

```sh
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up --build -d
curl http://localhost:4000/health
```

### A note on what's verified

This sandbox doesn't have a Docker daemon, so the `Dockerfile` and
`docker-compose.yml` above are written correctly against the real Node
22 / better-sqlite3 toolchain and match exactly what was tested locally
(`npm run build && node dist/index.js`, which *was* run and verified),
but the container build itself hasn't been executed here. Before you
deploy, run `docker build -t ember-server .` locally once to confirm it
builds clean on your machine/architecture — `better-sqlite3` may need to
compile its native addon from source on `arm64` if no prebuilt binary is
published for that combination, which is why the build stage installs
`python3 make g++`.

## Deploying

Any host that runs a Docker container with a persistent volume works.
Three concrete options:

**Fly.io**
```sh
fly launch --no-deploy          # generates fly.toml, pick a region
fly volumes create ember_data --size 1
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
# In fly.toml, add: [[mounts]] source = "ember_data", destination = "/data"
fly deploy
```

**Render**
- New "Web Service" from this repo, Docker runtime.
- Add a Render Disk mounted at `/data`.
- Set env vars `JWT_SECRET`, `DATABASE_FILE=/data/ember.db`.

**Railway**
- New project from this repo (Dockerfile auto-detected).
- Add a Volume mounted at `/data`.
- Set the same env vars as above.

In every case: set `JWT_SECRET` to a real random value. With
`NODE_ENV=production` (the Docker image sets it) the server refuses to
start if `JWT_SECRET` is missing or still the `.env.example` placeholder, set `CORS_ORIGIN` to your app's actual origin
if you add a web client, and put the service behind TLS (Fly/Render/
Railway all terminate TLS for you automatically) — the iOS client uses
`wss://`/`https://` by default (see `EmberBackendService.swift`).

## What's still a stub

- `src/services/push.ts` — logs instead of sending FCM pushes; wire in
  `firebase-admin` with a real service account per the comment in that
  file.
- `src/routes/media.ts` — returns `501` instead of a presigned upload
  URL; wire to S3/GCS/Firebase Storage per the comment in that file.
- Each server instance keeps live breakouts in its own memory, so a
  restart clears them and running more than one instance needs sticky
  routing by chat id (see the note in `src/services/volatileChatStore.ts`).
- No rate limiting yet on login, search or message sends.
- Group chat admin management (add/remove member, role changes) — the
  data model supports it (`chat_participants.role`) but no endpoints
  exist yet beyond creation.
