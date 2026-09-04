"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MicrophoneState = "off" | "requesting-permission" | "active" | "error";

export function useMicrophone(onStateChange?: (muted: boolean) => void) {
  const [state, setState] = useState<MicrophoneState>("off");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStream = useRef<MediaStream | null>(null);
  const captureRequest = useRef(0);
  const capturePending = useRef(false);
  const mounted = useRef(false);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const stopStream = useCallback((current: MediaStream, notify = true) => {
    if (activeStream.current !== current) return;
    current.getAudioTracks().forEach((track) => { track.onended = null; });
    current.getTracks().forEach((track) => track.stop());
    activeStream.current = null;
    setStream(null);
    setState("off");
    if (notify) onStateChangeRef.current?.(true);
  }, []);

  const start = useCallback(async () => {
    if (capturePending.current || activeStream.current) return null;
    capturePending.current = true;
    const request = ++captureRequest.current;
    setError(null);
    setState("requesting-permission");

    try {
      const current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || request !== captureRequest.current) {
        current.getTracks().forEach((track) => track.stop());
        return null;
      }

      const audioTrack = current.getAudioTracks()[0];
      if (!audioTrack) {
        current.getTracks().forEach((track) => track.stop());
        throw new Error("Nenhuma faixa de áudio foi disponibilizada.");
      }

      activeStream.current = current;
      audioTrack.onended = () => stopStream(current);
      setStream(current);
      setState("active");
      onStateChangeRef.current?.(false);
      return current;
    } catch (cause) {
      if (!mounted.current || request !== captureRequest.current) return null;
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
      if (request === captureRequest.current) capturePending.current = false;
    }
  }, [stopStream]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureRequest.current += 1;
      capturePending.current = false;
      const current = activeStream.current;
      if (!current) return;
      current.getAudioTracks().forEach((track) => { track.onended = null; });
      current.getTracks().forEach((track) => track.stop());
      activeStream.current = null;
      onStateChangeRef.current?.(true);
    };
  }, []);

  return { state, stream, error, start };
}
