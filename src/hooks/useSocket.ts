"use client";
import { useEffect, useState } from "react";
import { getSignalingSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";

export type ConnState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  useEffect(() => {
    const s = getSignalingSocket();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    setState(s.connected ? "connected" : "connecting");
    const onConnect = () => setState("connected");
    const onDisconnect = () => setState("reconnecting");
    const onErr = () => setState("error");
    const onReconnect = () => setState("connected");
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onErr);
    s.io.on("reconnect", onReconnect);
    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onErr);
      s.io.off("reconnect", onReconnect);
    };
  }, []);
  return { socket, state };
}
