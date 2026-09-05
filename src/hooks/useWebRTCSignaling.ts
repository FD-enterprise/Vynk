"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { EVENTS } from "@/lib/events";
import { closeDataChannel, closePeerConnection, stopMediaStream } from "@/lib/mediaLifecycle";

type Peer = { id: string; isHost: boolean };
type NegotiationMode = "offer" | "answer";
type SignalDescription = { type: "offer" | "answer"; sdp: string };
type SignalCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };
export type PeerConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
export type PeerQuality = "good" | "degraded" | "unknown";

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
  isRoomActive: () => boolean;
};

const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean);
const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
if (turnUrls.length > 0 && turnUsername && turnCredential) iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });

const RTC_CONFIGURATION: RTCConfiguration = { iceServers, iceCandidatePoolSize: 10 };

export function useWebRTCSignaling({ socket, roomId, selfId, isHost, peers, localScreenStream, localMicrophoneStream, onRemoteStream, onRemoteMicrophoneStream, onRemotePeerRemoved, isRoomActive }: Props) {
  const connections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const previousScreenStream = useRef<MediaStream | null>(null);
  const microphoneTransceivers = useRef<Map<string, RTCRtpTransceiver>>(new Map());
  const remotePeerIsHost = useRef<Map<string, boolean>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const remoteMicrophoneStreams = useRef<Map<string, MediaStream>>(new Map());
  const dataChannels = useRef<Map<string, Set<RTCDataChannel>>>(new Map());
  const retryAttempts = useRef<Map<string, number>>(new Map());
  const retryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const previousIsHost = useRef(isHost);
  const [states, setStates] = useState<Record<string, PeerConnectionState>>({});
  const [iceStates, setIceStates] = useState<Record<string, RTCIceConnectionState>>({});
  const [quality, setQuality] = useState<Record<string, PeerQuality>>({});
  const [retryVersion, setRetryVersion] = useState(0);

  const setPeerState = useCallback((peerId: string, state: PeerConnectionState) => {
    if (!isRoomActive()) return;
    setStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
  }, [isRoomActive]);

  const setPeerFailedIfCurrent = useCallback((peerId: string, connection: RTCPeerConnection) => {
    if (connections.current.get(peerId) === connection) setPeerState(peerId, "failed");
  }, [setPeerState]);

  const releasePeerResources = useCallback((peerId: string) => {
    const connection = connections.current.get(peerId);
    if (connection) closePeerConnection(connection);
    connections.current.delete(peerId);

    const channels = dataChannels.current.get(peerId);
    channels?.forEach(closeDataChannel);
    dataChannels.current.delete(peerId);

    stopMediaStream(remoteStreams.current.get(peerId));
    stopMediaStream(remoteMicrophoneStreams.current.get(peerId));
    remoteStreams.current.delete(peerId);
    remoteMicrophoneStreams.current.delete(peerId);
    pendingCandidates.current.delete(peerId);
    microphoneTransceivers.current.delete(peerId);
    remotePeerIsHost.current.delete(peerId);

    const retryTimer = retryTimers.current.get(peerId);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimers.current.delete(peerId);
    retryAttempts.current.delete(peerId);
  }, []);

  const removePeer = useCallback((peerId: string) => {
    releasePeerResources(peerId);
    onRemotePeerRemoved(peerId);
    setStates((current) => { const next = { ...current }; delete next[peerId]; return next; });
    setIceStates((current) => { const next = { ...current }; delete next[peerId]; return next; });
    setQuality((current) => { const next = { ...current }; delete next[peerId]; return next; });
  }, [onRemotePeerRemoved, releasePeerResources]);

  const getTrackedPeerIds = useCallback(() => new Set([
    ...connections.current.keys(),
    ...pendingCandidates.current.keys(),
    ...microphoneTransceivers.current.keys(),
    ...remotePeerIsHost.current.keys(),
    ...remoteStreams.current.keys(),
    ...remoteMicrophoneStreams.current.keys(),
    ...dataChannels.current.keys(),
    ...retryAttempts.current.keys(),
    ...retryTimers.current.keys(),
  ]), []);

  const resetConnections = useCallback(() => {
    const peerIds = getTrackedPeerIds();
    peerIds.forEach(releasePeerResources);
    peerIds.forEach(onRemotePeerRemoved);
    previousScreenStream.current = null;
    setStates({});
    setIceStates({});
    setQuality({});
  }, [getTrackedPeerIds, onRemotePeerRemoved, releasePeerResources]);

  const trackDataChannel = useCallback((peerId: string, channel: RTCDataChannel) => {
    const channels = dataChannels.current.get(peerId) ?? new Set<RTCDataChannel>();
    channels.add(channel);
    dataChannels.current.set(peerId, channels);
    channel.onopen = () => setPeerState(peerId, "connected");
    channel.onclose = () => {
      channels.delete(channel);
      if (channels.size === 0) dataChannels.current.delete(peerId);
    };
  }, [setPeerState]);

  const createPeer = useCallback((peerId: string, mode: NegotiationMode, remoteIsHost: boolean) => {
    if (!isRoomActive()) return null;
    const existing = connections.current.get(peerId);
    if (existing) return existing;

    remotePeerIsHost.current.set(peerId, remoteIsHost);
    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    if (mode === "offer") {
      if (isHost) {
      connection.addTransceiver("video", { direction: "sendonly" });
      connection.addTransceiver("audio", { direction: "sendonly" });
      const microphoneTransceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
      microphoneTransceivers.current.set(peerId, microphoneTransceiver);
      } else {
        const microphoneTransceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
        microphoneTransceivers.current.set(peerId, microphoneTransceiver);
      }
    }
    connection.ontrack = (event) => {
      if (!isRoomActive() || connections.current.get(peerId) !== connection) {
        event.track.stop();
        return;
      }
      if (event.track.kind === "audio") {
        let microphoneTransceiver = microphoneTransceivers.current.get(peerId);
        if (!microphoneTransceiver) {
          const audioTransceivers = connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "audio");
          microphoneTransceiver = audioTransceivers.at(-1);
          if (microphoneTransceiver) microphoneTransceivers.current.set(peerId, microphoneTransceiver);
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
      if (event.candidate && socket && isRoomActive() && connections.current.get(peerId) === connection) {
        socket.emit(EVENTS.WEBRTC_ICE_CANDIDATE, {
          roomId,
          targetId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.onconnectionstatechange = () => {
      if (!isRoomActive() || connections.current.get(peerId) !== connection) return;
      setPeerState(peerId, connection.connectionState as PeerConnectionState);
    };
    connection.oniceconnectionstatechange = () => {
      if (!isRoomActive() || connections.current.get(peerId) !== connection) return;
      const state = connection.iceConnectionState;
      setIceStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
      if (state === "checking") setPeerState(peerId, "connecting");
      if (state === "connected" || state === "completed") {
        setPeerState(peerId, "connected");
        retryAttempts.current.delete(peerId);
        const timer = retryTimers.current.get(peerId);
        if (timer) clearTimeout(timer);
        retryTimers.current.delete(peerId);
      }
      if (state === "disconnected") setPeerState(peerId, "disconnected");
      if (state === "failed") {
        setPeerState(peerId, "failed");
        const attempts = retryAttempts.current.get(peerId) ?? 0;
        if (mode === "offer" && attempts < 1 && !retryTimers.current.has(peerId)) {
          retryAttempts.current.set(peerId, attempts + 1);
          const timer = setTimeout(() => {
            retryTimers.current.delete(peerId);
            if (!isRoomActive() || connections.current.get(peerId) !== connection || connection.iceConnectionState !== "failed") return;
            removePeer(peerId);
            retryAttempts.current.set(peerId, attempts + 1);
            setRetryVersion((version) => version + 1);
          }, 1_200);
          retryTimers.current.set(peerId, timer);
        }
      }
    };
    connection.ondatachannel = (event) => {
      if (!isRoomActive() || connections.current.get(peerId) !== connection) {
        closeDataChannel(event.channel);
        return;
      }
      trackDataChannel(peerId, event.channel);
    };
    connections.current.set(peerId, connection);
    setPeerState(peerId, "new");
    return connection;
  }, [isHost, isRoomActive, onRemoteMicrophoneStream, onRemoteStream, removePeer, roomId, setPeerState, socket, trackDataChannel]);

  const flushCandidates = useCallback(async (peerId: string, connection: RTCPeerConnection) => {
    const pending = pendingCandidates.current.get(peerId) ?? [];
    pendingCandidates.current.delete(peerId);
    for (const candidate of pending) {
      if (!isRoomActive() || connections.current.get(peerId) !== connection) return;
      try { await connection.addIceCandidate(new RTCIceCandidate(candidate)); } catch { setPeerFailedIfCurrent(peerId, connection); }
    }
  }, [isRoomActive, setPeerFailedIfCurrent]);

  const createOffer = useCallback(async (peer: Peer) => {
    if (!socket || !roomId || !isRoomActive()) return;
    const connection = createPeer(peer.id, "offer", peer.isHost);
    if (!connection) return;
    // A data channel gives the initial SDP a negotiated section without carrying media.
    const controlChannel = connection.createDataChannel("vynk-control");
    trackDataChannel(peer.id, controlChannel);
    try {
      if (isHost) {
        for (const track of localScreenStream?.getTracks() ?? []) {
          const transceiver = connection.getTransceivers().find((candidate) => candidate.receiver.track.kind === track.kind);
          if (transceiver) await transceiver.sender.replaceTrack(track);
        }
      }
      const microphoneTrack = localMicrophoneStream?.getAudioTracks()[0] ?? null;
      const microphoneTransceiver = microphoneTransceivers.current.get(peer.id);
      if (microphoneTransceiver) await microphoneTransceiver.sender.replaceTrack(microphoneTrack);
      setPeerState(peer.id, "connecting");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      if (!isRoomActive() || connections.current.get(peer.id) !== connection || !socket.connected) return;
      socket.emit(EVENTS.WEBRTC_OFFER, { roomId, targetId: peer.id, sdp: offer });
    } catch {
      setPeerFailedIfCurrent(peer.id, connection);
    }
  }, [createPeer, isHost, isRoomActive, localMicrophoneStream, localScreenStream, roomId, setPeerFailedIfCurrent, setPeerState, socket, trackDataChannel]);

  const renegotiateScreen = useCallback(async (peerId: string) => {
    if (!isRoomActive()) return;
    const connection = connections.current.get(peerId);
    if (!connection) return;
    const desiredTracks = localScreenStream?.getTracks() ?? [];
    const desiredByKind = new Map(desiredTracks.map((track) => [track.kind, track]));
    for (const transceiver of connection.getTransceivers()) {
      if (transceiver === microphoneTransceivers.current.get(peerId)) continue;
      const kind = transceiver.receiver.track.kind;
      if (kind === "video" || kind === "audio") {
        try { await transceiver.sender.replaceTrack(desiredByKind.get(kind) ?? null); } catch { setPeerFailedIfCurrent(peerId, connection); }
      }
    }
    // Fallback for a peer created before media transceivers were available.
    for (const track of desiredTracks) {
      const hasSender = connection.getSenders().some((sender) => sender.track?.id === track.id);
      if (!hasSender && !connection.getTransceivers().some((transceiver) => transceiver.receiver.track.kind === track.kind)) {
        connection.addTrack(track, localScreenStream!);
      }
    }
  }, [isRoomActive, localScreenStream, setPeerFailedIfCurrent]);

  useEffect(() => {
    if (!socket || !roomId || !selfId) return;

    const onOffer = async (data: { fromId: string; roomId: string; sdp: SignalDescription }) => {
      if (!isRoomActive() || data.roomId !== roomId || data.fromId === selfId) return;
      const remoteIsHost = peers.find((peer) => peer.id === data.fromId)?.isHost ?? false;
      const connection = createPeer(data.fromId, "answer", remoteIsHost);
      if (!connection) return;
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (!isRoomActive() || connections.current.get(data.fromId) !== connection) return;
        const audioTransceivers = connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "audio");
        const microphoneTransceiver = audioTransceivers.at(-1);
        if (microphoneTransceiver) {
          microphoneTransceiver.direction = "sendrecv";
          microphoneTransceivers.current.set(data.fromId, microphoneTransceiver);
          await microphoneTransceiver.sender.replaceTrack(localMicrophoneStream?.getAudioTracks()[0] ?? null);
        }
        if (!isRoomActive() || connections.current.get(data.fromId) !== connection) return;
        await flushCandidates(data.fromId, connection);
        if (!isRoomActive() || connections.current.get(data.fromId) !== connection) return;
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        if (!isRoomActive() || connections.current.get(data.fromId) !== connection || !socket.connected) return;
        setPeerState(data.fromId, "connecting");
        socket.emit(EVENTS.WEBRTC_ANSWER, { roomId, targetId: data.fromId, sdp: answer });
      } catch {
        setPeerFailedIfCurrent(data.fromId, connection);
      }
    };

    const onAnswer = async (data: { fromId: string; roomId: string; sdp: SignalDescription }) => {
      if (!isRoomActive() || data.roomId !== roomId || data.fromId === selfId) return;
      const connection = connections.current.get(data.fromId);
      if (!connection || connection.signalingState !== "have-local-offer") return;
      try {
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (!isRoomActive() || connections.current.get(data.fromId) !== connection) return;
        await flushCandidates(data.fromId, connection);
      } catch {
        setPeerFailedIfCurrent(data.fromId, connection);
      }
    };

    const onCandidate = async (data: { fromId: string; roomId: string; candidate: SignalCandidate }) => {
      if (!isRoomActive() || data.roomId !== roomId || data.fromId === selfId) return;
      const remoteIsHost = peers.find((peer) => peer.id === data.fromId)?.isHost ?? false;
      const connection = createPeer(data.fromId, "answer", remoteIsHost);
      if (!connection) return;
      if (!connection.remoteDescription) {
        const current = pendingCandidates.current.get(data.fromId) ?? [];
        current.push(data.candidate);
        pendingCandidates.current.set(data.fromId, current);
        return;
      }
      if (!isRoomActive() || connections.current.get(data.fromId) !== connection) return;
      try { await connection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch { setPeerFailedIfCurrent(data.fromId, connection); }
    };

    socket.on(EVENTS.WEBRTC_OFFER, onOffer);
    socket.on(EVENTS.WEBRTC_ANSWER, onAnswer);
    socket.on(EVENTS.WEBRTC_ICE_CANDIDATE, onCandidate);
    return () => {
      socket.off(EVENTS.WEBRTC_OFFER, onOffer);
      socket.off(EVENTS.WEBRTC_ANSWER, onAnswer);
      socket.off(EVENTS.WEBRTC_ICE_CANDIDATE, onCandidate);
    };
  }, [createPeer, flushCandidates, isRoomActive, localMicrophoneStream, peers, roomId, selfId, setPeerFailedIfCurrent, setPeerState, socket]);

  useEffect(() => {
    if (!socket) return;
    socket.on("disconnect", resetConnections);
    return () => { socket.off("disconnect", resetConnections); };
  }, [resetConnections, socket]);

  useEffect(() => {
    if (!isRoomActive()) return;
    const microphoneTrack = localMicrophoneStream?.getAudioTracks()[0] ?? null;
    microphoneTransceivers.current.forEach((transceiver, peerId) => {
      const connection = connections.current.get(peerId);
      if (connection) void transceiver.sender.replaceTrack(microphoneTrack).catch(() => setPeerFailedIfCurrent(peerId, connection));
    });
  }, [isRoomActive, localMicrophoneStream, setPeerFailedIfCurrent]);

  useEffect(() => {
    if (!isRoomActive() || previousIsHost.current === isHost) return;
    previousIsHost.current = isHost;
    if (!isHost) return;
    getTrackedPeerIds().forEach(removePeer);
  }, [getTrackedPeerIds, isHost, isRoomActive, removePeer]);

  useEffect(() => {
    if (!socket?.connected || !selfId || !isRoomActive()) return;
    const screenChanged = previousScreenStream.current !== localScreenStream;
    previousScreenStream.current = localScreenStream;
    if (isHost && screenChanged) {
      for (const peer of peers) {
        if (peer.id !== selfId && connections.current.has(peer.id)) void renegotiateScreen(peer.id);
      }
    }
    for (const peer of peers) {
      const shouldInitiate = isHost ? !peer.isHost : !peer.isHost && selfId < peer.id;
      if (peer.id !== selfId && !connections.current.has(peer.id) && shouldInitiate) void createOffer(peer);
    }
  }, [createOffer, isHost, isRoomActive, localScreenStream, peers, renegotiateScreen, retryVersion, selfId, socket]);

  useEffect(() => {
    const activeIds = new Set(peers.map((peer) => peer.id));
    getTrackedPeerIds().forEach((peerId) => {
      if (peerId === selfId || activeIds.has(peerId)) return;
      removePeer(peerId);
    });
  }, [getTrackedPeerIds, peers, removePeer, selfId]);

  useEffect(() => () => {
    getTrackedPeerIds().forEach(releasePeerResources);
    previousScreenStream.current = null;
  }, [getTrackedPeerIds, releasePeerResources]);

  useEffect(() => {
    let cancelled = false;
    const sampleQuality = async () => {
      if (!isRoomActive()) return;
      const entries = [...connections.current.entries()];
      const next: Record<string, PeerQuality> = {};
      await Promise.all(entries.map(async ([peerId, connection]) => {
        if (connection.connectionState !== "connected") {
          next[peerId] = connection.connectionState === "new" || connection.connectionState === "connecting" ? "unknown" : "degraded";
          return;
        }
        try {
          const reports = await connection.getStats();
          let packetsLost = 0;
          let packetsReceived = 0;
          let roundTripTime: number | null = null;
          let hasMedia = false;
          reports.forEach((report) => {
            if (report.type === "inbound-rtp" || report.type === "outbound-rtp") hasMedia = true;
            if (report.type === "inbound-rtp") {
              packetsLost += report.packetsLost ?? 0;
              packetsReceived += report.packetsReceived ?? 0;
            }
            if (report.type === "candidate-pair" && report.state === "succeeded" && typeof report.currentRoundTripTime === "number") {
              roundTripTime = report.currentRoundTripTime;
            }
          });
          if (!hasMedia) {
            next[peerId] = "unknown";
            return;
          }
          const lossRatio = packetsReceived + packetsLost > 0 ? packetsLost / (packetsReceived + packetsLost) : 0;
          next[peerId] = lossRatio > 0.05 || (roundTripTime !== null && roundTripTime > 0.4) ? "degraded" : "good";
        } catch {
          next[peerId] = "unknown";
        }
      }));
      if (!cancelled && isRoomActive()) setQuality(next);
    };
    void sampleQuality();
    const timer = window.setInterval(() => { void sampleQuality(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isRoomActive]);

  return { states, iceStates, quality, closeAllConnections: resetConnections };
}
