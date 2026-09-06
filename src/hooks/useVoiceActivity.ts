"use client";

import { useEffect, useState } from "react";

const SPEAKING_THRESHOLD = 0.075;
const SILENCE_THRESHOLD = 0.045;
const SPEAKING_HOLD_MS = 220;

type VoiceMonitor = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  animationFrame: number;
  stop: () => void;
};

function getRms(data: Uint8Array): number {
  let sum = 0;
  for (const sample of data) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

export function useVoiceActivity(streams: Map<string, MediaStream>): Set<string> {
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.AudioContext !== "function" || streams.size === 0) {
      return;
    }

    const context = new window.AudioContext();
    const monitors = new Map<string, VoiceMonitor>();
    let cancelled = false;

    const updateSpeaking = (peerId: string, speaking: boolean) => {
      setSpeakingIds((current) => {
        const isSpeaking = current.has(peerId);
        if (isSpeaking === speaking) return current;
        const next = new Set(current);
        if (speaking) next.add(peerId);
        else next.delete(peerId);
        return next;
      });
    };

    streams.forEach((stream, peerId) => {
      if (stream.getAudioTracks().every((track) => track.readyState !== "live")) return;

      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);

        const data = new Uint8Array(analyser.fftSize);
        let speaking = false;
        let lastVoiceAt = 0;
        let animationFrame = 0;

        const sample = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          const now = performance.now();
          const level = getRms(data);

          if (level >= (speaking ? SILENCE_THRESHOLD : SPEAKING_THRESHOLD)) lastVoiceAt = now;
          const nextSpeaking = speaking ? now - lastVoiceAt <= SPEAKING_HOLD_MS : level >= SPEAKING_THRESHOLD;
          if (nextSpeaking !== speaking) {
            speaking = nextSpeaking;
            updateSpeaking(peerId, speaking);
          }

          animationFrame = window.requestAnimationFrame(sample);
        };

        const stop = () => {
          window.cancelAnimationFrame(animationFrame);
          source.disconnect();
          analyser.disconnect();
          updateSpeaking(peerId, false);
        };

        monitors.set(peerId, { source, analyser, animationFrame, stop });
        sample();
      } catch {
        // Alguns navegadores rejeitam múltiplos analisadores para a mesma faixa.
      }
    });

    return () => {
      cancelled = true;
      monitors.forEach((monitor) => monitor.stop());
      void context.close().catch(() => undefined);
      setSpeakingIds(new Set());
    };
  }, [streams]);

  return speakingIds;
}
