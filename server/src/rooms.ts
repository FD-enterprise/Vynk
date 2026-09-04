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
export function createRoom(hostId: string, hostName: string): Room {
  const id = generateRoomCode();
  const room: Room = { id, hostId, participants: new Map(), createdAt: Date.now(), screenSharing: false };
  const host: Participant = { id: hostId, name: hostName, isHost: true, joinedAt: Date.now(), micMuted: true };
  room.participants.set(hostId, host);
  rooms.set(id, room);
  return room;
}
export function addParticipant(roomId: string, socketId: string, name: string): Participant | null {
  const room = getRoom(roomId);
  if (!room) return null;
  if (room.participants.size >= 5) return null;
  const p: Participant = { id: socketId, name, isHost: false, joinedAt: Date.now(), micMuted: true };
  room.participants.set(socketId, p);
  return p;
}
export function removeParticipant(roomId: string, socketId: string): { room: Room | undefined; wasHost: boolean } {
  const room = getRoom(roomId);
  if (!room) return { room: undefined, wasHost: false };
  const wasHost = room.participants.get(socketId)?.isHost ?? false;
  room.participants.delete(socketId);
  if (room.participants.size === 0) { rooms.delete(room.id); return { room: undefined, wasHost }; }
  if (wasHost) {
    const next = [...room.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) { next.isHost = true; room.hostId = next.id; }
  }
  return { room, wasHost };
}
export function getParticipants(roomId: string): Participant[] {
  const r = getRoom(roomId);
  return r ? [...r.participants.values()] : [];
}
export function getRoomBySocket(socketId: string): Room | undefined {
  for (const r of rooms.values()) if (r.participants.has(socketId)) return r;
  return undefined;
}
