"use client";

import { useCallback, useState } from "react";

export type ScreenShareState = "not-sharing" | "requesting-permission" | "sharing" | "stopping" | "error";

export function useScreenShare(onNativeStop?: () => void) {
  const [state, setState] = useState<ScreenShareState>("not-sharing");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback((current: MediaStream) => {
    current.getTracks().forEach((track) => track.stop());
    setStream(null);
    setState("not-sharing");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("requesting-permission");
    try {
      const current = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const videoTrack = current.getVideoTracks()[0];
      if (!videoTrack) {
        current.getTracks().forEach((track) => track.stop());
        throw new Error("Nenhuma faixa de vídeo foi disponibilizada.");
      }
      videoTrack.onended = () => {
        stopStream(current);
        onNativeStop?.();
      };
      setStream(current);
      setState("sharing");
      return current;
    } catch (cause) {
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setError(denied ? "Permissão para compartilhar a tela foi negada." : "Não foi possível compartilhar a tela.");
      setState("error");
      return null;
    }
  }, [onNativeStop, stopStream]);

  const stop = useCallback(() => {
    if (!stream) return;
    setState("stopping");
    stopStream(stream);
  }, [stopStream, stream]);

  const cleanup = useCallback(() => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    setStream(null);
    setState("not-sharing");
  }, [stream]);

  return { state, stream, error, start, stop, cleanup };
}
