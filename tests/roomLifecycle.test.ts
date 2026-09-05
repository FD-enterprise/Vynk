import assert from "node:assert/strict";
import test from "node:test";
import { addParticipant, createRoom, getRoom, markReconnecting, reconnectParticipant, removeParticipant } from "../server/src/rooms";

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
