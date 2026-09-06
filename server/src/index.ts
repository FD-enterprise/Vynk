import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { EVENTS, MAX_PARTICIPANTS, MAX_CHAT_MESSAGE_LENGTH, MAX_SOCKET_PAYLOAD_BYTES } from "./events.js";
import { roomCreateSchema, roomJoinSchema, roomLeaveSchema, chatSendSchema, offerSchema, answerSchema, iceCandidateSchema, screenStateSchema, screenPermissionSchema, microphoneStateSchema } from "./validation.js";
import { createRoom, getRoom, addParticipant, removeParticipant, getParticipants, getRoomBySocket, findParticipantBySession, reconnectParticipant, markReconnecting, addChatMessage, getChatMessages } from "./rooms.js";
import type { ChatMessage } from "./types.js";

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || "*";

const app = express();
app.use(cors({ origin: CLIENT_URL === "*" ? true : CLIENT_URL }));
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime(), service: "vynk-signaling" }));
app.get("/", (_req, res) => res.json({ ok: true, service: "vynk-signaling", docs: "/health" }));

type IceServer = { urls: string | string[]; username?: string; credential?: string };
const TURN_CREDENTIAL_TTL_SECONDS = 86_400;
const TURN_CACHE_MS = 60 * 60 * 1000;
let cachedTurn: { iceServers: IceServer[]; expiresAt: number } | null = null;
let turnRequest: Promise<IceServer[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIceServers(payload: unknown): IceServer[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.iceServers)) return null;
  const iceServers = payload.iceServers.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value)) return false;
    const urls = value.urls;
    const hasValidUrls = typeof urls === "string" && urls.length > 0
      || Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === "string" && url.length > 0);
    return hasValidUrls
      && (value.username === undefined || typeof value.username === "string")
      && (value.credential === undefined || typeof value.credential === "string");
  });
  return iceServers.length > 0 ? iceServers as IceServer[] : null;
}

async function generateTurnIceServers(): Promise<IceServer[]> {
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  if (!token || !keyId) throw new Error("Cloudflare TURN is not configured");

  if (cachedTurn && cachedTurn.expiresAt > Date.now()) return cachedTurn.iceServers;
  if (turnRequest) return turnRequest;

  turnRequest = (async () => {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
    });
    if (!response.ok) throw new Error(`Cloudflare TURN returned ${response.status}`);
    const iceServers = parseIceServers(await response.json());
    if (!iceServers) throw new Error("Cloudflare TURN returned invalid ice servers");
    cachedTurn = { iceServers, expiresAt: Date.now() + TURN_CACHE_MS };
    return iceServers;
  })();

  try {
    return await turnRequest;
  } finally {
    turnRequest = null;
  }
}

app.get("/turn", async (_req, res) => {
  if (!process.env.CLOUDFLARE_TURN_API_TOKEN || !process.env.CLOUDFLARE_TURN_KEY_ID) {
    res.status(503).json({ error: "TURN is not configured" });
    return;
  }
  try {
    res.set("Cache-Control", "no-store");
    res.json({ iceServers: await generateTurnIceServers() });
  } catch (error) {
    console.error("[vynk-signaling] failed to generate TURN credentials", error);
    res.status(502).json({ error: "Could not generate TURN credentials" });
  }
});

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
    socket.emit(EVENTS.ROOM_JOINED, { roomId: room.id, participantId: socket.id, participants: getParticipants(room.id), chatMessages: getChatMessages(room.id), screenSharerId: room.screenSharerId });
    emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_JOIN, (payload: unknown) => {
    if (isRateLimited(`room:join:${socket.id}`, 20, 60_000)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas tentativas de entrada. Aguarde um minuto." }); return; }
    const parsed = roomJoinSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const { roomId, name } = parsed.data;
    const upper = roomId.toUpperCase();
    const room = getRoom(upper);
    if (!room) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: "Sala não encontrada." }); return; }
    const previous = findParticipantBySession(upper, parsed.data.sessionId);
    if (previous && previous.id !== socket.id) {
      const previousSocketId = previous.id;
      const participant = reconnectParticipant(upper, previousSocketId, socket.id, name, parsed.data.sessionId);
      if (!participant) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: "Não foi possível recuperar sua presença." }); return; }
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      previousSocket?.leave(upper);
      previousSocket?.disconnect(true);
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper), chatMessages: getChatMessages(upper), screenSharerId: room.screenSharerId });
      emitParticipants(upper);
      return;
    }
    if (room.participants.has(socket.id)) {
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper), chatMessages: getChatMessages(upper), screenSharerId: room.screenSharerId });
      return;
    }
    if (room.participants.size >= MAX_PARTICIPANTS) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: `Sala cheia (máx. ${MAX_PARTICIPANTS} participantes).` }); return; }
    const p = addParticipant(upper, socket.id, name, parsed.data.sessionId);
    if (!p) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: "Não foi possível entrar na sala." }); return; }
    socket.join(upper);
    socket.emit(EVENTS.ROOM_JOINED, { roomId: upper, participantId: socket.id, participants: getParticipants(upper), chatMessages: getChatMessages(upper), screenSharerId: room.screenSharerId });
    emitParticipants(upper);
  });

  socket.on(EVENTS.ROOM_LEAVE, (payload: unknown) => {
    const parsed = roomLeaveSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    if (!authorized) return;
    const wasScreenSharer = authorized.room.screenSharerId === socket.id;
    if (wasScreenSharer) {
      authorized.room.screenSharing = false;
      authorized.room.screenSharerId = null;
      io.to(roomId).emit(EVENTS.SCREEN_STOPPED, { roomId, sharerId: socket.id });
    }
    const { room: remaining, wasHost } = removeParticipant(roomId, socket.id);
    socket.leave(roomId);
    if (remaining) {
      emitParticipants(remaining.id);
      if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { roomId: remaining.id, hostId: remaining.hostId });
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

  socket.on(EVENTS.SCREEN_REQUEST, (payload: unknown) => {
    const parsed = screenStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    if (isRateLimited(`screen:request:${socket.id}`, 5, 10_000)) return;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    if (!authorized || authorized.participant.isHost || authorized.participant.canShareScreen) return;
    const host = authorized.room.participants.get(authorized.room.hostId);
    if (host) io.to(host.id).emit(EVENTS.SCREEN_REQUEST, { roomId, participantId: socket.id, participantName: authorized.participant.name });
  });

  socket.on(EVENTS.SCREEN_PERMISSION, (payload: unknown) => {
    const parsed = screenPermissionSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, participantId, allowed } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || room.hostId !== socket.id) return;
    const target = room.participants.get(participantId);
    if (!target || target.isHost) return;
    target.canShareScreen = allowed;
    if (!allowed && room.screenSharerId === target.id) {
      room.screenSharing = false;
      room.screenSharerId = null;
      io.to(roomId).emit(EVENTS.SCREEN_STOPPED, { roomId, sharerId: target.id });
    }
    io.to(target.id).emit(EVENTS.SCREEN_PERMISSION, { roomId, participantId: target.id, allowed });
    emitParticipants(roomId);
  });

  socket.on(EVENTS.SCREEN_STARTED, (payload: unknown) => {
    const parsed = screenStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    const room = authorized?.room;
    if (!room || (!authorized.participant.isHost && !authorized.participant.canShareScreen)) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "O host ainda não autorizou sua transmissão." }); return; }
    if (room.screenSharing && room.screenSharerId !== socket.id) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "Outra pessoa já está transmitindo a tela." }); return; }
    room.screenSharing = true;
    room.screenSharerId = socket.id;
    io.to(roomId).emit(EVENTS.SCREEN_STARTED, { roomId, sharerId: socket.id });
  });
  socket.on(EVENTS.SCREEN_STOPPED, (payload: unknown) => {
    const parsed = screenStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId } = parsed.data;
    const room = getAuthorizedParticipant(socket.id, roomId)?.room;
    if (!room || (room.hostId !== socket.id && room.screenSharerId !== socket.id)) return;
    room.screenSharing = false;
    const sharerId = room.screenSharerId;
    room.screenSharerId = null;
    io.to(roomId).emit(EVENTS.SCREEN_STOPPED, { roomId, sharerId });
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
    if (isRateLimited(`chat:${socket.id}`, 5, 10_000)) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: "Muitas mensagens. Aguarde um pouco." }); return; }
    const msg: ChatMessage = { id: `${Date.now()}-${socket.id.slice(0, 4)}`, roomId: upper, authorId: socket.id, authorSessionId: author.sessionId, authorName: author.name, text: text.slice(0, MAX_CHAT_MESSAGE_LENGTH), timestamp: Date.now() };
    addChatMessage(upper, msg);
    io.to(upper).emit(EVENTS.CHAT_MESSAGE, msg);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) { clearSocketRateLimits(socket.id); return; }
    if (room.screenSharerId === socket.id) {
      room.screenSharing = false;
      room.screenSharerId = null;
      io.to(room.id).emit(EVENTS.SCREEN_STOPPED, { roomId: room.id, sharerId: socket.id });
    }
    const pendingRoom = markReconnecting(room.id, socket.id, () => {
      emitParticipants(room.id);
      setTimeout(() => {
        const current = getRoom(room.id);
        const participant = current?.participants.get(socket.id);
        if (!current || !participant || participant.presence !== "offline") return;
        const { room: remaining, wasHost } = removeParticipant(room.id, socket.id);
        if (remaining) {
          emitParticipants(remaining.id);
          if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { roomId: remaining.id, hostId: remaining.hostId });
        }
      }, 5_000);
    });
    clearSocketRateLimits(socket.id);
    if (pendingRoom) emitParticipants(pendingRoom.id);
  });
});

httpServer.listen(PORT, () => console.log(`[vynk-signaling] listening on :${PORT} (client: ${CLIENT_URL})`));
