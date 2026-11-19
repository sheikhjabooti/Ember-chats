# Ember

A chat app built around one idea: **breakout chats**. Inside any group you
can pull a few of the people into a side conversation, and only they know
it exists. That conversation is never written to a database. It lives in
the server's memory while people are in it, and it clears itself once
everyone has left, after a 15 second "about to be cleared" countdown.
Anyone can ask to **keep** it; the others get 15 seconds to decline, and if
nobody does it becomes a normal saved chat under **Kept breakouts**.

Think "let's take this offline" without spawning yet another permanent
group chat.

## What's in here

| Folder         | What it is                                                     | Status                                   |
|----------------|----------------------------------------------------------------|------------------------------------------|
| `EmberServer/` | Node + TypeScript backend: REST API, WebSocket, SQLite         | Working, 32 automated tests              |
| `EmberWeb/`    | React + Vite web client                                        | Working: see the feature list below      |
| `Ember/`       | SwiftUI iOS app                                                | Frozen (no Mac); kept as design reference |

See [ROADMAP.md](ROADMAP.md) for what's next.

## Run it locally

You need **Node.js 22 or newer** (`node -v` to check).

If `npm` is "not recognized" right after installing Node, the terminal was
opened before the install and still has the old PATH. Close the app it
runs in (VS Code, Claude, Windows Terminal) and reopen it, or reload the
PATH in the current PowerShell window:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

**1. Start the server** (terminal 1):

```bash
cd EmberServer
npm install
cp .env.example .env
npm run dev
```

It listens on http://localhost:4000. `curl http://localhost:4000/health`
should answer `{"status":"ok",...}`. On Windows PowerShell use
`copy .env.example .env` instead of `cp`. Data goes into
`EmberServer/ember.db` (a SQLite file; delete it to start fresh).

**2. Start the web app** (terminal 2):

```bash
cd EmberWeb
npm install
npm run dev
```

Open http://localhost:5173. The web app forwards `/api` and `/ws` to the
server on port 4000, so there's nothing else to configure.

**3. Try a breakout.** You need at least two accounts signed in at once.
A login is remembered per browser origin, so use one of these:

- a normal window plus a private/incognito window, or
- http://localhost:5173 in one tab and http://127.0.0.1:5173 in another.

Then: sign up as two or three people, create a group from **+ New chat**,
open it, click **Start breakout**, and pick someone. They'll see a pulsing
invite at the top of that chat; the people you left out see nothing. Try
**End breakout** (everyone sees the countdown) and **Keep chat** (the
others get Allow / Decline; kept chats land in the **Kept breakouts** tab).

## Features

- Sign up and log in; stays signed in across reloads; sign out everywhere
- Find people by name or email; DMs and groups
- Live messages, typing indicators, unread counts, "Seen" receipts
- Reply, react, edit and delete for everyone (hover a message, click ⋯)
- Groups: rename, add and remove people, leave; admin passes on automatically
- Breakouts: invite only, live countdown with the reason, End, keep by vote,
  typing indicators, and a separate Kept breakouts list
- Rate limits on logins, search and sending

## Tests

```bash
cd EmberServer
npm test
```

Runs the store and rate limiter unit tests, plus end to end tests that
boot the real server and talk to it over HTTP and WebSocket. About 20
seconds. GitHub Actions runs these and the web build on every push.

```bash
cd EmberWeb
npm run build
```

Typechecks the web client and makes a production build in `EmberWeb/dist`.

## Useful settings

All in `EmberServer/.env`:

| Variable                              | Default | Meaning                                                         |
|---------------------------------------|---------|-----------------------------------------------------------------|
| `BREAKOUT_DEFAULT_INACTIVITY_SECONDS` | 1800    | No messages for this long starts the countdown                  |
| `BREAKOUT_EMPTY_GRACE_SECONDS`        | 60      | Nobody viewing for this long starts the countdown               |
| `BREAKOUT_WARNING_WINDOW_SECONDS`     | 15      | Length of the "about to be cleared" countdown                   |
| `KEEP_VOTE_SECONDS`                   | 15      | How long others have to decline a keep request                  |
| `RATE_LIMITS`                         | on      | Set to `off` to disable rate limiting                           |
| `JWT_SECRET`                          | dev     | Must be a real random value in production or the server refuses |

Lower the first two to watch breakouts clear themselves quickly while
you're trying things out.

More detail: [EmberServer/README.md](EmberServer/README.md) (API and
WebSocket reference, Docker, deploying), [EmberWeb/README.md](EmberWeb/README.md),
[Ember/README.md](Ember/README.md) (iOS).
