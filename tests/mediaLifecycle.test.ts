import assert from "node:assert/strict";
import test from "node:test";
import { CaptureRequestGuard, closeDataChannel, closePeerConnection, createRoomLifecycleToken, RoomLifecycleGuard, stopMediaStream } from "../src/lib/mediaLifecycle";

test("room lifecycle tokens reject delayed work from every previous room", () => {
  const lifecycle = new RoomLifecycleGuard();
  const roomA = createRoomLifecycleToken("ABC123");
  lifecycle.activate(roomA);

  assert.equal(lifecycle.isActive(roomA), true);
  assert.equal(lifecycle.beginLeave(roomA), true);
  assert.equal(lifecycle.isActive(roomA), false);
  assert.equal(lifecycle.beginLeave(roomA), false);

  const roomB = createRoomLifecycleToken("XYZ789");
  lifecycle.activate(roomB);
  assert.equal(lifecycle.isActive(roomB), true);
  assert.equal(lifecycle.isActive(roomA), false);
  assert.equal(lifecycle.beginLeave(roomB), true);

  const roomANewVisit = createRoomLifecycleToken("ABC123");
  lifecycle.activate(roomANewVisit);
  assert.equal(lifecycle.isActive(roomANewVisit), true);
  assert.equal(lifecycle.isActive(roomA), false);
});

test("cancelled capture requests reject and stop a stream that resolves late", async () => {
  const capture = new CaptureRequestGuard();
  const request = capture.begin();
  assert.notEqual(request, null);

  let resolveStream: ((stream: MediaStream) => void) | undefined;
  const pendingStream = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
  let stopped = 0;
  const stream = { getTracks: () => [{ onended: null, onmute: null, onunmute: null, stop: () => { stopped += 1; } }] } as unknown as MediaStream;

  capture.cancel();
  resolveStream?.(stream);
  const resolved = await pendingStream;
  if (!capture.isCurrent(request!)) stopMediaStream(resolved);

  assert.equal(stopped, 1);
  assert.equal(capture.begin(), 3);
});

test("stopMediaStream removes handlers and stops every track", () => {
  let stopped = 0;
  const tracks = [0, 1].map(() => ({
    onended: () => undefined,
    onmute: () => undefined,
    onunmute: () => undefined,
    stop: () => { stopped += 1; },
  }));

  stopMediaStream({ getTracks: () => tracks } as unknown as MediaStream);

  assert.equal(stopped, 2);
  for (const track of tracks) {
    assert.equal(track.onended, null);
    assert.equal(track.onmute, null);
    assert.equal(track.onunmute, null);
  }
});

test("closePeerConnection removes callbacks before closing", () => {
  let closed = 0;
  const connection = {
    signalingState: "stable",
    ontrack: () => undefined,
    onicecandidate: () => undefined,
    onconnectionstatechange: () => undefined,
    oniceconnectionstatechange: () => undefined,
    ondatachannel: () => undefined,
    close: () => { closed += 1; },
  };

  closePeerConnection(connection as unknown as RTCPeerConnection);

  assert.equal(closed, 1);
  assert.equal(connection.ontrack, null);
  assert.equal(connection.onicecandidate, null);
  assert.equal(connection.onconnectionstatechange, null);
  assert.equal(connection.oniceconnectionstatechange, null);
  assert.equal(connection.ondatachannel, null);
});

test("closeDataChannel removes callbacks and closes an open channel", () => {
  let closed = 0;
  const channel = {
    readyState: "open",
    onopen: () => undefined,
    onclose: () => undefined,
    onerror: () => undefined,
    onmessage: () => undefined,
    close: () => { closed += 1; },
  };

  closeDataChannel(channel as unknown as RTCDataChannel);

  assert.equal(closed, 1);
  assert.equal(channel.onopen, null);
  assert.equal(channel.onclose, null);
  assert.equal(channel.onerror, null);
  assert.equal(channel.onmessage, null);
});
