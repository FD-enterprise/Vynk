"use client";
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getParticipantSessionId(): string {
  const key = "vynk_participant_session";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export function getSignalingSocket(): Socket {
  if (socket) return socket;
  const url = process.env.NEXT_PUBLIC_SIGNALING_URL || "https://vynk-mwxh.onrender.com";
  socket = io(url, {
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
