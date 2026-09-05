export type PresenceState = "online" | "reconnecting" | "offline";

export type Participant = {
  id: string;
  sessionId: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  micMuted: boolean;
  presence: PresenceState;
};

export type Room = {
  id: string;
  hostId: string;
  participants: Map<string, Participant>;
  chatMessages: ChatMessage[];
  createdAt: number;
  screenSharing: boolean;
  presenceTimers: Map<string, NodeJS.Timeout>;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
};
