"use client";

import { useEffect, useRef } from "react";

export type RemoteAudioPlaybackState = "playing" | "blocked" | "error";

export function getRemoteAudioPlaybackState(cause: unknown): RemoteAudioPlaybackState {
  return cause instanceof DOMException && cause.name === "NotAllowedError" ? "blocked" : "error";
}

let remoteAudioContext: AudioContext | null = null;

function getRemoteAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  remoteAudioContext ??= new window.AudioContext();
  return remoteAudioContext;
}

export async function resumeRemoteAudioContext(): Promise<void> {
  const context = getRemoteAudioContext();
  if (context?.state === "suspended") await context.resume().catch(() => undefined);
}

type Props = {
  peerId: string;
  stream: MediaStream;
  volume: number;
  onPlaybackStateChange: (peerId: string, state: RemoteAudioPlaybackState) => void;
};

export function RemoteAudio({ peerId, stream, volume, onPlaybackStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const context = getRemoteAudioContext();
    if (!audio || !context) return;
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    source.connect(gain).connect(context.destination);
    gainRef.current = gain;
    audio.volume = 1;
    return () => {
      source.disconnect();
      gain.disconnect();
      gainRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;
    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const audio = audioRef.current;
    const nextVolume = Math.min(2, Math.max(0, volume));
    if (gainRef.current) gainRef.current.gain.value = nextVolume;
    else if (audio) audio.volume = Math.min(1, nextVolume);
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;

    const play = async () => {
      try {
        await resumeRemoteAudioContext();
        await audio.play();
        if (!cancelled) onPlaybackStateChange(peerId, "playing");
      } catch (cause) {
        if (!cancelled) onPlaybackStateChange(peerId, getRemoteAudioPlaybackState(cause));
      }
    };

    void play();
    return () => { cancelled = true; };
  }, [onPlaybackStateChange, peerId, stream]);

  return <audio ref={audioRef} autoPlay className="hidden" aria-hidden="true" data-vynk-remote-audio={peerId} />;
}
