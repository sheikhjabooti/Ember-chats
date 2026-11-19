import { test } from "node:test";
import assert from "node:assert/strict";
import { VolatileChatMeta } from "../src/services/volatileChatStore";

// Import a fresh class instance per test file run by requiring the
// module fresh isn't trivial with the exported singleton, so we
// re-implement the constructor access via a tiny factory re-export.
// Simplest: import the class itself, not just the singleton.
import { EventEmitter } from "events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { volatileChatStore } = require("../src/services/volatileChatStore");

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

test("register starts chat with empty messages", () => {
  const meta = makeMeta();
  volatileChatStore.register(meta);
  assert.deepEqual(volatileChatStore.messages(meta.id), []);
  volatileChatStore.purge(meta.id);
});

test("append adds message and emits event", async () => {
  const meta = makeMeta();
  volatileChatStore.register(meta);

  const received: any[] = [];
  const unsubscribe = volatileChatStore.onChatEvent(meta.id, (e: any) => received.push(e));

  volatileChatStore.append(meta.id, {
    id: "m1",
    chatId: meta.id,
    senderId: "u1",
    text: "hey",
    sentAt: new Date().toISOString(),
  });

  assert.equal(volatileChatStore.messages(meta.id).length, 1);
  assert.equal(received[0].type, "message");
  assert.equal(received[0].message.text, "hey");

  unsubscribe();
  volatileChatStore.purge(meta.id);
});

test("requestEnd starts warning countdown and auto-purges", async () => {
  const meta = makeMeta({ id: `chat-warn-${Date.now()}` });
  // Warning window is fixed to config value at module load (default 15s
  // unless BREAKOUT_WARNING_WINDOW_SECONDS is set). For a fast test we
  // rely on the env override applied in package.json's test script, or
  // just wait the full window as an integration-style test.
  volatileChatStore.register(meta);

  let sawWarning = false;
  let sawPurge = false;

  await new Promise<void>((resolve) => {
    const unsubscribe = volatileChatStore.onChatEvent(meta.id, (e: any) => {
      if (e.type === "expiryWarning") sawWarning = true;
      if (e.type === "purged") {
        sawPurge = true;
        unsubscribe();
        resolve();
      }
    });
    volatileChatStore.requestEnd(meta.id);
  });

  assert.equal(sawWarning, true);
  assert.equal(sawPurge, true);
  assert.equal(volatileChatStore.chat(meta.id), undefined);
});

test("promote hands off full history then purges memory", async () => {
  const meta = makeMeta({ id: `chat-promote-${Date.now()}` });
  volatileChatStore.register(meta);

  volatileChatStore.append(meta.id, {
    id: "m1",
    chatId: meta.id,
    senderId: "u1",
    text: "first",
    sentAt: new Date().toISOString(),
  });
  volatileChatStore.append(meta.id, {
    id: "m2",
    chatId: meta.id,
    senderId: "u2",
    text: "second",
    sentAt: new Date().toISOString(),
  });

  let handedOffCount = -1;
  const history = await volatileChatStore.promote(meta.id, async (messages: any[]) => {
    handedOffCount = messages.length;
  });

  assert.equal(history.length, 2);
  assert.equal(handedOffCount, 2);
  assert.deepEqual(volatileChatStore.messages(meta.id), []);
  assert.equal(volatileChatStore.chat(meta.id), undefined);
});

test("purge leaves no trace of message content", () => {
  const meta = makeMeta({ id: `chat-discard-${Date.now()}` });
  volatileChatStore.register(meta);
  volatileChatStore.append(meta.id, {
    id: "m1",
    chatId: meta.id,
    senderId: "u1",
    text: "sensitive content",
    sentAt: new Date().toISOString(),
  });

  volatileChatStore.purge(meta.id);

  assert.deepEqual(volatileChatStore.messages(meta.id), []);
  assert.equal(volatileChatStore.chat(meta.id), undefined);
});
