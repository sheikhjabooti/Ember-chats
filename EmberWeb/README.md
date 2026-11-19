# Ember Web

React + Vite + TypeScript client for [EmberServer](../EmberServer). No UI
framework and no state library: plain React state, one WebSocket.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /ws to localhost:4000
npm run build    # typecheck + production build into dist/
```

Point the dev proxy at another server with `EMBER_SERVER_URL`. When the
built app is hosted on a different origin than the server, set
`VITE_API_URL` and `VITE_WS_URL` at build time (see `.env.example`).

## How it's put together

| File                               | Job                                                                      |
|------------------------------------|--------------------------------------------------------------------------|
| `src/api.ts`                       | Typed REST client; turns server errors into readable messages            |
| `src/socket.ts`                    | The WebSocket: reconnects with backoff, re-subscribes open breakouts     |
| `src/people.ts`                    | Caches profiles so ids render as names                                   |
| `src/components/Workspace.tsx`     | Signed-in shell: chat list, live events, invites, unread dots            |
| `src/components/ChatPane.tsx`      | A saved chat: history, sending, typing, breakout strip                   |
| `src/components/BreakoutPane.tsx`  | A live breakout, fully driven by server events (snapshot, countdown, kept, cleared) |

The breakout view runs no timers of its own. It shows whatever the server
says: `expiryWarning` (with a `reason` of inactivity, empty or ended),
`warningCancelled`, `promoted`, `purged`. Every participant sees the same
countdown.

The login token is kept in `localStorage`, so a reload keeps you signed in.
