import type { ChatMessage } from "./events";

export function isOwnChatMessage(message: Pick<ChatMessage, "authorId" | "authorSessionId">, participantSessionId: string, socketId: string): boolean {
  return message.authorSessionId ? message.authorSessionId === participantSessionId : message.authorId === socketId;
}
