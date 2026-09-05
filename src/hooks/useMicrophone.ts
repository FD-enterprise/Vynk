"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureRequestGuard, stopMediaStream } from "@/lib/mediaLifecycle";

export type MicrophoneState = "off" | "requesting-permission" | "active" | "error";

export function useMicrophone(onStateChange?: (muted: boolean) => void) {
  const [state, setState] = useState<MicrophoneState>("off");
  const [muted, setMuted] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStream = useRef<MediaStream | null>(null);
  const captureRequest = useRef(new CaptureRequestGuard());
  const mounted = useRef(false);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const stopStream = useCallback((current: MediaStream, notify = true) => {
    if (activeStream.current !== current) return;
    stopMediaStream(current);
    activeStream.current = null;
    setStream(null);
    setState("off");
    setMuted(true);
    if (notify) onStateChangeRef.current?.(true);
  }, []);

  const setTrackMuted = useCallback((nextMuted: boolean) => {
    const track = activeStream.current?.getAudioTracks()[0];
    if (!track || track.readyState !== "live") return;
    track.enabled = !nextMuted;
    setMuted(nextMuted);
    onStateChangeRef.current?.(nextMuted);
  }, []);

  const mute = useCallback(() => setTrackMuted(true), [setTrackMuted]);
  const unmute = useCallback(() => setTrackMuted(false), [setTrackMuted]);
  const toggle = useCallback(() => setTrackMuted(!muted), [muted, setTrackMuted]);
  const stop = useCallback(() => {
    captureRequest.current.cancel();
    const current = activeStream.current;
    if (current) {
      stopStream(current);
      return;
    }
    setStream(null);
    setState("off");
    setMuted(true);
    setError(null);
  }, [stopStream]);

  const start = useCallback(async () => {
    if (activeStream.current) return null;
    const request = captureRequest.current.begin();
    if (request === null) return null;
    setError(null);
    setState("requesting-permission");

    try {
      const current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || !captureRequest.current.isCurrent(request)) {
        current.getTracks().forEach((track) => track.stop());
        return null;
      }

      const audioTrack = current.getAudioTracks()[0];
      if (!audioTrack) {
        current.getTracks().forEach((track) => track.stop());
        throw new Error("Nenhuma faixa de áudio foi disponibilizada.");
      }

      activeStream.current = current;
      audioTrack.enabled = true;
      audioTrack.onended = () => stopStream(current);
      setStream(current);
      setState("active");
      setMuted(false);
      onStateChangeRef.current?.(false);
      return current;
    } catch (cause) {
      if (!mounted.current || !captureRequest.current.isCurrent(request)) return null;
      const errorName = cause instanceof DOMException ? cause.name : "";
      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        setError("Permissão para usar o microfone foi negada. Libere o acesso no navegador e tente novamente.");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setError("Nenhum microfone foi encontrado. Conecte um dispositivo e tente novamente.");
      } else {
        setError("Não foi possível ativar o microfone. Verifique o dispositivo e tente novamente.");
      }
      setState("error");
      return null;
    } finally {
      captureRequest.current.finish(request);
    }
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

  return { state, muted, stream, error, start, stop, mute, unmute, toggle };
}
