export class CaptureRequestGuard {
  private sequence = 0;
  private pending = false;

  begin(): number | null {
    if (this.pending) return null;
    this.pending = true;
    return ++this.sequence;
  }

  isCurrent(request: number): boolean {
    return request === this.sequence;
  }

  finish(request: number): void {
    if (this.isCurrent(request)) this.pending = false;
  }

  cancel(): void {
    this.sequence += 1;
    this.pending = false;
  }
}

export type RoomLifecycleToken = Readonly<{ roomId: string; generation: number }>;

let roomLifecycleGeneration = 0;

export function createRoomLifecycleToken(roomId: string): RoomLifecycleToken {
  return { roomId, generation: ++roomLifecycleGeneration };
}

export class RoomLifecycleGuard {
  private activeToken: RoomLifecycleToken | null = null;

  activate(token: RoomLifecycleToken): void {
    this.activeToken = token;
  }

  isActive(token: RoomLifecycleToken): boolean {
    return this.activeToken === token;
  }

  beginLeave(token: RoomLifecycleToken): boolean {
    if (!this.isActive(token)) return false;
    this.activeToken = null;
    return true;
  }

}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.onmute = null;
    track.onunmute = null;
    track.stop();
  }
}

export function closeDataChannel(channel: RTCDataChannel): void {
  channel.onopen = null;
  channel.onclose = null;
  channel.onerror = null;
  channel.onmessage = null;
  if (channel.readyState !== "closed") channel.close();
}

export function closePeerConnection(connection: RTCPeerConnection): void {
  connection.ontrack = null;
  connection.onicecandidate = null;
  connection.onconnectionstatechange = null;
  connection.oniceconnectionstatechange = null;
  connection.ondatachannel = null;
  if (connection.signalingState !== "closed") connection.close();
}
