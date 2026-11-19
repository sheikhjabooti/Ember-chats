# Ember API

Reference for the server in `EmberServer/`. Everything except
`/auth/register`, `/auth/login` and `/health` needs an
`Authorization: Bearer <token>` header. Errors come back as
`{ "error": ... }` with a 4xx or 5xx status.

## REST endpoints

```
POST   /auth/register              { email|phone, password, displayName }
POST   /auth/login                 { email|phone, password }
GET    /auth/me                    (bearer token)
POST   /auth/logout-all            sign out everywhere: every token stops working, sockets close

PATCH  /users/me                   { displayName?, statusMessage?, tombstoneLoggingEnabled?, notificationsEnabled?, fcmToken? }
GET    /users/search?q=<text>      exact email/phone or display-name prefix; profiles only, no contact details
GET    /users/:id                  public profile (id, displayName, avatarUrl, statusMessage)

GET    /chats                      your chats, each with unreadCount, readState, adminIds
POST   /chats                      { kind: "direct"|"group", title?, participantIds }
                                   400 on unknown user ids; a direct chat that already
                                   exists is returned (200) instead of duplicated
GET    /chats/:id
PATCH  /chats/:id                  { title }               rename a group (admins)
POST   /chats/:id/participants     { userIds }             add people to a group (admins)
DELETE /chats/:id/participants/:u  remove someone (admins), or leave (yourself)
GET    /chats/:id/messages         ?before=<ISO date>&limit=<n>
POST   /chats/:id/messages         { text, replyToMessageId? }
PATCH  /chats/:id/messages/:m      { text }                edit your own message
DELETE /chats/:id/messages/:m      delete your own message for everyone
POST   /chats/:id/messages/:m/reactions  { emoji }         toggle your reaction
POST   /chats/:id/read             { upToMessageId? }      mark read; others get a `read` event
POST   /chats/:id/typing           { isTyping }
POST   /chats/:id/breakout         { participantIds, fromMessageId? }  start a breakout (groups only);
                                   with fromMessageId it opens quoting that message
GET    /chats/:id/breakouts        { active: [...live breakouts you're in] }

GET    /breakouts/kept             every kept breakout you were in (their own list, not in /chats)
GET    /breakouts/:id
GET    /breakouts/:id/messages
POST   /breakouts/:id/messages     { text }                (REST fallback; prefer WS)
POST   /breakouts/:id/keep         ask to keep it: 202 while the vote runs, 200 once saved
POST   /breakouts/:id/keep/respond { allow }               answer someone else's keep request
POST   /breakouts/:id/end          start the clearance countdown (declines a running keep vote)

POST   /media/presign              stubbed 501, see src/routes/media.ts
GET    /health
```

## WebSocket

Connect to `wss://<host>/ws`, then send `{"type":"auth","token":"<JWT>"}`
as the first message within 5 seconds. The server answers
`{"type":"ready","userId"}`, or closes with code 4401 if the token is bad
or the user signed out everywhere. (The token isn't put in the URL because
URLs end up in proxy and server logs.)

Server -> client events for your chats, pushed automatically:
`{"type":"message", chatId, message}` (messages have `kind`: `text` or `system`)
`{"type":"message:updated", chatId, message}` (edited, deleted, reacted)
`{"type":"read", chatId, userId, lastReadAt}`
`{"type":"typing", chatId, userId, isTyping}`
`{"type":"chat:added", chat}`, `{"type":"chat:updated", chat}`, `{"type":"chat:removed", chatId}`
`{"type":"breakout:started", parentChatId, breakout}` (only to the invitees)
`{"type":"breakout:promoted", chatId, parentChatId, chat}`
`{"type":"breakout:cleared", chatId, parentChatId}` (cleared without being kept)

Client -> server, for breakouts (saved chats use the REST endpoints above):
`{"type":"breakout:subscribe", chatId}` -> replies with
  `{"type":"breakout:snapshot", chatId, breakout, messages}` then streams
  `{"type":"message", chatId, message}`,
  `{"type":"typing", chatId, userId, isTyping}`,
  `{"type":"expiryWarning", chatId, secondsRemaining, reason}`,
  `{"type":"warningCancelled", chatId}`,
  `{"type":"keepRequested", chatId, requestedBy, secondsRemaining, approvedBy}`,
  `{"type":"keepDeclined", chatId, declinedBy}`, `{"type":"keepFailed", chatId}`,
  `{"type":"purged", chatId}`, `{"type":"promoted", chatId}`
`{"type":"breakout:send", chatId, text}`
`{"type":"breakout:typing", chatId, isTyping}`
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
memory.

**Keeping is a vote.** Keeping saves everyone's words, so when someone
asks, the others get `KEEP_VOTE_SECONDS` (default 15) to decline. Any
decline cancels it. Silence counts as yes, and everyone approving saves it
straight away. A countdown that was running pauses during the vote and
resumes if it's declined. Saving writes the chat and its whole history in
one database transaction; if that fails, the chat stays live. Asking while
a vote is running counts as approving it, so double taps are safe.

**Only invitees know.** Starting a breakout posts nothing in the parent
chat. Only the people invited get `breakout:started`.
