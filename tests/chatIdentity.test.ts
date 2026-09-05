import assert from "node:assert/strict";
import test from "node:test";
import { isOwnChatMessage } from "../src/lib/chatIdentity";

test("chat identity survives a socket id change after refresh", () => {
  const message = { authorId: "old-socket", authorSessionId: "stable-session" };

  assert.equal(isOwnChatMessage(message, "stable-session", "new-socket"), true);
  assert.equal(isOwnChatMessage(message, "another-session", "new-socket"), false);
});

test("chat identity falls back to socket id for older messages", () => {
  assert.equal(isOwnChatMessage({ authorId: "current-socket" }, "stable-session", "current-socket"), true);
  assert.equal(isOwnChatMessage({ authorId: "old-socket" }, "stable-session", "current-socket"), false);
});
