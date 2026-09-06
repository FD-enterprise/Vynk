export type PresenceState = "online" | "reconnecting" | "offline";

export type Participant = {
  id: string;
  sessionId: string;
  name: string;
  isHost: boolean;
  canShareScreen: boolean;
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
  screenSharerId: string | null;
  presenceTimers: Map<string, NodeJS.Timeout>;
  joinRequests: Map<string, JoinRequest>;
  joinRequestNotificationsEnabled: boolean;
};

export type JoinRequest = { socketId: string; sessionId: string; name: string; requestedAt: number; approved?: boolean };

export type ChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorSessionId: string;
  authorName: string;
  text: string;
  timestamp: number;
};
