import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { EVENTS } from "./events.js";
import { roomCreateSchema, roomJoinSchema, chatSendSchema, offerSchema, answerSchema, iceCandidateSchema } from "./validation.js";
import { createRoom, getRoom, addParticipant, removeParticipant, getParticipants, getRoomBySocket } from "./rooms.js";
import type { ChatMessage } from "./types.js";

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || "*";

const app = express();
app.use(cors({ origin: CLIENT_URL === "*" ? true : CLIENT_URL }));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime(), service: "vynk-signaling" }));
app.get("/", (_req, res) => res.json({ ok: true, service: "vynk-signaling", docs: "/health" }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_URL === "*" ? true : CLIENT_URL, methods: ["GET", "POST"] } });

const chatTimestamps = new Map<string, number[]>();
function isRateLimited(id: string): boolean {
  const now = Date.now();
  const arr = chatTimestamps.get(id) ?? [];
  const recent = arr.filter((t) => now - t < 10_000);
  if (recent.length >= 5) return true;
  recent.push(now);
  chatTimestamps.set(id, recent);
  return false;
}
function emitParticipants(roomId: string) {
  const participants = getParticipants(roomId);
  io.to(roomId).emit(EVENTS.ROOM_PARTICIPANTS, { roomId, participants });
  io.to(roomId).emit(EVENTS.PRESENCE_UPDATE, { roomId, participants });
}

io.on("connection", (socket) => {
  socket.on(EVENTS.ROOM_CREATE, (payload: unknown) => {
    const parsed = roomCreateSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const room = createRoom(socket.id, parsed.data.name);
    socket.join(room.id);
    socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, hostId: room.hostId });
    socket.emit(EVENTS.ROOM_JOINED, { roomId: room.id, participantId: socket.id, participants: getParticipants(room.id) });
    emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_JOIN, (payload: unknown) => {
    const parsed = roomJoinSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const { roomId, name } = parsed.data;
    const upper = roomId.toUpperCase();
    const room = getRoom(upper);
    if (!room) { socket.emit(EVENTS.ROOM_ERROR, { message: "Sala não encontrada." }); return; }
    if (room.participants.size >= 5) { socket.emit(EVENTS.ROOM_ERROR, { message: "Sala cheia (máx. 5 participantes)." }); return; }
    if (room.participants.has(socket.id)) {
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper) });
      return;
    }
    const p = addParticipant(upper, socket.id, name);
    if (!p) { socket.emit(EVENTS.ROOM_ERROR, { message: "Não foi possível entrar na sala." }); return; }
    socket.join(upper);
    socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper) });
    emitParticipants(upper);
  });

  socket.on(EVENTS.ROOM_LEAVE, (payload: unknown) => {
    const roomId = (payload as { roomId?: string })?.roomId?.toUpperCase();
    if (!roomId) {
      const r = getRoomBySocket(socket.id);
      if (r) {
        const { room } = removeParticipant(r.id, socket.id);
        socket.leave(r.id);
        if (room) { emitParticipants(room.id); io.to(room.id).emit(EVENTS.ROOM_HOST_CHANGED, { hostId: room.hostId }); }
      }
      return;
    }
    const { room } = removeParticipant(roomId, socket.id);
    socket.leave(roomId);
    if (room) { emitParticipants(room.id); io.to(room.id).emit(EVENTS.ROOM_HOST_CHANGED, { hostId: room.hostId }); }
  });

  socket.on(EVENTS.WEBRTC_OFFER, (payload: unknown) => {
    const parsed = offerSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, sdp } = parsed.data;
    const room = getRoom(roomId);
    if (!room || !room.participants.has(socket.id) || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_OFFER, { fromId: socket.id, roomId, sdp });
  });
  socket.on(EVENTS.WEBRTC_ANSWER, (payload: unknown) => {
    const parsed = answerSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, sdp } = parsed.data;
    const room = getRoom(roomId);
    if (!room || !room.participants.has(socket.id) || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_ANSWER, { fromId: socket.id, roomId, sdp });
  });
  socket.on(EVENTS.WEBRTC_ICE_CANDIDATE, (payload: unknown) => {
    const parsed = iceCandidateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, candidate } = parsed.data;
    const room = getRoom(roomId);
    if (!room || !room.participants.has(socket.id) || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_ICE_CANDIDATE, { fromId: socket.id, roomId, candidate });
  });

  socket.on(EVENTS.SCREEN_STARTED, (payload: unknown) => {
    const roomId = (payload as { roomId?: string })?.roomId?.toUpperCase();
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) { socket.emit(EVENTS.ROOM_ERROR, { message: "Apenas o host pode compartilhar a tela." }); return; }
    room.screenSharing = true;
    socket.to(roomId).emit(EVENTS.SCREEN_STARTED, { roomId, hostId: socket.id });
  });
  socket.on(EVENTS.SCREEN_STOPPED, (payload: unknown) => {
    const roomId = (payload as { roomId?: string })?.roomId?.toUpperCase();
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;
    room.screenSharing = false;
    io.to(roomId).emit(EVENTS.SCREEN_STOPPED, { roomId });
  });

  socket.on(EVENTS.CHAT_SEND, (payload: unknown) => {
    const parsed = chatSendSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, text } = parsed.data;
    const upper = roomId.toUpperCase();
    const room = getRoom(upper);
    if (!room || !room.participants.has(socket.id)) return;
    if (isRateLimited(socket.id)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas mensagens. Aguarde um pouco." }); return; }
    const author = room.participants.get(socket.id);
    if (!author) return;
    const msg: ChatMessage = { id: `${Date.now()}-${socket.id.slice(0, 4)}`, roomId: upper, authorId: socket.id, authorName: author.name, text: text.slice(0, 500), timestamp: Date.now() };
    io.to(upper).emit(EVENTS.CHAT_MESSAGE, msg);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) { chatTimestamps.delete(socket.id); return; }
    const { room: remaining } = removeParticipant(room.id, socket.id);
    chatTimestamps.delete(socket.id);
    if (remaining) { emitParticipants(remaining.id); io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { hostId: remaining.hostId }); }
  });
});

httpServer.listen(PORT, () => console.log(`[vynk-signaling] listening on :${PORT} (client: ${CLIENT_URL})`));
