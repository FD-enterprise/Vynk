"use client";
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
export const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "https://vynk-mwxh.onrender.com";

export function getParticipantSessionId(): string {
  const key = "vynk_participant_session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

export function getSignalingSocket(): Socket {
  if (socket) return socket;
  socket = io(SIGNALING_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function disconnectSignaling() {
  if (socket) { socket.disconnect(); socket = null; }
}
