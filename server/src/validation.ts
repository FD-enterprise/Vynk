import { z } from "zod";
import { MAX_CHAT_MESSAGE_LENGTH } from "./events.js";

export const nameSchema = z.string().trim().min(1, "Nome é obrigatório").max(24, "Nome deve ter no máximo 24 caracteres").regex(/^[\p{L}\p{N}\s._-]+$/u, "Nome contém caracteres inválidos");
export const sessionIdSchema = z.string().uuid();

export const roomIdSchema = z.string().trim().toUpperCase().length(6, "Código deve ter 6 caracteres").regex(/^[A-Z0-9]{6}$/, "Código inválido");

export const roomCreateSchema = z.object({ name: nameSchema, sessionId: sessionIdSchema });
export const roomJoinSchema = z.object({ roomId: roomIdSchema, name: nameSchema, sessionId: sessionIdSchema });
export const roomLeaveSchema = z.object({ roomId: roomIdSchema });
export const chatSendSchema = z.object({ roomId: roomIdSchema, text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH) });
export const screenStateSchema = z.object({ roomId: roomIdSchema });
export const microphoneStateSchema = z.object({ roomId: roomIdSchema, muted: z.boolean() });

export const sdpSchema = z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().min(1) });
export const offerSchema = z.object({ roomId: roomIdSchema, targetId: z.string().min(1), sdp: sdpSchema });
export const answerSchema = z.object({ roomId: roomIdSchema, targetId: z.string().min(1), sdp: sdpSchema });
export const iceCandidateSchema = z.object({
  roomId: roomIdSchema,
  targetId: z.string().min(1),
  candidate: z.object({
    candidate: z.string().min(1),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().nullable().optional(),
  }),
});
