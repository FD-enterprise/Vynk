"use client";

import { useEffect, useRef } from "react";

export type RemoteAudioPlaybackState = "playing" | "blocked" | "error";

export function getRemoteAudioPlaybackState(cause: unknown): RemoteAudioPlaybackState {
  return cause instanceof DOMException && cause.name === "NotAllowedError" ? "blocked" : "error";
}

type Props = {
  peerId: string;
  stream: MediaStream;
  onPlaybackStateChange: (peerId: string, state: RemoteAudioPlaybackState) => void;
};

export function RemoteAudio({ peerId, stream, onPlaybackStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);

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
    if (!audio) return;
    let cancelled = false;

    const play = async () => {
      try {
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
