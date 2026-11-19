/**
 * End-to-end tests: boots the real HTTP + WebSocket server on a random
 * port against an in-memory SQLite database and drives it the way a
 * client would. Short timings come from the `npm test` env vars.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "net";
import { Server } from "http";
import WebSocket from "ws";
import { createEmberServer } from "../src/app";

let server: Server;
let base: string;
let wsBase: string;
const openSockets: WebSocket[] = [];

before(async () => {
  server = createEmberServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  for (const s of openSockets) s.terminate();
  // fetch keeps HTTP connections alive, which would make close() wait forever.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- helpers ------------------------------------------------------------

interface TestUser {
  id: string;
  token: string;
}

async function api(method: string, path: string, user?: TestUser, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

let userCounter = 0;
async function registerUser(displayName: string): Promise<TestUser> {
  userCounter++;
  const res = await api("POST", "/auth/register", undefined, {
    email: `user${userCounter}-${Date.now()}@example.test`,
    password: "correct horse battery",
    displayName,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.user.id, token: res.body.token };
}

/** A WebSocket client that buffers every frame so tests can wait on one. */
class TestSocket {
  frames: any[] = [];
  private waiters: { match: (f: any) => boolean; resolve: (f: any) => void }[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
  }

  /** Connects and authenticates with the first message, like a real client. */
  static async open(user: TestUser): Promise<TestSocket> {
    const ws = new WebSocket(wsBase);
    openSockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const socket = new TestSocket(ws);
    socket.send({ type: "auth", token: user.token });
    await socket.waitFor((f) => f.type === "ready");
    return socket;
  }

  send(payload: unknown) {
    this.ws.send(JSON.stringify(payload));
  }

  /** Resolves with the first frame (already received or future) matching. */
  waitFor(match: (f: any) => boolean, timeoutMs = 3000): Promise<any> {
    const existing = this.frames.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  async close() {
    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

async function makeGroup(owner: TestUser, members: TestUser[]) {
  const res = await api("POST", "/chats", owner, {
    kind: "group",
    title: "Weekend plans",
    participantIds: members.map((m) => m.id),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function startBreakout(group: any, starter: TestUser, invitees: TestUser[]) {
  const res = await api("POST", `/chats/${group.id}/breakout`, starter, {
    participantIds: invitees.map((u) => u.id),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// --- tests --------------------------------------------------------------

test("rejects requests without a valid token", async () => {
  assert.equal((await api("GET", "/chats")).status, 401);
  assert.equal((await api("GET", "/chats", { id: "x", token: "garbage" })).status, 401);
});

test("user search finds people by name without leaking contact details", async () => {
  const me = await registerUser("Searcher");
  const target = await registerUser("Zelda Searchable");

  const res = await api("GET", "/users/search?q=zelda", me);
  assert.equal(res.status, 200);
  const hit = res.body.find((u: any) => u.id === target.id);
  assert.ok(hit, "found by display name prefix");
  assert.equal(hit.email, undefined);
  assert.equal(res.body.some((u: any) => u.id === me.id), false, "never returns the caller");

  assert.equal((await api("GET", "/users/search?q=z", me)).status, 400);

  const profile = await api("GET", `/users/${target.id}`, me);
  assert.equal(profile.body.displayName, "Zelda Searchable");
});

test("creating a chat validates participants and reuses direct chats", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");

  const unknown = await api("POST", "/chats", alice, { kind: "group", participantIds: ["not-a-user"] });
  assert.equal(unknown.status, 400);

  const first = await api("POST", "/chats", alice, { kind: "direct", participantIds: [bob.id] });
  assert.equal(first.status, 201);
  const again = await api("POST", "/chats", bob, { kind: "direct", participantIds: [alice.id] });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
});

test("breakout: invite, join, chat live, keep after a vote, and find it under Kept", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const carol = await registerUser("Carol");
  const group = await makeGroup(alice, [bob, carol]);
  const groupMessagesBefore = (await api("GET", `/chats/${group.id}/messages`, alice)).body.length;

  const bobSocket = await TestSocket.open(bob);
  const carolSocket = await TestSocket.open(carol);
  const breakout = await startBreakout(group, alice, [bob]);
  assert.ok(breakout.expiresAt);

  // Bob is told about it over his user socket, and can list it.
  await bobSocket.waitFor((f) => f.type === "breakout:started" && f.breakout.id === breakout.id);
  const bobList = await api("GET", `/chats/${group.id}/breakouts`, bob);
  assert.deepEqual(bobList.body.active.map((b: any) => b.id), [breakout.id]);

  // Carol is in the group but not the breakout: no event, nothing posted
  // in the group, and she can't see or join it.
  await sleep(100);
  assert.equal(carolSocket.frames.some((f) => f.type === "breakout:started"), false);
  assert.equal((await api("GET", `/chats/${group.id}/messages`, carol)).body.length, groupMessagesBefore);
  const carolList = await api("GET", `/chats/${group.id}/breakouts`, carol);
  assert.deepEqual(carolList.body.active, []);
  carolSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await carolSocket.waitFor((f) => f.type === "error");
  assert.equal((await api("GET", `/breakouts/${breakout.id}/messages`, carol)).status, 403);

  // Both open it and talk, with typing indicators.
  const aliceSocket = await TestSocket.open(alice);
  aliceSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  bobSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await aliceSocket.waitFor((f) => f.type === "breakout:snapshot");
  await bobSocket.waitFor((f) => f.type === "breakout:snapshot");

  aliceSocket.send({ type: "breakout:typing", chatId: breakout.id, isTyping: true });
  const typing = await bobSocket.waitFor((f) => f.type === "typing" && f.chatId === breakout.id);
  assert.equal(typing.userId, alice.id);

  aliceSocket.send({ type: "breakout:send", chatId: breakout.id, text: "surprise party for carol?" });
  const received = await bobSocket.waitFor((f) => f.type === "message" && f.chatId === breakout.id);
  assert.equal(received.message.text, "surprise party for carol?");
  assert.equal(received.message.senderId, alice.id);

  // Nothing about the breakout is in the database yet.
  assert.equal((await api("GET", `/chats/${breakout.id}`, alice)).status, 404);

  // Bob asks to keep it. Alice gets a vote; silence counts as yes (1s in tests).
  const kept = await api("POST", `/breakouts/${breakout.id}/keep`, bob);
  assert.equal(kept.status, 202);
  assert.equal(kept.body.status, "pending");
  const request = await aliceSocket.waitFor((f) => f.type === "keepRequested");
  assert.equal(request.requestedBy, bob.id);
  await aliceSocket.waitFor((f) => f.type === "breakout:promoted" && f.chatId === breakout.id, 4000);

  // It shows up under Kept, not in the main chat list.
  const keptList = await api("GET", "/breakouts/kept", alice);
  assert.deepEqual(keptList.body.map((c: any) => c.id), [breakout.id]);
  assert.equal(keptList.body[0].parentChatId, group.id);
  assert.equal(keptList.body[0].lastMessagePreview, "surprise party for carol?");
  assert.equal(keptList.body[0].unreadCount, 0, "everyone already saw these live");
  const mainList = await api("GET", "/chats", alice);
  assert.equal(mainList.body.some((c: any) => c.id === breakout.id), false);

  // Carol still can't see or read it.
  assert.deepEqual((await api("GET", "/breakouts/kept", carol)).body, []);
  assert.equal((await api("GET", `/chats/${breakout.id}/messages`, carol)).status, 403);

  const history = await api("GET", `/chats/${breakout.id}/messages`, bob);
  assert.deepEqual(history.body.map((m: any) => m.text), ["surprise party for carol?"]);
});

test("anyone can decline a keep request, and the paused countdown resumes", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const group = await makeGroup(alice, [bob]);
  const breakout = await startBreakout(group, alice, [bob]);

  const aliceSocket = await TestSocket.open(alice);
  aliceSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await aliceSocket.waitFor((f) => f.type === "breakout:snapshot");

  await api("POST", `/breakouts/${breakout.id}/end`, alice);
  await aliceSocket.waitFor((f) => f.type === "expiryWarning" && f.reason === "ended");

  // Bob asks to keep it, which pauses the countdown...
  assert.equal((await api("POST", `/breakouts/${breakout.id}/keep`, bob)).status, 202);
  await aliceSocket.waitFor((f) => f.type === "keepRequested");

  // ...and Alice says no. The vote ends and the countdown picks up again.
  assert.equal((await api("POST", `/breakouts/${breakout.id}/keep/respond`, alice, { allow: false })).status, 204);
  const declined = await aliceSocket.waitFor((f) => f.type === "keepDeclined");
  assert.equal(declined.declinedBy, alice.id);
  await aliceSocket.waitFor((f) => f.type === "purged", 3000);
  const afterDecline = aliceSocket.frames.slice(aliceSocket.frames.indexOf(declined) + 1);
  assert.ok(afterDecline.some((f) => f.type === "expiryWarning" && f.reason === "ended"), "countdown resumed");
  assert.deepEqual((await api("GET", "/breakouts/kept", alice)).body, []);

  // Once it's gone, answering is a 404.
  assert.equal((await api("POST", `/breakouts/${breakout.id}/keep/respond`, alice, { allow: true })).status, 404);
});

test("everyone approving keeps it straight away, and double taps are safe", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const group = await makeGroup(alice, [bob]);
  const breakout = await startBreakout(group, alice, [bob]);

  // With nothing pending, there's nothing to answer.
  assert.equal((await api("POST", `/breakouts/${breakout.id}/keep/respond`, bob, { allow: true })).status, 409);

  const results = await Promise.all([
    api("POST", `/breakouts/${breakout.id}/keep`, alice),
    api("POST", `/breakouts/${breakout.id}/keep`, bob),
  ]);
  for (const r of results) assert.notEqual(r.status, 500, JSON.stringify(r.body));
  // Two yeses out of two: no need to wait out the vote.
  const kept = await api("GET", "/breakouts/kept", alice);
  assert.equal(kept.body.length, 1);
});

test("End Breakout counts down for everyone, then clears with no trace", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const group = await makeGroup(alice, [bob]);
  const breakout = await startBreakout(group, alice, [bob]);

  const bobSocket = await TestSocket.open(bob);
  bobSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await bobSocket.waitFor((f) => f.type === "breakout:snapshot");
  await api("POST", `/breakouts/${breakout.id}/messages`, alice, { text: "never mind" });

  assert.equal((await api("POST", `/breakouts/${breakout.id}/end`, alice)).status, 204);
  const warning = await bobSocket.waitFor((f) => f.type === "expiryWarning");
  assert.equal(warning.reason, "ended");

  await bobSocket.waitFor((f) => f.type === "purged" && f.chatId === breakout.id);
  await bobSocket.waitFor((f) => f.type === "breakout:cleared" && f.chatId === breakout.id);

  assert.equal((await api("GET", `/breakouts/${breakout.id}`, bob)).status, 404);
  assert.equal((await api("GET", `/chats/${breakout.id}`, bob)).status, 404);
  assert.deepEqual((await api("GET", `/chats/${group.id}/breakouts`, bob)).body, { active: [] });
  assert.deepEqual((await api("GET", "/breakouts/kept", bob)).body, []);
});

test("when everyone closes the breakout it clears itself, unless someone returns", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const group = await makeGroup(alice, [bob]);

  // Case 1: alice leaves and comes back during the countdown.
  const rescued = await startBreakout(group, alice, [bob]);
  let aliceView = await TestSocket.open(alice);
  aliceView.send({ type: "breakout:subscribe", chatId: rescued.id });
  await aliceView.waitFor((f) => f.type === "breakout:snapshot");
  await aliceView.close();

  // Grace (0.2s) passes, the countdown (1s) starts. Rejoin within it.
  await sleep(400);
  aliceView = await TestSocket.open(alice);
  aliceView.send({ type: "breakout:subscribe", chatId: rescued.id });
  await aliceView.waitFor((f) => f.type === "warningCancelled");
  await sleep(1200);
  assert.equal((await api("GET", `/breakouts/${rescued.id}`, alice)).status, 200, "survived");

  // Case 2: nobody comes back.
  const abandoned = await startBreakout(group, alice, [bob]);
  const bobUserSocket = await TestSocket.open(bob);
  const view = await TestSocket.open(alice);
  view.send({ type: "breakout:subscribe", chatId: abandoned.id });
  await view.waitFor((f) => f.type === "breakout:snapshot");
  await view.close();

  await bobUserSocket.waitFor((f) => f.type === "breakout:cleared" && f.chatId === abandoned.id, 4000);
  assert.equal((await api("GET", `/breakouts/${abandoned.id}`, alice)).status, 404);
});

test("breakouts start only from groups, and only with members", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const outsider = await registerUser("Outsider");
  const group = await makeGroup(alice, [bob]);

  const res = await api("POST", `/chats/${group.id}/breakout`, alice, { participantIds: [outsider.id] });
  assert.equal(res.status, 400);
  const notMember = await api("POST", `/chats/${group.id}/breakout`, outsider, { participantIds: [alice.id] });
  assert.equal(notMember.status, 403);

  const dm = await api("POST", "/chats", alice, { kind: "direct", participantIds: [bob.id] });
  const fromDm = await api("POST", `/chats/${dm.body.id}/breakout`, alice, { participantIds: [bob.id] });
  assert.equal(fromDm.status, 400);
});

test("replies, edits, deletes and reactions reach everyone live", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const dm = (await api("POST", "/chats", alice, { kind: "direct", participantIds: [bob.id] })).body;
  const bobSocket = await TestSocket.open(bob);

  const original = (await api("POST", `/chats/${dm.id}/messages`, alice, { text: "dinner at 8?" })).body;
  const reply = await api("POST", `/chats/${dm.id}/messages`, bob, { text: "yes!", replyToMessageId: original.id });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.replyTo.id, original.id);
  assert.equal(reply.body.replyTo.text, "dinner at 8?");

  // Replying to a message from another chat is refused.
  const other = (await api("POST", "/chats", alice, { kind: "group", participantIds: [bob.id] })).body;
  const stray = (await api("POST", `/chats/${other.id}/messages`, alice, { text: "elsewhere" })).body;
  assert.equal((await api("POST", `/chats/${dm.id}/messages`, bob, { text: "x", replyToMessageId: stray.id })).status, 400);

  // Only the sender can edit.
  assert.equal((await api("PATCH", `/chats/${dm.id}/messages/${original.id}`, bob, { text: "hacked" })).status, 403);
  const edited = await api("PATCH", `/chats/${dm.id}/messages/${original.id}`, alice, { text: "dinner at 8:30?" });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.editedAt);
  const editEvent = await bobSocket.waitFor((f) => f.type === "message:updated" && f.message.id === original.id && f.message.editedAt);
  assert.equal(editEvent.message.text, "dinner at 8:30?");

  // Reactions toggle.
  const reacted = await api("POST", `/chats/${dm.id}/messages/${original.id}/reactions`, bob, { emoji: "👍" });
  assert.deepEqual(reacted.body.reactions, { "👍": [bob.id] });
  const unreacted = await api("POST", `/chats/${dm.id}/messages/${original.id}/reactions`, bob, { emoji: "👍" });
  assert.deepEqual(unreacted.body.reactions, {});
  assert.equal((await api("POST", `/chats/${dm.id}/messages/${original.id}/reactions`, bob, { emoji: "hello" })).status, 400);

  // Delete for everyone leaves a placeholder, and replies stop quoting it.
  const deleted = await api("DELETE", `/chats/${dm.id}/messages/${original.id}`, alice);
  assert.equal(deleted.body.deletionState, "deletedForEveryone");
  assert.equal(deleted.body.text, null);
  const history = (await api("GET", `/chats/${dm.id}/messages`, bob)).body;
  assert.equal(history[0].text, null);
  assert.equal(history[1].replyTo.deleted, true);
  assert.equal((await api("PATCH", `/chats/${dm.id}/messages/${original.id}`, alice, { text: "back" })).status, 400);
});

test("unread counts and read receipts", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const dm = (await api("POST", "/chats", alice, { kind: "direct", participantIds: [bob.id] })).body;
  const aliceSocket = await TestSocket.open(alice);

  await api("POST", `/chats/${dm.id}/messages`, alice, { text: "one" });
  await api("POST", `/chats/${dm.id}/messages`, alice, { text: "two" });

  const bobView = (await api("GET", "/chats", bob)).body.find((c: any) => c.id === dm.id);
  assert.equal(bobView.unreadCount, 2);
  const aliceView = (await api("GET", "/chats", alice)).body.find((c: any) => c.id === dm.id);
  assert.equal(aliceView.unreadCount, 0, "your own messages are never unread");

  const read = await api("POST", `/chats/${dm.id}/read`, bob, {});
  assert.ok(read.body.lastReadAt);
  const receipt = await aliceSocket.waitFor((f) => f.type === "read" && f.userId === bob.id);
  assert.equal(receipt.chatId, dm.id);

  const after = (await api("GET", "/chats", bob)).body.find((c: any) => c.id === dm.id);
  assert.equal(after.unreadCount, 0);
  assert.equal(after.readState[bob.id], read.body.lastReadAt);
});

test("group admins rename and manage members; anyone can leave", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const dave = await registerUser("Dave");
  const group = await makeGroup(alice, [bob]);
  assert.deepEqual(group.adminIds, [alice.id]);
  const bobSocket = await TestSocket.open(bob);
  const daveSocket = await TestSocket.open(dave);

  // Only admins rename; everyone sees a system message.
  assert.equal((await api("PATCH", `/chats/${group.id}`, bob, { title: "Bob's" })).status, 403);
  const renamed = await api("PATCH", `/chats/${group.id}`, alice, { title: "Trip" });
  assert.equal(renamed.body.title, "Trip");
  const notice = await bobSocket.waitFor((f) => f.type === "message" && f.message.kind === "system" && /renamed/.test(f.message.text));
  assert.match(notice.message.text, /Alice renamed the group to "Trip"/);
  await bobSocket.waitFor((f) => f.type === "chat:updated" && f.chat.title === "Trip");

  // Adding someone tells them about the chat.
  assert.equal((await api("POST", `/chats/${group.id}/participants`, bob, { userIds: [dave.id] })).status, 403);
  const added = await api("POST", `/chats/${group.id}/participants`, alice, { userIds: [dave.id] });
  assert.ok(added.body.participantIds.includes(dave.id));
  await daveSocket.waitFor((f) => f.type === "chat:added" && f.chat.id === group.id);

  // Removing someone tells them it's gone.
  assert.equal((await api("DELETE", `/chats/${group.id}/participants/${dave.id}`, bob)).status, 403);
  assert.equal((await api("DELETE", `/chats/${group.id}/participants/${dave.id}`, alice)).status, 204);
  await daveSocket.waitFor((f) => f.type === "chat:removed" && f.chatId === group.id);
  assert.equal((await api("GET", `/chats/${group.id}`, dave)).status, 403);

  // The last admin leaving hands admin to the longest-standing member.
  assert.equal((await api("DELETE", `/chats/${group.id}/participants/${alice.id}`, alice)).status, 204);
  const afterLeave = await api("GET", `/chats/${group.id}`, bob);
  assert.deepEqual(afterLeave.body.participantIds, [bob.id]);
  assert.deepEqual(afterLeave.body.adminIds, [bob.id]);
  const texts = (await api("GET", `/chats/${group.id}/messages`, bob)).body.filter((m: any) => m.kind === "system").map((m: any) => m.text);
  assert.deepEqual(texts, [
    "Alice created the group",
    'Alice renamed the group to "Trip"',
    "Alice added Dave",
    "Alice removed Dave",
    "Alice left the group",
  ]);
});

test("sign out everywhere kills old tokens and open sockets", async () => {
  const alice = await registerUser("Alice");
  const socket = await TestSocket.open(alice);
  const closed = new Promise<number>((resolve) => socket.ws.once("close", (code) => resolve(code)));

  assert.equal((await api("POST", "/auth/logout-all", alice)).status, 204);
  assert.equal(await closed, 4401);
  assert.equal((await api("GET", "/auth/me", alice)).status, 401);
});

test("the WebSocket needs a valid auth message first", async () => {
  const ws = new WebSocket(wsBase);
  openSockets.push(ws);
  await new Promise((r) => ws.once("open", r));
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  ws.send(JSON.stringify({ type: "auth", token: "not-a-token" }));
  assert.equal(await closed, 4401);
});
