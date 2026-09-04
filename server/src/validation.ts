import { z } from "zod";

export const nameSchema = z.string().trim().min(1, "Nome é obrigatório").max(24, "Nome deve ter no máximo 24 caracteres").regex(/^[\p{L}\p{N}\s._-]+$/u, "Nome contém caracteres inválidos");

export const roomIdSchema = z.string().trim().toUpperCase().length(6, "Código deve ter 6 caracteres").regex(/^[A-Z0-9]{6}$/, "Código inválido");

export const roomCreateSchema = z.object({ name: nameSchema });
export const roomJoinSchema = z.object({ roomId: roomIdSchema, name: nameSchema });
export const chatSendSchema = z.object({ roomId: roomIdSchema, text: z.string().trim().min(1).max(500) });

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
