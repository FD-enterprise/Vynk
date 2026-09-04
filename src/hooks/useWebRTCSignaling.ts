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
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onRemotePeerRemoved: (peerId: string) => void;
};

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useWebRTCSignaling({ socket, roomId, selfId, isHost, peers, localScreenStream, onRemoteStream, onRemotePeerRemoved }: Props) {
  const connections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const previousScreenStream = useRef<MediaStream | null>(null);
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const [states, setStates] = useState<Record<string, PeerConnectionState>>({});
  const [iceStates, setIceStates] = useState<Record<string, RTCIceConnectionState>>({});

  const setPeerState = useCallback((peerId: string, state: PeerConnectionState) => {
    setStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
  }, []);

  const createPeer = useCallback((peerId: string) => {
    const existing = connections.current.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    localScreenStream?.getTracks().forEach((track) => connection.addTrack(track, localScreenStream));
    connection.ontrack = (event) => {
      const incoming = remoteStreams.current.get(peerId) ?? new MediaStream();
      const tracks = event.streams[0]?.getTracks() ?? [event.track];
      tracks.forEach((track) => {
        if (!incoming.getTracks().some((existing) => existing.id === track.id)) incoming.addTrack(track);
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
  }, [localScreenStream, onRemoteStream, roomId, setPeerState, socket]);

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
      setPeerState(peerId, "connecting");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit(EVENTS.WEBRTC_OFFER, { roomId, targetId: peerId, sdp: offer });
    } catch {
      setPeerState(peerId, "failed");
    }
  }, [createPeer, roomId, setPeerState, socket]);

  const renegotiateScreen = useCallback(async (peerId: string) => {
    if (!socket || !roomId) return;
    const connection = createPeer(peerId);
    const desiredTracks = localScreenStream?.getTracks() ?? [];
    const desiredKinds = new Set(desiredTracks.map((track) => track.kind));
    for (const sender of connection.getSenders()) {
      if (sender.track && (sender.track.kind === "video" || sender.track.kind === "audio") && !desiredKinds.has(sender.track.kind)) {
        connection.removeTrack(sender);
      }
    }
    for (const track of desiredTracks) {
      const sender = connection.getSenders().find((candidate) => candidate.track?.kind === track.kind);
      if (sender) await sender.replaceTrack(track);
      else connection.addTrack(track, localScreenStream!);
    }
    try {
      setPeerState(peerId, "connecting");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit(EVENTS.WEBRTC_OFFER, { roomId, targetId: peerId, sdp: offer });
    } catch {
      setPeerState(peerId, "failed");
    }
  }, [createPeer, localScreenStream, roomId, setPeerState, socket]);

  useEffect(() => {
    if (!socket || !roomId || !selfId) return;

    const onOffer = async (data: { fromId: string; roomId: string; sdp: SignalDescription }) => {
      if (data.roomId !== roomId || data.fromId === selfId) return;
      const connection = createPeer(data.fromId);
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
  }, [createPeer, flushCandidates, roomId, selfId, setPeerState, socket]);

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
      remoteStreams.current.delete(peerId);
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
    remoteStreams.current.clear();
  }, []);

  return { states, iceStates };
}
