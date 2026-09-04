import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { EVENTS, MAX_PARTICIPANTS, MAX_CHAT_MESSAGE_LENGTH, MAX_SOCKET_PAYLOAD_BYTES } from "./events.js";
import { roomCreateSchema, roomJoinSchema, roomLeaveSchema, chatSendSchema, offerSchema, answerSchema, iceCandidateSchema, screenStateSchema, microphoneStateSchema } from "./validation.js";
import { createRoom, getRoom, addParticipant, removeParticipant, getParticipants, getRoomBySocket, findParticipantBySession, reconnectParticipant, markReconnecting } from "./rooms.js";
import type { ChatMessage } from "./types.js";

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || "*";

const app = express();
app.use(cors({ origin: CLIENT_URL === "*" ? true : CLIENT_URL }));
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime(), service: "vynk-signaling" }));
app.get("/", (_req, res) => res.json({ ok: true, service: "vynk-signaling", docs: "/health" }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_URL === "*" ? true : CLIENT_URL, methods: ["GET", "POST"] }, maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES });

const rateTimestamps = new Map<string, number[]>();
function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = rateTimestamps.get(key) ?? [];
  const recent = arr.filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  rateTimestamps.set(key, recent);
  return false;
}
function clearSocketRateLimits(socketId: string): void {
  for (const key of rateTimestamps.keys()) if (key.endsWith(`:${socketId}`)) rateTimestamps.delete(key);
}
function getAuthorizedParticipant(socketId: string, roomId: string) {
  const room = getRoom(roomId);
  if (!room) return null;
  const participant = room.participants.get(socketId);
  return participant ? { room, participant } : null;
}
function emitParticipants(roomId: string) {
  const participants = getParticipants(roomId);
  io.to(roomId).emit(EVENTS.ROOM_PARTICIPANTS, { roomId, participants });
  io.to(roomId).emit(EVENTS.PRESENCE_UPDATE, { roomId, participants });
}

io.on("connection", (socket) => {
  socket.on(EVENTS.ROOM_CREATE, (payload: unknown) => {
    if (isRateLimited(`room:create:${socket.id}`, 5, 60_000)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas tentativas. Aguarde um minuto." }); return; }
    const parsed = roomCreateSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const room = createRoom(socket.id, parsed.data.name, parsed.data.sessionId);
    socket.join(room.id);
    socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, hostId: room.hostId });
    socket.emit(EVENTS.ROOM_JOINED, { roomId: room.id, participantId: socket.id, participants: getParticipants(room.id) });
    emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_JOIN, (payload: unknown) => {
    if (isRateLimited(`room:join:${socket.id}`, 20, 60_000)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas tentativas de entrada. Aguarde um minuto." }); return; }
    const parsed = roomJoinSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const { roomId, name } = parsed.data;
    const upper = roomId.toUpperCase();
    const room = getRoom(upper);
    if (!room) { socket.emit(EVENTS.ROOM_ERROR, { message: "Sala não encontrada." }); return; }
    const previous = findParticipantBySession(upper, parsed.data.sessionId);
    if (previous && previous.id !== socket.id && previous.presence !== "online") {
      const participant = reconnectParticipant(upper, previous.id, socket.id, name, parsed.data.sessionId);
      if (!participant) { socket.emit(EVENTS.ROOM_ERROR, { message: "Não foi possível recuperar sua presença." }); return; }
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper) });
      emitParticipants(upper);
      return;
    }
    if (previous && previous.id !== socket.id && previous.presence === "online") {
      socket.emit(EVENTS.ROOM_ERROR, { message: "Este participante já está conectado." });
      return;
    }
    if (room.participants.has(socket.id)) {
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper) });
      return;
    }
    if (room.participants.size >= MAX_PARTICIPANTS) { socket.emit(EVENTS.ROOM_ERROR, { message: `Sala cheia (máx. ${MAX_PARTICIPANTS} participantes).` }); return; }
    const p = addParticipant(upper, socket.id, name, parsed.data.sessionId);
    if (!p) { socket.emit(EVENTS.ROOM_ERROR, { message: "Não foi possível entrar na sala." }); return; }
    socket.join(upper);
    socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper) });
    emitParticipants(upper);
  });

  socket.on(EVENTS.ROOM_LEAVE, (payload: unknown) => {
    const parsed = roomLeaveSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    if (!authorized) return;
    const { room: remaining, wasHost } = removeParticipant(roomId, socket.id);
    socket.leave(roomId);
    if (remaining) {
      emitParticipants(remaining.id);
      if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { hostId: remaining.hostId });
    }
  });

  socket.on(EVENTS.WEBRTC_OFFER, (payload: unknown) => {
    const parsed = offerSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, sdp } = parsed.data;
    if (isRateLimited(`webrtc:offer:${socket.id}`, 20, 10_000)) return;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_OFFER, { fromId: socket.id, roomId, sdp });
  });
  socket.on(EVENTS.WEBRTC_ANSWER, (payload: unknown) => {
    const parsed = answerSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, sdp } = parsed.data;
    if (isRateLimited(`webrtc:answer:${socket.id}`, 20, 10_000)) return;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_ANSWER, { fromId: socket.id, roomId, sdp });
  });
  socket.on(EVENTS.WEBRTC_ICE_CANDIDATE, (payload: unknown) => {
    const parsed = iceCandidateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, targetId, candidate } = parsed.data;
    if (isRateLimited(`webrtc:ice:${socket.id}`, 120, 10_000)) return;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || !room.participants.has(targetId)) return;
    io.to(targetId).emit(EVENTS.WEBRTC_ICE_CANDIDATE, { fromId: socket.id, roomId, candidate });
  });

  socket.on(EVENTS.SCREEN_STARTED, (payload: unknown) => {
    const parsed = screenStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || room.hostId !== socket.id) { socket.emit(EVENTS.ROOM_ERROR, { message: "Apenas o host pode compartilhar a tela." }); return; }
    room.screenSharing = true;
    socket.to(roomId).emit(EVENTS.SCREEN_STARTED, { roomId, hostId: socket.id });
  });
  socket.on(EVENTS.SCREEN_STOPPED, (payload: unknown) => {
    const parsed = screenStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const room = getAuthorizedParticipant(socket.id, roomId)?.room;
    if (!room || room.hostId !== socket.id) return;
    room.screenSharing = false;
    io.to(roomId).emit(EVENTS.SCREEN_STOPPED, { roomId });
  });

  socket.on(EVENTS.MICROPHONE_STATE, (payload: unknown) => {
    const parsed = microphoneStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, muted } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    if (!authorized) return;
    const { room, participant } = authorized;
    participant.micMuted = muted;
    socket.to(roomId).emit(EVENTS.MICROPHONE_STATE, { roomId, participantId: socket.id, muted });
    emitParticipants(roomId);
  });

  socket.on(EVENTS.CHAT_SEND, (payload: unknown) => {
    const parsed = chatSendSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, text } = parsed.data;
    const upper = roomId.toUpperCase();
    const authorized = getAuthorizedParticipant(socket.id, upper);
    if (!authorized) return;
    const { room, participant: author } = authorized;
    if (isRateLimited(`chat:${socket.id}`, 5, 10_000)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas mensagens. Aguarde um pouco." }); return; }
    const msg: ChatMessage = { id: `${Date.now()}-${socket.id.slice(0, 4)}`, roomId: upper, authorId: socket.id, authorName: author.name, text: text.slice(0, MAX_CHAT_MESSAGE_LENGTH), timestamp: Date.now() };
    io.to(upper).emit(EVENTS.CHAT_MESSAGE, msg);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) { clearSocketRateLimits(socket.id); return; }
    const pendingRoom = markReconnecting(room.id, socket.id, () => {
      emitParticipants(room.id);
      setTimeout(() => {
        const current = getRoom(room.id);
        const participant = current?.participants.get(socket.id);
        if (!current || !participant || participant.presence !== "offline") return;
        const { room: remaining, wasHost } = removeParticipant(room.id, socket.id);
        if (remaining) {
          emitParticipants(remaining.id);
          if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { hostId: remaining.hostId });
        }
      }, 5_000);
    });
    clearSocketRateLimits(socket.id);
    if (pendingRoom) emitParticipants(pendingRoom.id);
  });
});

httpServer.listen(PORT, () => console.log(`[vynk-signaling] listening on :${PORT} (client: ${CLIENT_URL})`));
