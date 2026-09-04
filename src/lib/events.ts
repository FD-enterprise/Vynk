export const EVENTS = {
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_CREATED: "room:created",
  ROOM_JOINED: "room:joined",
  ROOM_PARTICIPANTS: "room:participants",
  ROOM_ERROR: "room:error",
  ROOM_HOST_CHANGED: "room:host-changed",
  WEBRTC_OFFER: "webrtc:offer",
  WEBRTC_ANSWER: "webrtc:answer",
  WEBRTC_ICE_CANDIDATE: "webrtc:ice-candidate",
  SCREEN_STARTED: "screen:started",
  SCREEN_STOPPED: "screen:stopped",
  CHAT_SEND: "chat:send",
  CHAT_MESSAGE: "chat:message",
  PRESENCE_UPDATE: "presence:update",
} as const;

export type Participant = { id: string; name: string; isHost: boolean; joinedAt: number; micMuted: boolean };
export type ChatMessage = { id: string; roomId: string; authorId: string; authorName: string; text: string; timestamp: number };
