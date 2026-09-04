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
  MICROPHONE_STATE: "microphone:state",
  CHAT_SEND: "chat:send",
  CHAT_MESSAGE: "chat:message",
  PRESENCE_UPDATE: "presence:update",
} as const;

export const MAX_PARTICIPANTS = 5;

export type PresenceState = "online" | "reconnecting" | "offline";
export type Participant = { id: string; sessionId: string; name: string; isHost: boolean; joinedAt: number; micMuted: boolean; presence: PresenceState };
export type ChatMessage = { id: string; roomId: string; authorId: string; authorName: string; text: string; timestamp: number };
export type RoomCreatePayload = { name: string; sessionId: string };
export type RoomJoinPayload = { roomId: string; name: string; sessionId: string };
export type RoomLeavePayload = { roomId: string };
export type PeerSignalPayload = { roomId: string; targetId: string };
export type ScreenStatePayload = { roomId: string };
export type MicrophoneStatePayload = { roomId: string; muted: boolean };
