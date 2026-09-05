import assert from "node:assert/strict";
import test from "node:test";
import { addChatMessage, addParticipant, createRoom, getChatMessages, getRoom, markReconnecting, MAX_CHAT_HISTORY, reconnectParticipant, removeParticipant } from "../server/src/rooms";

test("room lifecycle removes, reconnects, transfers host, and deletes an empty room", () => {
  const room = createRoom("host-old", "Host", "host-session");
  const guest = addParticipant(room.id, "guest-old", "Guest", "guest-session");
  assert.ok(guest);
  assert.equal(getRoom(room.id)?.participants.size, 2);

  removeParticipant(room.id, "guest-old");
  assert.equal(getRoom(room.id)?.participants.size, 1);

  const reenteredGuest = addParticipant(room.id, "guest-new", "Guest", "guest-session");
  assert.ok(reenteredGuest);
  assert.equal(getRoom(room.id)?.participants.size, 2);

  markReconnecting(room.id, "host-old", () => undefined);
  const reconnectedHost = reconnectParticipant(room.id, "host-old", "host-new", "Host", "host-session");
  assert.equal(reconnectedHost?.presence, "online");
  assert.equal(getRoom(room.id)?.hostId, "host-new");

  const afterHostLeave = removeParticipant(room.id, "host-new");
  assert.equal(afterHostLeave.wasHost, true);
  assert.equal(afterHostLeave.room?.hostId, "guest-new");
  assert.equal(afterHostLeave.room?.participants.get("guest-new")?.isHost, true);

  const afterLastLeave = removeParticipant(room.id, "guest-new");
  assert.equal(afterLastLeave.room, undefined);
  assert.equal(getRoom(room.id), undefined);
});

test("room keeps a bounded chat history that can be replayed after refresh", () => {
  const room = createRoom("chat-host", "Host", "chat-host-session");

  for (let index = 0; index < MAX_CHAT_HISTORY + 5; index += 1) {
    addChatMessage(room.id, {
      id: `message-${index}`,
      roomId: room.id,
      authorId: "chat-host",
      authorName: "Host",
      text: `Mensagem ${index}`,
      timestamp: index,
    });
  }

  const history = getChatMessages(room.id);
  assert.equal(history.length, MAX_CHAT_HISTORY);
  assert.equal(history[0]?.id, "message-5");
  assert.equal(history.at(-1)?.id, `message-${MAX_CHAT_HISTORY + 4}`);

  history.pop();
  assert.equal(getChatMessages(room.id).length, MAX_CHAT_HISTORY);

  removeParticipant(room.id, "chat-host");
});
