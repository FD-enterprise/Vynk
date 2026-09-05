"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureRequestGuard, stopMediaStream } from "@/lib/mediaLifecycle";

export type ScreenShareState = "not-sharing" | "requesting-permission" | "sharing" | "stopping" | "error";
export type ScreenShareSurface = "browser" | "window" | "monitor" | "unknown";

type DisplayMediaPreferences = DisplayMediaStreamOptions & {
  monitorTypeSurfaces?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
};

const DISPLAY_MEDIA_PREFERENCES: DisplayMediaPreferences = {
  video: { displaySurface: "monitor", frameRate: { ideal: 30, max: 30 } },
  audio: true,
  monitorTypeSurfaces: "include",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
  systemAudio: "include",
};

export function useScreenShare(onStopped?: () => void) {
  const [state, setState] = useState<ScreenShareState>("not-sharing");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [surface, setSurface] = useState<ScreenShareSurface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStream = useRef<MediaStream | null>(null);
  const captureRequest = useRef(new CaptureRequestGuard());
  const mounted = useRef(false);

  const stopStream = useCallback((current: MediaStream, notify = true) => {
    if (activeStream.current !== current) return;
    stopMediaStream(current);
    activeStream.current = null;
    setStream(null);
    setSurface(null);
    setState("not-sharing");
    if (notify) onStopped?.();
  }, [onStopped]);

  const start = useCallback(async () => {
    if (activeStream.current) return null;
    const request = captureRequest.current.begin();
    if (request === null) return null;
    setError(null);
    setState("requesting-permission");
    try {
      const current = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_PREFERENCES);
      if (!mounted.current || !captureRequest.current.isCurrent(request)) {
        current.getTracks().forEach((track) => track.stop());
        return null;
      }
      const videoTrack = current.getVideoTracks()[0];
      if (!videoTrack) {
        current.getTracks().forEach((track) => track.stop());
        throw new Error("Nenhuma faixa de vídeo foi disponibilizada.");
      }
      activeStream.current = current;
      videoTrack.onended = () => stopStream(current);
      const displaySurface = videoTrack.getSettings().displaySurface;
      setSurface(displaySurface === "browser" || displaySurface === "window" || displaySurface === "monitor" ? displaySurface : "unknown");
      setStream(current);
      setState("sharing");
      return current;
    } catch (cause) {
      if (!mounted.current || !captureRequest.current.isCurrent(request)) return null;
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setSurface(null);
      setError(denied ? "Permissão para compartilhar a tela foi negada." : "Não foi possível compartilhar a tela.");
      setState("error");
      return null;
    } finally {
      captureRequest.current.finish(request);
    }
  }, [stopStream]);

  const stop = useCallback(() => {
    captureRequest.current.cancel();
    const current = activeStream.current;
    if (!current) {
      setStream(null);
      setSurface(null);
      setState("not-sharing");
      setError(null);
      return;
    }
    setState("stopping");
    stopStream(current);
  }, [stopStream]);

  useEffect(() => {
    const capture = captureRequest.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      capture.cancel();
      const current = activeStream.current;
      if (!current) return;
      stopMediaStream(current);
      activeStream.current = null;
    };
  }, []);

  return { state, stream, surface, error, start, stop };
}
