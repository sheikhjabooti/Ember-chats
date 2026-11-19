import { test } from "node:test";
import assert from "node:assert/strict";
import { VolatileChatStore, VolatileChatMeta, VolatileChatEvent } from "../src/services/volatileChatStore";

// Each test gets its own store with short windows: a 1s clearance
// countdown and a 0.2s "everyone left" grace period.
function makeStore() {
  return new VolatileChatStore({ warningWindowSeconds: 1, emptyGraceSeconds: 0.2 });
}

function makeMeta(overrides: Partial<VolatileChatMeta> = {}): VolatileChatMeta {
  const inactivityTimeoutSeconds = overrides.inactivityTimeoutSeconds ?? 1800;
  return {
    id: overrides.id ?? `chat-${Math.random().toString(36).slice(2)}`,
    parentChatId: "parent-1",
    participantIds: ["u1", "u2"],
    createdByUserId: "u1",
    createdAt: new Date().toISOString(),
    inactivityTimeoutSeconds,
    expiresAt: new Date(Date.now() + inactivityTimeoutSeconds * 1000).toISOString(),
    ...overrides,
  };
}

function message(chatId: string, text: string) {
  return { id: `m-${Math.random()}`, chatId, senderId: "u1", text, sentAt: new Date().toISOString() };
}

function record(store: VolatileChatStore, chatId: string) {
  const events: VolatileChatEvent[] = [];
  store.onChatEvent(chatId, (e) => events.push(e));
  return events;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("register starts chat with empty messages", () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  assert.deepEqual(store.messages(meta.id), []);
  assert.equal(store.activeChatCount(), 1);
  store.purge(meta.id);
});

test("append adds message and emits event", () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  const events = record(store, meta.id);

  store.append(meta.id, message(meta.id, "hey"));

  assert.equal(store.messages(meta.id).length, 1);
  assert.equal(events[0].type, "message");
  store.purge(meta.id);
});

test("requestEnd starts warning countdown and auto-purges", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.viewerJoined(meta.id, "u1");
  const events = record(store, meta.id);

  store.requestEnd(meta.id);
  assert.deepEqual(events[0], { type: "expiryWarning", chatId: meta.id, secondsRemaining: 1, reason: "ended" });

  await sleep(1300);
  assert.equal(events.at(-1)?.type, "purged");
  assert.equal(store.chat(meta.id), undefined);
});

test("promote hands off full history then purges memory", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.append(meta.id, message(meta.id, "one"));
  store.append(meta.id, message(meta.id, "two"));

  let received: string[] = [];
  const history = await store.promote(meta.id, async (msgs) => {
    received = msgs.map((m) => m.text!);
  });

  assert.deepEqual(received, ["one", "two"]);
  assert.equal(history.length, 2);
  assert.equal(store.chat(meta.id), undefined);
  assert.equal(store.activeChatCount(), 0);
});

test("a failed promote keeps the chat alive so it can be retried", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.append(meta.id, message(meta.id, "keep me"));

  await assert.rejects(store.promote(meta.id, async () => {
    throw new Error("db down");
  }));
  assert.equal(store.messages(meta.id).length, 1);

  let calls = 0;
  await store.promote(meta.id, async () => {
    calls++;
  });
  assert.equal(calls, 1);
  assert.equal(store.chat(meta.id), undefined);
});

test("concurrent promotes only run the handler once", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);

  let calls = 0;
  const handler = async () => {
    calls++;
    await sleep(20);
  };
  await Promise.all([store.promote(meta.id, handler), store.promote(meta.id, handler)]);
  assert.equal(calls, 1);
});

test("purge leaves no trace of message content", () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.append(meta.id, message(meta.id, "secret"));
  store.viewerJoined(meta.id, "u1");

  store.purge(meta.id);

  assert.deepEqual(store.messages(meta.id), []);
  assert.equal(store.chat(meta.id), undefined);
  assert.equal(store.viewerCount(meta.id), 0);
  assert.equal(store.activeChatCount(), 0);
});

test("a chat nobody opens starts the countdown after the grace period", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  const events = record(store, meta.id);

  await sleep(300);
  assert.equal(events[0]?.type, "expiryWarning");
  assert.equal(store.warningReason(meta.id), "empty");
  store.purge(meta.id);
});

test("everyone leaving starts the countdown, and coming back cancels it", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.viewerJoined(meta.id, "u1");
  store.viewerJoined(meta.id, "u2");
  const events = record(store, meta.id);

  store.viewerLeft(meta.id, "u1");
  await sleep(300);
  assert.equal(events.length, 0, "one viewer is still there");

  store.viewerLeft(meta.id, "u2");
  await sleep(300);
  assert.equal(store.warningReason(meta.id), "empty");

  store.viewerJoined(meta.id, "u2");
  assert.equal(events.at(-1)?.type, "warningCancelled");
  assert.equal(store.warningReason(meta.id), undefined);

  await sleep(1100);
  assert.ok(store.chat(meta.id), "chat survives once someone is back");
  store.purge(meta.id);
});

test("two connections from one user count as one viewer until both close", async () => {
  const store = makeStore();
  const meta = makeMeta();
  store.register(meta);
  store.viewerJoined(meta.id, "u1");
  store.viewerJoined(meta.id, "u1");

  store.viewerLeft(meta.id, "u1");
  await sleep(300);
  assert.equal(store.warningReason(meta.id), undefined);

  store.viewerLeft(meta.id, "u1");
  await sleep(300);
  assert.equal(store.warningReason(meta.id), "empty");
  store.purge(meta.id);
});

test("a new message cancels an inactivity countdown but not an explicit end", async () => {
  const store = makeStore();
  const meta = makeMeta({ inactivityTimeoutSeconds: 0.1 });
  store.register(meta);
  store.viewerJoined(meta.id, "u1");
  const events = record(store, meta.id);

  await sleep(150);
  assert.equal(store.warningReason(meta.id), "inactivity");
  store.append(meta.id, message(meta.id, "still here"));
  assert.ok(events.some((e) => e.type === "warningCancelled"));
  assert.equal(store.warningReason(meta.id), undefined);

  store.requestEnd(meta.id);
  store.append(meta.id, message(meta.id, "wait"));
  assert.equal(store.warningReason(meta.id), "ended");
  store.purge(meta.id);
});
