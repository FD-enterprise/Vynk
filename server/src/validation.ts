import { z } from "zod";
import { MAX_CHAT_MESSAGE_LENGTH, MAX_ICE_CANDIDATE_LENGTH, MAX_PEER_ID_LENGTH, MAX_SDP_LENGTH } from "./events.js";

export const nameSchema = z.string().trim().min(1, "Nome é obrigatório").max(24, "Nome deve ter no máximo 24 caracteres").regex(/^[\p{L}\p{N}\s._-]+$/u, "Nome contém caracteres inválidos");
export const sessionIdSchema = z.string().uuid();

export const roomIdSchema = z.string().trim().toUpperCase().length(6, "Código deve ter 6 caracteres").regex(/^[A-Z0-9]{6}$/, "Código inválido");

export const roomCreateSchema = z.object({ name: nameSchema, sessionId: sessionIdSchema });
export const roomJoinSchema = z.object({ roomId: roomIdSchema, name: nameSchema, sessionId: sessionIdSchema });
export const roomLeaveSchema = z.object({ roomId: roomIdSchema });
export const chatSendSchema = z.object({ roomId: roomIdSchema, text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH) });
export const screenStateSchema = z.object({ roomId: roomIdSchema });
export const microphoneStateSchema = z.object({ roomId: roomIdSchema, muted: z.boolean() });

const peerIdSchema = z.string().min(1).max(MAX_PEER_ID_LENGTH).regex(/^[A-Za-z0-9_-]+$/, "Peer inválido");
export const sdpSchema = z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().min(1).max(MAX_SDP_LENGTH) });
export const offerSchema = z.object({ roomId: roomIdSchema, targetId: peerIdSchema, sdp: sdpSchema });
export const answerSchema = z.object({ roomId: roomIdSchema, targetId: peerIdSchema, sdp: sdpSchema });
export const iceCandidateSchema = z.object({
  roomId: roomIdSchema,
  targetId: peerIdSchema,
  candidate: z.object({
    candidate: z.string().min(1).max(MAX_ICE_CANDIDATE_LENGTH),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
});
