import type { Room, Participant } from "./types.js";

const rooms = new Map<string, Room>();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I/O/0/1 ambíguos

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  if (rooms.has(code)) return generateRoomCode();
  return code;
}
export function getRoom(roomId: string): Room | undefined { return rooms.get(roomId.toUpperCase()); }
export function createRoom(hostId: string, hostName: string, sessionId: string): Room {
  const id = generateRoomCode();
  const room: Room = { id, hostId, participants: new Map(), createdAt: Date.now(), screenSharing: false, presenceTimers: new Map() };
  const host: Participant = { id: hostId, sessionId, name: hostName, isHost: true, joinedAt: Date.now(), micMuted: true, presence: "online" };
  room.participants.set(hostId, host);
  rooms.set(id, room);
  return room;
}
export function addParticipant(roomId: string, socketId: string, name: string, sessionId: string): Participant | null {
  const room = getRoom(roomId);
  if (!room) return null;
  if (room.participants.size >= 5) return null;
  const p: Participant = { id: socketId, sessionId, name, isHost: false, joinedAt: Date.now(), micMuted: true, presence: "online" };
  room.participants.set(socketId, p);
  return p;
}
export function removeParticipant(roomId: string, socketId: string): { room: Room | undefined; wasHost: boolean } {
  const room = getRoom(roomId);
  if (!room) return { room: undefined, wasHost: false };
  const wasHost = room.participants.get(socketId)?.isHost ?? false;
  const timer = room.presenceTimers.get(socketId);
  if (timer) { clearTimeout(timer); room.presenceTimers.delete(socketId); }
  room.participants.delete(socketId);
  if (room.participants.size === 0) { rooms.delete(room.id); return { room: undefined, wasHost }; }
  if (wasHost) {
    const next = [...room.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) { next.isHost = true; room.hostId = next.id; }
  }
  return { room, wasHost };
}

export function findParticipantBySession(roomId: string, sessionId: string): Participant | undefined {
  const room = getRoom(roomId);
  if (!room) return undefined;
  return [...room.participants.values()].find((participant) => participant.sessionId === sessionId);
}

export function reconnectParticipant(roomId: string, oldSocketId: string, newSocketId: string, name: string, sessionId: string): Participant | null {
  const room = getRoom(roomId);
  const participant = findParticipantBySession(roomId, sessionId);
  if (!room || !participant || participant.id !== oldSocketId) return null;
  const timer = room.presenceTimers.get(oldSocketId);
  if (timer) { clearTimeout(timer); room.presenceTimers.delete(oldSocketId); }
  room.participants.delete(oldSocketId);
  participant.id = newSocketId;
  participant.name = name;
  participant.presence = "online";
  room.participants.set(newSocketId, participant);
  if (room.hostId === oldSocketId) room.hostId = newSocketId;
  return participant;
}

export function markReconnecting(roomId: string, socketId: string, onExpired: () => void): Room | undefined {
  const room = getRoom(roomId);
  const participant = room?.participants.get(socketId);
  if (!room || !participant) return undefined;
  participant.presence = "reconnecting";
  const existing = room.presenceTimers.get(socketId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    const current = room.participants.get(socketId);
    if (!current || current.presence !== "reconnecting") return;
    current.presence = "offline";
    onExpired();
  }, 15_000);
  room.presenceTimers.set(socketId, timer);
  return room;
}
export function getParticipants(roomId: string): Participant[] {
  const r = getRoom(roomId);
  return r ? [...r.participants.values()] : [];
}
export function getRoomBySocket(socketId: string): Room | undefined {
  for (const r of rooms.values()) if (r.participants.has(socketId)) return r;
  return undefined;
}
