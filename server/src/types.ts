export type Participant = {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  micMuted: boolean;
};

export type Room = {
  id: string;
  hostId: string;
  participants: Map<string, Participant>;
  createdAt: number;
  screenSharing: boolean;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
};
