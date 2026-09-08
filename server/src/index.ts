import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { EVENTS, MAX_PARTICIPANTS, MAX_CHAT_MESSAGE_LENGTH, MAX_SOCKET_PAYLOAD_BYTES } from "./events.js";
import { roomCreateSchema, roomJoinSchema, roomJoinDecisionSchema, roomJoinSettingsSchema, roomJoinLockSchema, roomParticipantActionSchema, roomParticipantMuteSchema, roomLeaveSchema, chatSendSchema, offerSchema, answerSchema, iceCandidateSchema, screenStateSchema, screenPermissionSchema, microphoneStateSchema, audioOutputStateSchema } from "./validation.js";
import { closeRoom, createRoom, getRoom, addParticipant, removeParticipant, getParticipants, getRoomBySocket, getPublicRooms, removeJoinRequestsBySocket, findParticipantBySession, reconnectParticipant, markReconnecting, addChatMessage, getChatMessages, setJoinLocked, setParticipantForceMuted, transferHost } from "./rooms.js";
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

function joinedPayload(room: NonNullable<ReturnType<typeof getRoom>>, participantId: string) {
  return {
    roomId: room.id,
    participantId,
    participants: getParticipants(room.id),
    chatMessages: getChatMessages(room.id),
    screenSharerId: room.screenSharerId,
    joinRequestNotificationsEnabled: room.joinRequestNotificationsEnabled,
    joinLocked: room.joinLocked,
  };
}

io.on("connection", (socket) => {
  const queueJoinRequest = (room: NonNullable<ReturnType<typeof getRoom>>, name: string, sessionId: string) => {
    const host = io.sockets.sockets.get(room.hostId);
    if (!host?.connected) {
      socket.emit(EVENTS.ROOM_ERROR, { roomId: room.id, message: "O host está desconectado no momento." });
      return;
    }
    const existing = [...room.joinRequests.values()].find((request) => request.sessionId === sessionId);
    if (existing) {
      socket.emit(EVENTS.ROOM_JOIN_PENDING, { roomId: room.id, message: existing.approved ? "Entrada aprovada. Reconectando à sala…" : "Pedido enviado. Aguarde a aprovação do host." });
      return;
    }
    const request = { socketId: socket.id, sessionId, name, requestedAt: Date.now() };
    room.joinRequests.set(socket.id, request);
    setTimeout(() => {
      if (room.joinRequests.get(socket.id) === request) room.joinRequests.delete(socket.id);
    }, 60_000);
    socket.emit(EVENTS.ROOM_JOIN_PENDING, { roomId: room.id, message: "Pedido enviado. Aguarde a aprovação do host." });
    if (!room.joinRequestNotificationsEnabled) return;
    host.emit(EVENTS.ROOM_JOIN_REQUEST, { roomId: room.id, participantId: socket.id, participantName: name });
  };

  const emitPendingJoinRequests = (room: NonNullable<ReturnType<typeof getRoom>>) => {
    if (!room.joinRequestNotificationsEnabled) return;
    const host = io.sockets.sockets.get(room.hostId);
    if (!host?.connected) return;
    for (const request of room.joinRequests.values()) host.emit(EVENTS.ROOM_JOIN_REQUEST, { roomId: room.id, participantId: request.socketId, participantName: request.name });
  };

  socket.on(EVENTS.ROOM_LIST_REQUEST, () => {
    if (isRateLimited(`room:list:${socket.id}`, 10, 60_000)) return;
    socket.emit(EVENTS.ROOM_LIST, { rooms: getPublicRooms() });
  });

  socket.on(EVENTS.ROOM_CREATE, (payload: unknown) => {
    removeJoinRequestsBySocket(socket.id);
    if (isRateLimited(`room:create:${socket.id}`, 5, 60_000)) { socket.emit(EVENTS.ROOM_ERROR, { message: "Muitas tentativas. Aguarde um minuto." }); return; }
    const parsed = roomCreateSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    const room = createRoom(socket.id, parsed.data.name, parsed.data.sessionId);
    socket.join(room.id);
    socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, hostId: room.hostId });
    socket.emit(EVENTS.ROOM_JOINED, joinedPayload(room, socket.id));
    emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_JOIN_REQUEST, (payload: unknown) => {
    if (isRateLimited(`room:join-request:${socket.id}`, 10, 60_000)) return;
    const parsed = roomJoinSchema.safeParse(payload);
    if (!parsed.success) { socket.emit(EVENTS.ROOM_ERROR, { message: parsed.error.issues[0]?.message ?? "Dados inválidos" }); return; }
    removeJoinRequestsBySocket(socket.id);
    const { roomId, name, sessionId } = parsed.data;
    const room = getRoom(roomId);
    if (!room) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "Sala não encontrada." }); return; }
    if (room.participants.has(socket.id)) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "Você já está nesta sala." }); return; }
    if (room.participants.size >= MAX_PARTICIPANTS) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "Sala cheia." }); return; }
    const pendingRequest = [...room.joinRequests.entries()].find(([, request]) => request.sessionId === sessionId);
    if (pendingRequest?.[1].approved) {
      room.joinRequests.delete(pendingRequest[0]);
      const participant = addParticipant(roomId, socket.id, name, sessionId);
      if (!participant) { socket.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: false, message: "Não foi possível entrar na sala." }); return; }
      socket.join(roomId);
      socket.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: true, message: "Entrada aprovada pelo host." });
      socket.emit(EVENTS.ROOM_JOINED, joinedPayload(room, socket.id));
      emitParticipants(roomId);
      return;
    }
    if (pendingRequest) {
      socket.emit(EVENTS.ROOM_JOIN_PENDING, { roomId, message: "Pedido enviado. Aguarde a aprovação do host." });
      return;
    }
    if (room.joinLocked) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "Esta sala está bloqueada para novas entradas." }); return; }
    const host = io.sockets.sockets.get(room.hostId);
    if (!host?.connected) { socket.emit(EVENTS.ROOM_ERROR, { roomId, message: "O host está desconectado no momento." }); return; }
    queueJoinRequest(room, name, sessionId);
  });

  socket.on(EVENTS.ROOM_JOIN_CANCEL, (payload: unknown) => {
    const parsed = roomLeaveSchema.safeParse(payload);
    if (!parsed.success) return;
    getRoom(parsed.data.roomId)?.joinRequests.delete(socket.id);
  });

  socket.on(EVENTS.ROOM_JOIN_DECISION, (payload: unknown) => {
    if (isRateLimited(`room:join-decision:${socket.id}`, 20, 60_000)) return;
    const parsed = roomJoinDecisionSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, participantId, allowed } = parsed.data;
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    const request = room.joinRequests.get(participantId);
    if (!request) return;
    const target = io.sockets.sockets.get(participantId);
    if (!target?.connected) {
      if (allowed) request.approved = true;
      else room.joinRequests.delete(participantId);
      return;
    }
    room.joinRequests.delete(participantId);
    if (!allowed) {
      target.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: false, message: "O host recusou seu pedido para entrar." });
      return;
    }
    if (room.participants.has(participantId)) {
      target.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: false, message: "Este participante já está na sala." });
      return;
    }
    if (room.participants.size >= MAX_PARTICIPANTS) {
      target.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: false, message: "A sala ficou cheia antes da aprovação." });
      return;
    }
    const participant = addParticipant(roomId, participantId, request.name, request.sessionId);
    if (!participant) {
      target.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: false, message: "Não foi possível entrar na sala." });
      return;
    }
    target.join(roomId);
    target.emit(EVENTS.ROOM_JOIN_RESULT, { roomId, allowed: true, message: "Entrada aprovada pelo host." });
    target.emit(EVENTS.ROOM_JOINED, joinedPayload(room, participantId));
    emitParticipants(roomId);
  });

  socket.on(EVENTS.ROOM_JOIN_SETTINGS, (payload: unknown) => {
    const parsed = roomJoinSettingsSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    if (!authorized || authorized.room.hostId !== socket.id) return;
    authorized.room.joinRequestNotificationsEnabled = parsed.data.enabled;
    socket.emit(EVENTS.ROOM_JOIN_SETTINGS_UPDATED, { roomId: authorized.room.id, enabled: parsed.data.enabled });
    if (parsed.data.enabled) emitPendingJoinRequests(authorized.room);
  });

  socket.on(EVENTS.ROOM_JOIN_LOCK, (payload: unknown) => {
    if (isRateLimited(`room:join-lock:${socket.id}`, 20, 60_000)) return;
    const parsed = roomJoinLockSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    if (!authorized || authorized.room.hostId !== socket.id) return;
    setJoinLocked(authorized.room.id, parsed.data.locked);
    io.to(authorized.room.id).emit(EVENTS.ROOM_JOIN_LOCK_UPDATED, { roomId: authorized.room.id, locked: parsed.data.locked });
  });

  socket.on(EVENTS.ROOM_PARTICIPANT_MUTE, (payload: unknown) => {
    if (isRateLimited(`room:participant-mute:${socket.id}`, 30, 60_000)) return;
    const parsed = roomParticipantMuteSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    if (!authorized || authorized.room.hostId !== socket.id || parsed.data.participantId === socket.id) return;
    if (!setParticipantForceMuted(authorized.room.id, parsed.data.participantId, parsed.data.muted)) return;
    emitParticipants(authorized.room.id);
  });

  socket.on(EVENTS.ROOM_PARTICIPANT_KICK, (payload: unknown) => {
    if (isRateLimited(`room:participant-kick:${socket.id}`, 20, 60_000)) return;
    const parsed = roomParticipantActionSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    const target = authorized?.room.participants.get(parsed.data.participantId);
    if (!authorized || authorized.room.hostId !== socket.id || !target || target.isHost) return;
    const room = authorized.room;
    if (room.screenSharerId === target.id) {
      room.screenSharing = false;
      room.screenSharerId = null;
      io.to(room.id).emit(EVENTS.SCREEN_STOPPED, { roomId: room.id, sharerId: target.id });
    }
    io.to(target.id).emit(EVENTS.ROOM_PARTICIPANT_KICKED, { roomId: room.id });
    removeParticipant(room.id, target.id);
    const targetSocket = io.sockets.sockets.get(target.id);
    targetSocket?.leave(room.id);
    targetSocket?.disconnect(true);
    if (getRoom(room.id)) emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_TRANSFER_HOST, (payload: unknown) => {
    if (isRateLimited(`room:transfer-host:${socket.id}`, 10, 60_000)) return;
    const parsed = roomParticipantActionSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    if (!authorized || authorized.room.hostId !== socket.id || parsed.data.participantId === socket.id) return;
    const room = transferHost(authorized.room.id, parsed.data.participantId);
    if (!room) { socket.emit(EVENTS.ROOM_ERROR, { roomId: authorized.room.id, message: "Só é possível transferir o host para alguém online." }); return; }
    if (room.screenSharerId === socket.id) {
      room.screenSharing = false;
      room.screenSharerId = null;
      io.to(room.id).emit(EVENTS.SCREEN_STOPPED, { roomId: room.id, sharerId: socket.id });
    }
    io.to(room.id).emit(EVENTS.ROOM_HOST_CHANGED, { roomId: room.id, hostId: room.hostId, joinRequestNotificationsEnabled: room.joinRequestNotificationsEnabled });
    if (room.joinRequestNotificationsEnabled) emitPendingJoinRequests(room);
    emitParticipants(room.id);
  });

  socket.on(EVENTS.ROOM_CLOSE, (payload: unknown) => {
    if (isRateLimited(`room:close:${socket.id}`, 5, 60_000)) return;
    const parsed = roomLeaveSchema.safeParse(payload);
    if (!parsed.success) return;
    const authorized = getAuthorizedParticipant(socket.id, parsed.data.roomId);
    if (!authorized || authorized.room.hostId !== socket.id) return;
    const roomId = authorized.room.id;
    const pendingRequests = [...authorized.room.joinRequests.values()];
    const participants = closeRoom(roomId);
    io.to(roomId).emit(EVENTS.ROOM_CLOSED, { roomId });
    participants.forEach((participant) => {
      const participantSocket = io.sockets.sockets.get(participant.id);
      participantSocket?.leave(roomId);
      participantSocket?.disconnect(true);
    });
    pendingRequests.forEach((request) => {
      const pendingSocket = io.sockets.sockets.get(request.socketId);
      pendingSocket?.emit(EVENTS.ROOM_CLOSED, { roomId });
      pendingSocket?.disconnect(true);
    });
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
      socket.emit(EVENTS.ROOM_JOINED, joinedPayload(room, socket.id));
      emitParticipants(upper);
      return;
    }
    if (room.participants.has(socket.id)) {
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOINED, joinedPayload(room, socket.id));
      return;
    }
    if (room.participants.size >= MAX_PARTICIPANTS) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: `Sala cheia (máx. ${MAX_PARTICIPANTS} participantes).` }); return; }
    const pendingRequest = [...room.joinRequests.entries()].find(([, request]) => request.sessionId === parsed.data.sessionId);
    if (pendingRequest?.[1].approved) {
      room.joinRequests.delete(pendingRequest[0]);
      const participant = addParticipant(upper, socket.id, name, parsed.data.sessionId);
      if (!participant) { socket.emit(EVENTS.ROOM_JOIN_RESULT, { roomId: upper, allowed: false, message: "Não foi possível entrar na sala." }); return; }
      socket.join(upper);
      socket.emit(EVENTS.ROOM_JOIN_RESULT, { roomId: upper, allowed: true, message: "Entrada aprovada pelo host." });
      socket.emit(EVENTS.ROOM_JOINED, joinedPayload(room, socket.id));
      emitParticipants(upper);
      return;
    }
    if (pendingRequest) {
      socket.emit(EVENTS.ROOM_JOIN_PENDING, { roomId: upper, message: pendingRequest[1].approved ? "Entrada aprovada. Reconectando à sala…" : "Pedido enviado. Aguarde a aprovação do host." });
      return;
    }
    if (room.joinLocked) { socket.emit(EVENTS.ROOM_ERROR, { roomId: upper, message: "Esta sala está bloqueada para novas entradas." }); return; }
    removeJoinRequestsBySocket(socket.id);
    queueJoinRequest(room, name, parsed.data.sessionId);
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
       if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { roomId: remaining.id, hostId: remaining.hostId, joinRequestNotificationsEnabled: remaining.joinRequestNotificationsEnabled });
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
    participant.micMuted = participant.forceMuted ? true : muted;
    socket.to(roomId).emit(EVENTS.MICROPHONE_STATE, { roomId, participantId: socket.id, muted: participant.micMuted });
    emitParticipants(roomId);
  });

  socket.on(EVENTS.AUDIO_OUTPUT_STATE, (payload: unknown) => {
    const parsed = audioOutputStateSchema.safeParse(payload);
    if (!parsed.success) return;
    const { roomId, deafened } = parsed.data;
    const authorized = getAuthorizedParticipant(socket.id, roomId);
    if (!authorized) return;
    authorized.participant.deafened = deafened;
    emitParticipants(roomId);
  });

  socket.on(EVENTS.NETWORK_PING, (ack: unknown) => {
    if (typeof ack === "function") ack();
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
           if (wasHost) io.to(remaining.id).emit(EVENTS.ROOM_HOST_CHANGED, { roomId: remaining.id, hostId: remaining.hostId, joinRequestNotificationsEnabled: remaining.joinRequestNotificationsEnabled });
        }
      }, 5_000);
    });
    clearSocketRateLimits(socket.id);
    if (pendingRoom) emitParticipants(pendingRoom.id);
  });
});

httpServer.listen(PORT, () => console.log(`[vynk-signaling] listening on :${PORT} (client: ${CLIENT_URL})`));
