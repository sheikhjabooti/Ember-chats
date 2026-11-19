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

  static async open(user: TestUser): Promise<TestSocket> {
    const ws = new WebSocket(`${wsBase}?token=${user.token}`);
    openSockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new TestSocket(ws);
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

test("breakout: invite, join, chat live, keep, and find it as a thread", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const carol = await registerUser("Carol");
  const group = await makeGroup(alice, [bob, carol]);

  const bobSocket = await TestSocket.open(bob);
  const breakout = await startBreakout(group, alice, [bob]);
  assert.ok(breakout.expiresAt);

  // Bob is told about it over his user socket, and can list it.
  await bobSocket.waitFor((f) => f.type === "breakout:started" && f.breakout.id === breakout.id);
  const bobList = await api("GET", `/chats/${group.id}/breakouts`, bob);
  assert.deepEqual(bobList.body.active.map((b: any) => b.id), [breakout.id]);

  // Carol is in the group but not the breakout: she can't see or join it.
  const carolList = await api("GET", `/chats/${group.id}/breakouts`, carol);
  assert.deepEqual(carolList.body.active, []);
  const carolSocket = await TestSocket.open(carol);
  carolSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await carolSocket.waitFor((f) => f.type === "error");
  assert.equal((await api("GET", `/breakouts/${breakout.id}/messages`, carol)).status, 403);

  // Both open it and talk.
  const aliceSocket = await TestSocket.open(alice);
  aliceSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  bobSocket.send({ type: "breakout:subscribe", chatId: breakout.id });
  await aliceSocket.waitFor((f) => f.type === "breakout:snapshot");
  await bobSocket.waitFor((f) => f.type === "breakout:snapshot");

  aliceSocket.send({ type: "breakout:send", chatId: breakout.id, text: "surprise party for carol?" });
  const received = await bobSocket.waitFor((f) => f.type === "message" && f.chatId === breakout.id);
  assert.equal(received.message.text, "surprise party for carol?");
  assert.equal(received.message.senderId, alice.id);

  // Nothing about the breakout is in the database yet.
  const before = await api("GET", `/chats/${breakout.id}`, alice);
  assert.equal(before.status, 404);

  // Bob keeps it. Everyone in it hears, and it becomes a persisted thread.
  const kept = await api("POST", `/breakouts/${breakout.id}/keep`, bob);
  assert.equal(kept.status, 200);
  assert.equal(kept.body.messageCount, 1);
  await aliceSocket.waitFor((f) => f.type === "breakout:promoted" && f.chatId === breakout.id);
  await aliceSocket.waitFor((f) => f.type === "promoted" && f.chatId === breakout.id);

  const threads = await api("GET", `/chats/${group.id}/breakouts`, alice);
  assert.deepEqual(threads.body.active, []);
  assert.equal(threads.body.kept.length, 1);
  assert.equal(threads.body.kept[0].id, breakout.id);
  assert.equal(threads.body.kept[0].lastMessagePreview, "surprise party for carol?");

  // It stays out of the main list, and carol still can't read it.
  const mainList = await api("GET", "/chats", alice);
  assert.equal(mainList.body.some((c: any) => c.id === breakout.id), false);
  const carolThreads = await api("GET", `/chats/${group.id}/breakouts`, carol);
  assert.deepEqual(carolThreads.body.kept, []);
  assert.equal((await api("GET", `/chats/${breakout.id}/messages`, carol)).status, 403);

  const history = await api("GET", `/chats/${breakout.id}/messages`, bob);
  assert.deepEqual(history.body.map((m: any) => m.text), ["surprise party for carol?"]);
});

test("two people tapping Keep at the same time doesn't error", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const group = await makeGroup(alice, [bob]);
  const breakout = await startBreakout(group, alice, [bob]);

  const results = await Promise.all([
    api("POST", `/breakouts/${breakout.id}/keep`, alice),
    api("POST", `/breakouts/${breakout.id}/keep`, bob),
  ]);
  for (const r of results) assert.notEqual(r.status, 500, JSON.stringify(r.body));
  const threads = await api("GET", `/chats/${group.id}/breakouts`, alice);
  assert.equal(threads.body.kept.length, 1);
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
  const threads = await api("GET", `/chats/${group.id}/breakouts`, bob);
  assert.deepEqual(threads.body, { active: [], kept: [] });
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

test("only members of the parent chat can be pulled into a breakout", async () => {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const outsider = await registerUser("Outsider");
  const group = await makeGroup(alice, [bob]);

  const res = await api("POST", `/chats/${group.id}/breakout`, alice, { participantIds: [outsider.id] });
  assert.equal(res.status, 400);
  const notMember = await api("POST", `/chats/${group.id}/breakout`, outsider, { participantIds: [alice.id] });
  assert.equal(notMember.status, 403);
});
