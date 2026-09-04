"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { EVENTS } from "@/lib/events";

type Peer = { id: string };
type SignalDescription = { type: "offer" | "answer"; sdp: string };
type SignalCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };
export type PeerConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

type Props = {
  socket: Socket | null;
  roomId: string;
  selfId: string;
  isHost: boolean;
  peers: Peer[];
  localScreenStream: MediaStream | null;
  localMicrophoneStream: MediaStream | null;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onRemoteMicrophoneStream: (peerId: string, stream: MediaStream) => void;
  onRemotePeerRemoved: (peerId: string) => void;
};

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useWebRTCSignaling({ socket, roomId, selfId, isHost, peers, localScreenStream, localMicrophoneStream, onRemoteStream, onRemoteMicrophoneStream, onRemotePeerRemoved }: Props) {
  const connections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const previousScreenStream = useRef<MediaStream | null>(null);
  const microphoneTransceivers = useRef<Map<string, RTCRtpTransceiver>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const remoteMicrophoneStreams = useRef<Map<string, MediaStream>>(new Map());
  const [states, setStates] = useState<Record<string, PeerConnectionState>>({});
  const [iceStates, setIceStates] = useState<Record<string, RTCIceConnectionState>>({});

  const setPeerState = useCallback((peerId: string, state: PeerConnectionState) => {
    setStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
  }, []);

  const createPeer = useCallback((peerId: string) => {
    const existing = connections.current.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    if (isHost) {
      connection.addTransceiver("video", { direction: "sendonly" });
      connection.addTransceiver("audio", { direction: "sendonly" });
      const microphoneTransceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
      microphoneTransceivers.current.set(peerId, microphoneTransceiver);
    }
    connection.ontrack = (event) => {
      if (event.track.kind === "audio") {
        let microphoneTransceiver = microphoneTransceivers.current.get(peerId);
        if (!microphoneTransceiver) {
          const audioTransceivers = connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "audio");
          if (audioTransceivers.length >= 2) {
            microphoneTransceiver = audioTransceivers.at(-1);
            if (microphoneTransceiver) microphoneTransceivers.current.set(peerId, microphoneTransceiver);
          }
        }
        if (event.transceiver === microphoneTransceiver) {
          const incomingMicrophone = remoteMicrophoneStreams.current.get(peerId) ?? new MediaStream();
          if (!incomingMicrophone.getTracks().some((track) => track.id === event.track.id)) incomingMicrophone.addTrack(event.track);
          event.track.onunmute = () => onRemoteMicrophoneStream(peerId, incomingMicrophone);
          remoteMicrophoneStreams.current.set(peerId, incomingMicrophone);
          onRemoteMicrophoneStream(peerId, incomingMicrophone);
          return;
        }
      }
      const incoming = remoteStreams.current.get(peerId) ?? new MediaStream();
      const tracks = event.streams[0]?.getTracks() ?? [event.track];
      tracks.forEach((track) => {
        if (!incoming.getTracks().some((existing) => existing.id === track.id)) incoming.addTrack(track);
        track.onunmute = () => onRemoteStream(peerId, incoming);
        track.onmute = () => onRemoteStream(peerId, incoming);
      });
      remoteStreams.current.set(peerId, incoming);
      onRemoteStream(peerId, incoming);
    };
    connection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit(EVENTS.WEBRTC_ICE_CANDIDATE, {
          roomId,
          targetId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.onconnectionstatechange = () => {
      setPeerState(peerId, connection.connectionState as PeerConnectionState);
    };
    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      setIceStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
      if (state === "checking") setPeerState(peerId, "connecting");
      if (state === "connected" || state === "completed") setPeerState(peerId, "connected");
      if (state === "disconnected") setPeerState(peerId, "disconnected");
      if (state === "failed") setPeerState(peerId, "failed");
    };
    connection.ondatachannel = (event) => {
      event.channel.onopen = () => setPeerState(peerId, "connected");
    };
    connections.current.set(peerId, connection);
    setPeerState(peerId, "new");
    return connection;
  }, [isHost, onRemoteMicrophoneStream, onRemoteStream, roomId, setPeerState, socket]);

  const flushCandidates = useCallback(async (peerId: string, connection: RTCPeerConnection) => {
    const pending = pendingCandidates.current.get(peerId) ?? [];
    pendingCandidates.current.delete(peerId);
    for (const candidate of pending) {
      try { await connection.addIceCandidate(new RTCIceCandidate(candidate)); } catch { setPeerState(peerId, "failed"); }
    }
  }, [setPeerState]);

  const createOffer = useCallback(async (peerId: string) => {
    if (!socket || !roomId) return;
    const connection = createPeer(peerId);
    // A data channel gives the initial SDP a negotiated section without carrying media.
    const controlChannel = connection.createDataChannel("vynk-control");
    controlChannel.onopen = () => setPeerState(peerId, "connected");
    try {
      for (const track of localScreenStream?.getTracks() ?? []) {
        const transceiver = connection.getTransceivers().find((candidate) => candidate.receiver.track.kind === track.kind);
        if (transceiver) await transceiver.sender.replaceTrack(track);
      }
      const microphoneTrack = localMicrophoneStream?.getAudioTracks()[0] ?? null;
      const microphoneTransceiver = microphoneTransceivers.current.get(peerId);
      if (microphoneTransceiver) await microphoneTransceiver.sender.replaceTrack(microphoneTrack);
      setPeerState(peerId, "connecting");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit(EVENTS.WEBRTC_OFFER, { roomId, targetId: peerId, sdp: offer });
    } catch {
      setPeerState(peerId, "failed");
    }
  }, [createPeer, localMicrophoneStream, localScreenStream, roomId, setPeerState, socket]);

  const renegotiateScreen = useCallback(async (peerId: string) => {
    const connection = createPeer(peerId);
    const desiredTracks = localScreenStream?.getTracks() ?? [];
    const desiredByKind = new Map(desiredTracks.map((track) => [track.kind, track]));
    for (const transceiver of connection.getTransceivers()) {
      if (transceiver === microphoneTransceivers.current.get(peerId)) continue;
      const kind = transceiver.receiver.track.kind;
      if (kind === "video" || kind === "audio") {
        try { await transceiver.sender.replaceTrack(desiredByKind.get(kind) ?? null); } catch { setPeerState(peerId, "failed"); }
      }
    }
    // Fallback for a peer created before media transceivers were available.
    for (const track of desiredTracks) {
      const hasSender = connection.getSenders().some((sender) => sender.track?.id === track.id);
      if (!hasSender && !connection.getTransceivers().some((transceiver) => transceiver.receiver.track.kind === track.kind)) {
        connection.addTrack(track, localScreenStream!);
      }
    }
  }, [createPeer, localScreenStream, setPeerState]);

  useEffect(() => {
    if (!socket || !roomId || !selfId) return;

    const onOffer = async (data: { fromId: string; roomId: string; sdp: SignalDescription }) => {
      if (data.roomId !== roomId || data.fromId === selfId) return;
      const connection = createPeer(data.fromId);
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const audioTransceivers = connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "audio");
        const microphoneTransceiver = audioTransceivers.length >= 2 ? audioTransceivers.at(-1) : undefined;
        if (microphoneTransceiver) {
          microphoneTransceiver.direction = "sendrecv";
          microphoneTransceivers.current.set(data.fromId, microphoneTransceiver);
          await microphoneTransceiver.sender.replaceTrack(localMicrophoneStream?.getAudioTracks()[0] ?? null);
        }
        await flushCandidates(data.fromId, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        setPeerState(data.fromId, "connecting");
        socket.emit(EVENTS.WEBRTC_ANSWER, { roomId, targetId: data.fromId, sdp: answer });
      } catch {
        setPeerState(data.fromId, "failed");
      }
    };

    const onAnswer = async (data: { fromId: string; roomId: string; sdp: SignalDescription }) => {
      if (data.roomId !== roomId || data.fromId === selfId) return;
      const connection = connections.current.get(data.fromId);
      if (!connection || connection.signalingState !== "have-local-offer") return;
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushCandidates(data.fromId, connection);
      } catch {
        setPeerState(data.fromId, "failed");
      }
    };

    const onCandidate = async (data: { fromId: string; roomId: string; candidate: SignalCandidate }) => {
      if (data.roomId !== roomId || data.fromId === selfId) return;
      const connection = createPeer(data.fromId);
      if (!connection.remoteDescription) {
        const current = pendingCandidates.current.get(data.fromId) ?? [];
        current.push(data.candidate);
        pendingCandidates.current.set(data.fromId, current);
        return;
      }
      try { await connection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch { setPeerState(data.fromId, "failed"); }
    };

    socket.on(EVENTS.WEBRTC_OFFER, onOffer);
    socket.on(EVENTS.WEBRTC_ANSWER, onAnswer);
    socket.on(EVENTS.WEBRTC_ICE_CANDIDATE, onCandidate);
    return () => {
      socket.off(EVENTS.WEBRTC_OFFER, onOffer);
      socket.off(EVENTS.WEBRTC_ANSWER, onAnswer);
      socket.off(EVENTS.WEBRTC_ICE_CANDIDATE, onCandidate);
    };
  }, [createPeer, flushCandidates, localMicrophoneStream, roomId, selfId, setPeerState, socket]);

  useEffect(() => {
    const microphoneTrack = localMicrophoneStream?.getAudioTracks()[0] ?? null;
    microphoneTransceivers.current.forEach((transceiver, peerId) => {
      void transceiver.sender.replaceTrack(microphoneTrack).catch(() => setPeerState(peerId, "failed"));
    });
  }, [localMicrophoneStream, setPeerState]);

  useEffect(() => {
    if (!isHost || !socket || !selfId) return;
    const screenChanged = previousScreenStream.current !== localScreenStream;
    previousScreenStream.current = localScreenStream;
    if (screenChanged) {
      for (const peer of peers) {
        if (peer.id !== selfId && connections.current.has(peer.id)) void renegotiateScreen(peer.id);
      }
    }
    for (const peer of peers) {
      if (peer.id !== selfId && !connections.current.has(peer.id)) void createOffer(peer.id);
    }
  }, [createOffer, isHost, localScreenStream, peers, renegotiateScreen, selfId, socket]);

  useEffect(() => {
    const activeIds = new Set(peers.map((peer) => peer.id));
    connections.current.forEach((connection, peerId) => {
      if (peerId === selfId || activeIds.has(peerId)) return;
      connection.close();
      connections.current.delete(peerId);
      pendingCandidates.current.delete(peerId);
      microphoneTransceivers.current.delete(peerId);
      remoteStreams.current.delete(peerId);
      remoteMicrophoneStreams.current.delete(peerId);
      onRemotePeerRemoved(peerId);
      setStates((current) => {
        const next = { ...current };
        delete next[peerId];
        return next;
      });
      setIceStates((current) => {
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    });
  }, [onRemotePeerRemoved, peers, selfId]);

  useEffect(() => () => {
    connections.current.forEach((connection) => connection.close());
    connections.current.clear();
    pendingCandidates.current.clear();
    microphoneTransceivers.current.clear();
    remoteStreams.current.clear();
    remoteMicrophoneStreams.current.clear();
  }, []);

  return { states, iceStates };
}
