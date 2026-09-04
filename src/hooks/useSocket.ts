"use client";
import { useEffect, useState } from "react";
import { getSignalingSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";

export type ConnState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s = getSignalingSocket();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    setState(s.connected ? "connected" : "connecting");
    const onConnect = () => { setState("connected"); setError(null); };
    const onDisconnect = () => setState("reconnecting");
    const onErr = () => setState("reconnecting");
    const onReconnect = () => { setState("connected"); setError(null); };
    const onReconnectFailed = () => { setState("error"); setError("Não foi possível reconectar à sala. Atualize a página para tentar novamente."); };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onErr);
    s.io.on("reconnect", onReconnect);
    s.io.on("reconnect_failed", onReconnectFailed);
    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onErr);
      s.io.off("reconnect", onReconnect);
      s.io.off("reconnect_failed", onReconnectFailed);
    };
  }, []);
  return { socket, state, error };
}
