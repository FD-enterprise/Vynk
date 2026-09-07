"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS, MAX_CHAT_MESSAGE_LENGTH, MAX_PARTICIPANTS, type ChatMessage, type Participant } from "@/lib/events";
import { useSocket } from "@/hooks/useSocket";
import { getParticipantSessionId } from "@/lib/socket";
import { isOwnChatMessage } from "@/lib/chatIdentity";
import { createRoomLifecycleToken, RoomLifecycleGuard } from "@/lib/mediaLifecycle";
import { useWebRTCSignaling, type PeerQuality } from "@/hooks/useWebRTCSignaling";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useMicrophone } from "@/hooks/useMicrophone";
import { useVoiceActivity } from "@/hooks/useVoiceActivity";
import { getRemoteAudioPlaybackState, RemoteAudio, resumeRemoteAudioContext, type RemoteAudioPlaybackState } from "@/components/RemoteAudio";

type IconName = "arrow" | "check" | "copy" | "expand" | "headphones" | "lock" | "mic" | "monitor" | "send" | "shrink" | "users" | "volume" | "x";
type JoinRequest = { roomId: string; participantId: string; participantName: string };
type JoinPhase = "connecting" | "pending" | "joined" | "rejected";

function networkTone(quality: PeerQuality | undefined): "good" | "degraded" | "poor" | "unknown" {
  return quality ?? "unknown";
}

function networkLabel(quality: PeerQuality | undefined): string {
  if (quality === "good") return "Boa";
  if (quality === "degraded") return "Mais ou menos";
  if (quality === "poor") return "Ruim";
  return "Conectando";
}

function formatPing(value: number | null | undefined): string {
  return typeof value === "number" ? `${value} ms` : "—";
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string[]> = {
    arrow: ["M5 12h13", "m12 6 6 6-6 6"],
    check: ["m5 12 4 4L19 6"],
    copy: ["M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2", "M6 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"],
    expand: ["M8 3H3v5", "m3 3 6 6", "M16 3h5v5", "m21 3-6 6", "M8 21H3v-5", "m3 21 6-6", "M16 21h5v-5", "m21 21-6-6"],
    headphones: ["M3 18v-6a9 9 0 0 1 18 0v6", "M3 18a2 2 0 0 0 2 2h2v-8H5a2 2 0 0 0-2 2v4Z", "M21 18a2 2 0 0 1-2 2h-2v-8h2a2 2 0 0 1 2 2v4Z"],
    lock: ["M7 10V7a5 5 0 0 1 10 0v3", "M5 10h14v10H5z", "M12 14v2"],
    mic: ["M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z", "M19 11v1a7 7 0 0 1-14 0v-1", "M12 19v3", "M8 22h8"],
    monitor: ["M4 5h16v11H4z", "M8 21h8", "M12 16v5"],
    send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
    shrink: ["M8 3v5H3", "m9 9-6-6", "M16 3v5h5", "m15 9 6-6", "M8 21v-5H3", "m9 15-6 6", "M16 21v-5h5", "m15 15 6 6"],
    users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
    volume: ["M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
    x: ["m6 6 12 12", "m18 6-12 12"],
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name].map((path) => <path key={path} d={path} />)}</svg>;
}

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomId = ((params?.code as string) ?? "").toUpperCase();
  const [roomLifecycle] = useState(() => new RoomLifecycleGuard());
  const roomToken = useMemo(() => createRoomLifecycleToken(roomId), [roomId]);
  const { socket, state: connState, error: socketError } = useSocket();
  const [name] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("vynk_name") || "" : ""));
  const [participantSessionId] = useState(() => (typeof window !== "undefined" ? getParticipantSessionId() : ""));
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
  const [screenRequest, setScreenRequest] = useState<{ participantId: string; participantName: string } | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinRequestNotificationsEnabled, setJoinRequestNotificationsEnabled] = useState(true);
  const [joinPhase, setJoinPhase] = useState<JoinPhase>("connecting");
  const [screenRequestSent, setScreenRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteMicrophoneStreams, setRemoteMicrophoneStreams] = useState<Map<string, MediaStream>>(new Map());
  const [audioPlaybackStates, setAudioPlaybackStates] = useState<Map<string, RemoteAudioPlaybackState>>(new Map());
  const [screenVolume, setScreenVolume] = useState(100);
  const [participantVolumes, setParticipantVolumes] = useState<Map<string, number>>(new Map());
  const [isDeafened, setIsDeafened] = useState(false);
  const [promptName, setPromptName] = useState(name);
  const [needsName, setNeedsName] = useState(false);
  const isHostRef = useRef(false);
  const joinPhaseRef = useRef<JoinPhase>("connecting");
  const screenRequestSentRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLLIElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    roomLifecycle.activate(roomToken);
  }, [roomLifecycle, roomToken]);

  const handleScreenStopped = useCallback(() => {
    if (socket?.connected) socket.emit(EVENTS.SCREEN_STOPPED, { roomId });
  }, [roomId, socket]);
  const screen = useScreenShare(handleScreenStopped);
  const handleMicrophoneState = useCallback((muted: boolean) => {
    if (socket?.connected) socket.emit(EVENTS.MICROPHONE_STATE, { roomId, muted });
  }, [roomId, socket]);
  const microphone = useMicrophone(handleMicrophoneState, { autoStart: joinPhase === "joined" });
  const stopScreen = screen.stop;
  const stopMicrophone = microphone.stop;
  const microphoneStateRef = useRef(microphone.state);
  const microphoneMutedRef = useRef(microphone.muted);

  const updateJoinPhase = (phase: JoinPhase) => {
    joinPhaseRef.current = phase;
    setJoinPhase(phase);
  };

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    screenRequestSentRef.current = screenRequestSent;
  }, [screenRequestSent]);

  useEffect(() => {
    microphoneStateRef.current = microphone.state;
  }, [microphone.state]);

  useEffect(() => {
    microphoneMutedRef.current = microphone.muted;
  }, [microphone.muted]);

  useEffect(() => {
    if (!name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNeedsName(true);
    }
  }, [name]);

  useEffect(() => {
    if (!socket || !roomId || needsName) return;
    const effectiveName = (name || promptName).trim();
    if (!effectiveName) return;
    const onJoined = (data: { roomId: string; participants: Participant[]; chatMessages?: ChatMessage[]; screenSharerId?: string | null; joinRequestNotificationsEnabled?: boolean }) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId) return;
      updateJoinPhase("joined");
      setParticipants(data.participants);
      setChatMessages(data.chatMessages ?? []);
      setScreenSharerId(data.screenSharerId ?? null);
      setJoinRequests([]);
      screenRequestSentRef.current = false;
      setScreenRequestSent(false);
      const me = data.participants.find((p) => p.id === socket.id);
      setIsHost(!!me?.isHost);
      setIsDeafened(!!me?.deafened);
      setJoinRequestNotificationsEnabled(data.joinRequestNotificationsEnabled ?? true);
      socket.emit(EVENTS.MICROPHONE_STATE, { roomId, muted: microphoneStateRef.current !== "active" || microphoneMutedRef.current });
    };
    const onParticipants = (data: { roomId: string; participants: Participant[] }) => { if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId) return; setParticipants(data.participants); const me = data.participants.find((p) => p.id === socket.id); setIsHost(!!me?.isHost); setIsDeafened(!!me?.deafened); };
    const onHostChanged = (data: { roomId: string; hostId: string; joinRequestNotificationsEnabled?: boolean }) => { if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId) return; setParticipants((prev) => prev.map((p) => ({ ...p, isHost: p.id === data.hostId, canShareScreen: p.id === data.hostId ? true : p.canShareScreen }))); setIsHost(data.hostId === socket.id); if (data.hostId === socket.id) setJoinRequestNotificationsEnabled(data.joinRequestNotificationsEnabled ?? true); };
    const onError = (data: { message: string; roomId?: string }) => {
      if (!roomLifecycle.isActive(roomToken) || (data.roomId && data.roomId !== roomId)) return;
      setError(data.message);
      if (joinPhaseRef.current !== "joined") updateJoinPhase("rejected");
      if (data.message.includes("autorizou") || data.message.includes("Outra pessoa")) stopScreen();
    };
    const onSocketDisconnect = () => { if (roomLifecycle.isActive(roomToken)) { setParticipants([]); setIsDeafened(false); } };
    const onScreenStopped = (data: { roomId: string }) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId) return;
      setScreenSharerId(null);
      setRemoteStreams(new Map());
      setAudioPlaybackStates((current) => new Map([...current].filter(([peerId]) => !peerId.endsWith(":screen"))));
    };
    const onScreenStarted = (data: { roomId: string; sharerId?: string; hostId?: string }) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId) return;
      setScreenSharerId(data.sharerId ?? data.hostId ?? null);
    };
    const onScreenRequest = (data: { roomId: string; participantId: string; participantName: string }) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId || !isHostRef.current) return;
      setScreenRequest({ participantId: data.participantId, participantName: data.participantName });
    };
    const onJoinRequest = (data: JoinRequest) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId || !isHostRef.current) return;
      setJoinRequests((current) => current.some((request) => request.participantId === data.participantId) ? current : [...current, data]);
    };
    const onJoinSettingsUpdated = (data: { roomId: string; enabled: boolean }) => { if (data.roomId === roomId) setJoinRequestNotificationsEnabled(data.enabled); };
    const onJoinPending = (data: { roomId: string }) => { if (data.roomId === roomId) updateJoinPhase("pending"); };
    const onJoinResult = (data: { roomId: string; allowed: boolean; message: string }) => {
      if (data.roomId !== roomId) return;
      if (!data.allowed) { setError(data.message); updateJoinPhase("rejected"); return; }
      if (joinPhaseRef.current !== "joined") socket.emit(EVENTS.ROOM_JOIN, { roomId, name: effectiveName, sessionId: getParticipantSessionId() });
    };
    const onScreenPermission = (data: { roomId: string; participantId: string; allowed: boolean }) => {
      if (!roomLifecycle.isActive(roomToken) || data.roomId !== roomId || data.participantId !== socket.id) return;
      const wasRequest = screenRequestSentRef.current;
      screenRequestSentRef.current = false;
      setScreenRequestSent(false);
      if (!data.allowed) {
        stopScreen();
        setError(wasRequest ? "O host recusou sua solicitação para transmitir." : "O host removeu sua permissão para transmitir.");
      }
    };
    const onMicrophoneState = (data: { roomId: string; participantId: string; muted: boolean }) => {
      if (data.roomId !== roomId || !roomLifecycle.isActive(roomToken)) return;
      setParticipants((current) => current.map((participant) => participant.id === data.participantId ? { ...participant, micMuted: data.muted } : participant));
    };
    const onChatMessage = (data: ChatMessage) => {
      if (data.roomId !== roomId || !roomLifecycle.isActive(roomToken)) return;
      setChatMessages((current) => [...current, data].slice(-200));
    };
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_PARTICIPANTS, onParticipants);
    socket.on(EVENTS.PRESENCE_UPDATE, onParticipants);
    socket.on(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
    socket.on(EVENTS.ROOM_ERROR, onError);
    socket.on(EVENTS.SCREEN_REQUEST, onScreenRequest);
    socket.on(EVENTS.ROOM_JOIN_REQUEST, onJoinRequest);
    socket.on(EVENTS.ROOM_JOIN_SETTINGS_UPDATED, onJoinSettingsUpdated);
    socket.on(EVENTS.ROOM_JOIN_PENDING, onJoinPending);
    socket.on(EVENTS.ROOM_JOIN_RESULT, onJoinResult);
    socket.on(EVENTS.SCREEN_PERMISSION, onScreenPermission);
    socket.on(EVENTS.SCREEN_STARTED, onScreenStarted);
    socket.on(EVENTS.SCREEN_STOPPED, onScreenStopped);
    socket.on(EVENTS.MICROPHONE_STATE, onMicrophoneState);
    socket.on(EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on("disconnect", onSocketDisconnect);
    const emitJoin = () => { if (roomLifecycle.isActive(roomToken)) socket.emit(EVENTS.ROOM_JOIN, { roomId, name: effectiveName, sessionId: getParticipantSessionId() }); };
    if (socket.connected) emitJoin(); else socket.once("connect", emitJoin);
    return () => {
      if (joinPhaseRef.current === "pending") socket.emit(EVENTS.ROOM_JOIN_CANCEL, { roomId });
      socket.off(EVENTS.ROOM_JOINED, onJoined);
      socket.off(EVENTS.ROOM_PARTICIPANTS, onParticipants);
      socket.off(EVENTS.PRESENCE_UPDATE, onParticipants);
      socket.off(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off(EVENTS.SCREEN_REQUEST, onScreenRequest);
      socket.off(EVENTS.ROOM_JOIN_REQUEST, onJoinRequest);
      socket.off(EVENTS.ROOM_JOIN_SETTINGS_UPDATED, onJoinSettingsUpdated);
      socket.off(EVENTS.ROOM_JOIN_PENDING, onJoinPending);
      socket.off(EVENTS.ROOM_JOIN_RESULT, onJoinResult);
      socket.off(EVENTS.SCREEN_PERMISSION, onScreenPermission);
      socket.off(EVENTS.SCREEN_STARTED, onScreenStarted);
      socket.off(EVENTS.SCREEN_STOPPED, onScreenStopped);
      socket.off(EVENTS.MICROPHONE_STATE, onMicrophoneState);
      socket.off(EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off("disconnect", onSocketDisconnect);
      socket.off("connect", emitJoin);
    };
  }, [socket, roomId, roomLifecycle, roomToken, name, promptName, needsName, stopScreen]);

  useEffect(() => {
    if (!socket) return;
    const onReconnect = () => { if (!roomLifecycle.isActive(roomToken)) return; setError(null); const n = (localStorage.getItem("vynk_name") || promptName || name).trim(); if (n && roomId) socket.emit(EVENTS.ROOM_JOIN, { roomId, name: n, sessionId: getParticipantSessionId() }); };
    socket.io.on("reconnect", onReconnect);
    return () => { socket.io.off("reconnect", onReconnect); };
  }, [socket, roomId, roomLifecycle, roomToken, promptName, name]);

  const handleRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    if (!roomLifecycle.isActive(roomToken)) return;
    setRemoteStreams((current) => {
      const next = new Map(current);
      next.set(peerId, stream);
      return next;
    });
  }, [roomLifecycle, roomToken]);
  const handleRemoteMicrophoneStream = useCallback((peerId: string, stream: MediaStream) => {
    if (!roomLifecycle.isActive(roomToken)) return;
    setRemoteMicrophoneStreams((current) => {
      const next = new Map(current);
      next.set(peerId, stream);
      return next;
    });
  }, [roomLifecycle, roomToken]);
  const handleAudioPlaybackState = useCallback((peerId: string, state: RemoteAudioPlaybackState) => {
    if (!roomLifecycle.isActive(roomToken)) return;
    setAudioPlaybackStates((current) => {
      if (current.get(peerId) === state) return current;
      const next = new Map(current);
      next.set(peerId, state);
      return next;
    });
  }, [roomLifecycle, roomToken]);
  const handleRemotePeerRemoved = useCallback((peerId: string) => {
    if (!roomLifecycle.isActive(roomToken)) return;
    setRemoteStreams((current) => {
      const next = new Map(current);
      next.delete(peerId);
      return next;
    });
    setRemoteMicrophoneStreams((current) => {
      const next = new Map(current);
      next.delete(peerId);
      return next;
    });
    setAudioPlaybackStates((current) => {
      const next = new Map(current);
      next.delete(peerId);
      next.delete(`${peerId}:screen`);
      return next;
    });
    setParticipantVolumes((current) => {
      if (!current.has(peerId)) return current;
      const next = new Map(current);
      next.delete(peerId);
      return next;
    });
  }, [roomLifecycle, roomToken]);

  const handleParticipantVolumeChange = useCallback((peerId: string, volume: number) => {
    setParticipantVolumes((current) => {
      const next = new Map(current);
      next.set(peerId, volume);
      return next;
    });
  }, []);

  const isRoomActive = useCallback(() => roomLifecycle.isActive(roomToken), [roomLifecycle, roomToken]);

  const { states: peerStates, quality: peerQuality, latency: peerLatency, closeAllConnections } = useWebRTCSignaling({
    socket,
    roomId,
    selfId: socket?.id ?? "",
    isHost,
    peers: participants.filter((participant) => participant.presence === "online").map((participant) => ({ id: participant.id, isHost: participant.isHost })),
    localScreenStream: screen.stream,
    localMicrophoneStream: microphone.stream,
    onRemoteStream: handleRemoteStream,
    onRemoteMicrophoneStream: handleRemoteMicrophoneStream,
    onRemotePeerRemoved: handleRemotePeerRemoved,
    isRoomActive,
  });

  const remoteScreenStream = [...remoteStreams.values()].find((stream) => stream.getVideoTracks().some((track) => !track.muted && track.readyState === "live")) ?? null;
  const displayStream = screen.state === "sharing" ? screen.stream : remoteScreenStream;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = displayStream;
    return () => {
      video.pause();
      if (video.srcObject === displayStream) video.srcObject = null;
    };
  }, [displayStream]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!displayStream && document.fullscreenElement === stageRef.current && typeof document.exitFullscreen === "function") void document.exitFullscreen().catch(() => undefined);
  }, [displayStream]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages]);

  const clearRoomState = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setParticipants([]);
    setScreenSharerId(null);
    setScreenRequest(null);
    setJoinRequests([]);
    screenRequestSentRef.current = false;
    setScreenRequestSent(false);
    setRemoteStreams(new Map());
    setRemoteMicrophoneStreams(new Map());
    setAudioPlaybackStates(new Map());
    setParticipantVolumes(new Map());
    setIsDeafened(false);
    setChatMessages([]);
    setChatDraft("");
    setChatError(null);
    setIsHost(false);
  }, []);

  const releaseRoom = useCallback(() => {
    if (!roomLifecycle.beginLeave(roomToken)) return;
    stopScreen();
    stopMicrophone();
    closeAllConnections();
    if (socket?.connected) socket.emit(EVENTS.ROOM_LEAVE, { roomId });
    clearRoomState();
    if (document.fullscreenElement === stageRef.current && typeof document.exitFullscreen === "function") void document.exitFullscreen().catch(() => undefined);
  }, [clearRoomState, closeAllConnections, roomId, roomLifecycle, roomToken, socket, stopMicrophone, stopScreen]);

  useEffect(() => {
    const onPopState = () => releaseRoom();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      const roomPath = `/room/${roomId}`.toUpperCase();
      if (window.location.pathname.toUpperCase() !== roomPath) releaseRoom();
    };
  }, [releaseRoom, roomId]);

  const handleLeave = () => { releaseRoom(); router.push("/"); };
  const handleCancelJoin = () => {
    if (socket?.connected) socket.emit(EVENTS.ROOM_JOIN_CANCEL, { roomId });
    router.push("/");
  };
  const handleCopy = async () => { await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`); };
  const handleRequestScreen = () => {
    if (!socket?.connected || isHost || screenRequestSent) return;
    socket.emit(EVENTS.SCREEN_REQUEST, { roomId });
    screenRequestSentRef.current = true;
    setScreenRequestSent(true);
  };
  const handleScreenPermission = (participantId: string, allowed: boolean) => {
    if (!socket?.connected || !isHost) return;
    socket.emit(EVENTS.SCREEN_PERMISSION, { roomId, participantId, allowed });
    if (screenRequest?.participantId === participantId) setScreenRequest(null);
  };
  const handleJoinDecision = (participantId: string, allowed: boolean) => {
    if (!socket?.connected || !isHost) return;
    socket.emit(EVENTS.ROOM_JOIN_DECISION, { roomId, participantId, allowed });
    setJoinRequests((current) => current.filter((request) => request.participantId !== participantId));
  };
  const handleJoinNotificationsChange = (enabled: boolean) => {
    if (!socket?.connected || !isHost) return;
    setJoinRequestNotificationsEnabled(enabled);
    socket.emit(EVENTS.ROOM_JOIN_SETTINGS, { roomId, enabled });
  };
  const handleShare = async () => {
    const me = participants.find((participant) => participant.id === socket?.id);
    if (!isHost && !me?.canShareScreen) return;
    if (screen.state === "sharing") {
      screen.stop();
      return;
    }
    if (screenSharerId && screenSharerId !== socket?.id) {
      setError("Outra pessoa jÃ¡ estÃ¡ transmitindo a tela.");
      return;
    }
    const stream = await screen.start();
    if (stream && roomLifecycle.isActive(roomToken) && socket?.connected) socket.emit(EVENTS.SCREEN_STARTED, { roomId });
  };
  const handleFullscreen = async () => {
    if (!stageRef.current || !displayStream) return;
    try {
      if (document.fullscreenElement === stageRef.current) {
        if (typeof document.exitFullscreen !== "function") throw new Error("Fullscreen exit is unavailable");
        await document.exitFullscreen();
      } else {
        if (typeof stageRef.current.requestFullscreen !== "function") throw new Error("Fullscreen is unavailable");
        await stageRef.current.requestFullscreen();
      }
    } catch {
      setError("A tela cheia não está disponível neste navegador.");
    }
  };
  const handleMicrophone = async () => {
    if (isDeafened) updateDeafenedState(false);
    if (microphone.state === "active" || microphone.state === "requesting-permission") return;
    await microphone.start();
  };
  const handleToggleMicrophone = () => {
    if (microphone.state !== "active") return;
    if (isDeafened) {
      updateDeafenedState(false);
      microphone.unmute();
      return;
    }
    microphone.toggle();
  };
  const updateDeafenedState = (deafened: boolean) => {
    setIsDeafened(deafened);
    if (socket?.connected) socket.emit(EVENTS.AUDIO_OUTPUT_STATE, { roomId, deafened });
  };
  const handleToggleDeafen = () => {
    const nextDeafened = !isDeafened;
    updateDeafenedState(nextDeafened);
    if (nextDeafened && microphone.state === "active") microphone.mute();
  };
  const handleParticipantMicrophone = () => {
    if (microphone.state === "requesting-permission") return;
    if (microphone.state === "active") {
      handleToggleMicrophone();
      return;
    }
    void handleMicrophone();
  };
  const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text) {
      setChatError("Digite uma mensagem antes de enviar.");
      return;
    }
    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      setChatError(`A mensagem deve ter no máximo ${MAX_CHAT_MESSAGE_LENGTH} caracteres.`);
      return;
    }
    if (!socket?.connected) {
      setChatError("A conexão caiu. Aguarde a reconexão para enviar.");
      return;
    }
    socket.emit(EVENTS.CHAT_SEND, { roomId, text });
    setChatDraft("");
    setChatError(null);
  };
  const handleChatKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const handleEnableCallAudio = async () => {
    await resumeRemoteAudioContext();
    const players = [...document.querySelectorAll<HTMLAudioElement>("[data-vynk-remote-audio]")];
    for (const player of players) {
      const peerId = player.dataset.vynkRemoteAudio;
      if (!peerId || audioPlaybackStates.get(peerId) !== "blocked") continue;
      player.play()
        .then(() => handleAudioPlaybackState(peerId, "playing"))
        .catch((cause) => handleAudioPlaybackState(peerId, getRemoteAudioPlaybackState(cause)));
    }
  };
  const hasBlockedAudio = [...audioPlaybackStates.values()].some((state) => state === "blocked");
  const hasAudioError = [...audioPlaybackStates.values()].some((state) => state === "error");
  const qualityValues = Object.values(peerQuality);
  const mediaQuality = qualityValues.length === 0 ? null : qualityValues.includes("poor") ? "ruim" : qualityValues.includes("degraded") ? "instável" : qualityValues.every((value) => value === "good") ? "estável" : "conectando";
  const overallQuality = qualityValues.includes("poor") ? "poor" : qualityValues.includes("degraded") ? "degraded" : qualityValues.length > 0 && qualityValues.every((value) => value === "good") ? "good" : "unknown";
  const measuredPings = Object.values(peerLatency).filter((value): value is number => typeof value === "number");
  const overallPing = measuredPings.length > 0 ? Math.round(measuredPings.reduce((sum, value) => sum + value, 0) / measuredPings.length) : null;
  const myId = socket?.id ?? "";
  const voiceStreams = useMemo(() => {
    const next = new Map(remoteMicrophoneStreams);
    if (myId && microphone.stream) next.set(myId, microphone.stream);
    return next;
  }, [microphone.stream, myId, remoteMicrophoneStreams]);
  const speakingParticipantIds = useVoiceActivity(voiceStreams);
  const failedPeerNames = participants.filter((participant) => participant.id !== myId && peerStates[participant.id] === "failed").map((participant) => participant.name);
  const participantCount = participants.filter((p) => p.presence !== "offline").length;
  const me = participants.find((participant) => participant.id === myId);
  const canShareScreen = isHost || !!me?.canShareScreen;
  const isScreenSharer = screenSharerId === myId;
  const connectionLabel = connState === "connected" ? "Conectado" : connState === "reconnecting" ? "Reconectando" : connState === "error" ? "Sem conexão" : "Conectando";
  const connectionTone = connState === "connected" ? "online" : connState === "reconnecting" ? "warning" : "offline";
  const screenSurfaceLabel = screen.surface === "monitor" ? "Tela inteira" : screen.surface === "window" ? "Janela" : screen.surface === "browser" ? "Aba do navegador" : "Tela selecionada";
  const supportsFullscreen = typeof document !== "undefined" && typeof HTMLElement.prototype.requestFullscreen === "function";

  if (needsName) {
    return (
      <div className="vynk-gate">
        <div className="vynk-gate-glow" aria-hidden="true" />
        <div className="vynk-gate-card">
          <div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div>
          <span className="vynk-eyebrow">ENTRAR NA SALA</span>
          <h1>Pronto para se conectar?</h1>
          <p>Escolha como você quer aparecer na sala <strong>{roomId}</strong>.</p>
          <label htmlFor="room-name">Seu nome</label>
          <input id="room-name" autoFocus value={promptName} onChange={(e) => setPromptName(e.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && promptName.trim()) { localStorage.setItem("vynk_name", promptName.trim()); setNeedsName(false); } }} placeholder="Como devemos chamar você?" maxLength={24} />
          <button onClick={() => { if (!promptName.trim()) return; localStorage.setItem("vynk_name", promptName.trim()); setNeedsName(false); }} disabled={!promptName.trim()} className="vynk-primary-button">Entrar na sala <Icon name="arrow" size={17} /></button>
          <span className="vynk-gate-note"><Icon name="lock" size={13} /> Seu nome é temporário e só aparece nesta sala.</span>
        </div>
      </div>
    );
  }

  if (joinPhase !== "joined") {
    const isPending = joinPhase === "pending";
    return (
      <div className="vynk-gate">
        <div className="vynk-gate-glow" aria-hidden="true" />
        <div className="vynk-gate-card">
          <div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div>
          <span className="vynk-eyebrow">ENTRADA NA SALA</span>
          <h1>{isPending ? "Pedido enviado" : joinPhase === "rejected" ? "Entrada não autorizada" : "Conectando à sala"}</h1>
          <p>{isPending ? <>O host precisa aprovar sua entrada na sala <strong>{roomId}</strong>. Você será conectado assim que ele permitir.</> : error || socketError || "Aguarde enquanto verificamos sua entrada."}</p>
          {isPending ? <button onClick={handleCancelJoin} className="vynk-primary-button">Cancelar pedido <Icon name="x" size={17} /></button> : <button onClick={() => router.push("/")} className="vynk-primary-button">Voltar ao início <Icon name="arrow" size={17} /></button>}
          <span className="vynk-gate-note"><Icon name="lock" size={13} /> A entrada é aprovada pelo host.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="vynk-shell">
      <header className="vynk-topbar">
        <div className="vynk-topbar-left">
          <div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div>
          <span className="vynk-divider" aria-hidden="true" />
          <div className="vynk-room-context"><span className="vynk-eyebrow">SALA</span><span className="vynk-room-code">{roomId}</span></div>
          <span className={`vynk-connection ${connectionTone}`}><span className="vynk-status-dot" />{connectionLabel}</span>
        </div>
        <div className="vynk-topbar-actions">
          <span className="vynk-member-count"><Icon name="users" size={15} /> {participantCount}/{MAX_PARTICIPANTS}</span>
          <button onClick={handleCopy} className="vynk-quiet-button"><Icon name="copy" size={15} /><span className="hidden sm:inline">Copiar link</span><span className="sm:hidden">Copiar</span></button>
          <button onClick={handleLeave} className="vynk-leave-button"><Icon name="x" size={15} /><span>Sair</span></button>
        </div>
      </header>
      {(error || socketError) && <div className="vynk-alert" role="alert"><span className="vynk-alert-mark">!</span><span>{error || socketError}</span><button onClick={() => setError(null)} aria-label="Fechar aviso"><Icon name="x" size={15} /></button></div>}
      {[...remoteMicrophoneStreams.entries()].map(([peerId, stream]) => <RemoteAudio key={peerId} peerId={peerId} stream={stream} volume={(participantVolumes.get(peerId) ?? 100) / 100} muted={isDeafened} onPlaybackStateChange={handleAudioPlaybackState} />)}
      {[...remoteStreams.entries()].filter(([, stream]) => stream.getAudioTracks().some((track) => track.readyState === "live")).map(([peerId, stream]) => <RemoteAudio key={`${peerId}:screen`} peerId={`${peerId}:screen`} stream={stream} volume={screenVolume / 100} muted={isDeafened} onPlaybackStateChange={handleAudioPlaybackState} />)}
      <main className="vynk-workspace">
        <section className="vynk-stage-column" aria-label="Palco da sala">
          <div className="vynk-stage-heading"><div><span className="vynk-eyebrow">TRANSMISSÃO AO VIVO</span><h1>{displayStream ? "Tela compartilhada" : "Palco da sala"}</h1></div><span className={`vynk-stage-state ${displayStream ? "active" : ""}`}><span className="vynk-status-dot" />{displayStream ? "Ao vivo" : "Aguardando tela"}</span></div>
          <div ref={stageRef} className="vynk-stage">
            <div className="vynk-stage-grid" aria-hidden="true" />
            {displayStream && <video ref={videoRef} autoPlay muted playsInline className="vynk-stage-video" />}
            {!displayStream && <div className="vynk-stage-empty"><div className="vynk-stage-icon"><Icon name="monitor" size={28} /></div><span className="vynk-eyebrow">{isHost ? "VOCÊ É O HOST" : "SALA EM ESPERA"}</span><h2>{isHost ? "Compartilhe seu palco" : "Aguardando transmissão"}</h2><p>{isHost ? "O navegador abrirá o seletor obrigatório. Para mostrar tudo, escolha Tela inteira e confirme em Compartilhar." : canShareScreen ? "Você recebeu permissão para transmitir." : "Peça permissão ao host para transmitir sua tela."}</p>{canShareScreen ? <button onClick={handleShare} disabled={screen.state === "requesting-permission"} className="vynk-stage-action"><Icon name="monitor" size={16} />{screen.state === "requesting-permission" ? "Escolha uma tela…" : "Escolher tela para compartilhar"}</button> : <button onClick={handleRequestScreen} disabled={screenRequestSent || !socket?.connected} className="vynk-stage-action"><Icon name="monitor" size={16} />{screenRequestSent ? "Pedido enviado" : "Pedir permissão para transmitir"}</button>}{screen.error && <p className="vynk-inline-error">{screen.error}</p>}</div>}
            {displayStream && <div className="vynk-live-badge"><span className="vynk-status-dot" />{isScreenSharer ? "Sua tela" : "Ao vivo"}</div>}
            {isHost && <span className="vynk-host-badge">HOST</span>}
            {displayStream && supportsFullscreen && <button onClick={handleFullscreen} className="vynk-fullscreen-button" aria-pressed={isFullscreen} aria-label={isFullscreen ? "Sair da tela cheia" : "Abrir transmissão em tela cheia"} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}><Icon name={isFullscreen ? "shrink" : "expand"} size={17} /><span>{isFullscreen ? "Sair da tela cheia" : "Tela cheia"}</span></button>}
          </div>
          <div className="vynk-control-panel">
             <div className="vynk-control-group">
              {canShareScreen ? <button onClick={handleShare} disabled={screen.state === "requesting-permission" || (!!screenSharerId && !isScreenSharer)} className={`vynk-control-button ${screen.state === "sharing" ? "danger" : "accent"}`} aria-label={screen.state === "sharing" ? "Parar compartilhamento de tela" : "Compartilhar tela"}><Icon name="monitor" size={17} /><span>{screen.state === "requesting-permission" ? "Solicitando…" : screen.state === "sharing" ? "Parar tela" : "Compartilhar tela"}</span></button> : <button onClick={handleRequestScreen} disabled={screenRequestSent || !socket?.connected} className="vynk-control-button muted"><Icon name="monitor" size={17} /><span>{screenRequestSent ? "Pedido enviado" : "Pedir para transmitir"}</span></button>}
               {hasBlockedAudio && <><span className="sr-only" aria-live="polite">O navegador bloqueou o áudio da chamada. Use o botão para liberar.</span><button onClick={handleEnableCallAudio} className="vynk-control-button audio"><Icon name="volume" size={17} /><span>Liberar áudio</span></button></>}
             </div>
             <div className="vynk-volume-controls" aria-label="Volume da transmissão">
               <label className="vynk-volume-control"><span className="vynk-volume-label"><Icon name="volume" size={15} /><span>Transmissão</span><output>{screenVolume}%</output></span><input type="range" min="0" max="100" step="1" value={screenVolume} onChange={(event) => setScreenVolume(Number(event.currentTarget.value))} aria-label="Volume da transmissão" /></label>
             </div>
             <div className="vynk-media-status"><span className={`vynk-status-dot ${mediaQuality === "ruim" ? "danger" : mediaQuality === "instável" ? "warning" : mediaQuality === "estável" ? "online" : ""}`} />{screen.state === "sharing" ? `${screenSurfaceLabel} sendo compartilhada` : Object.keys(peerStates).length === 0 ? "Aguardando participantes" : mediaQuality ? `Mídia ${mediaQuality}` : "Conectando mídia"}</div>
          </div>
          {(microphone.error || hasAudioError) && <div className="vynk-inline-alert" role="alert">{microphone.error || "Não foi possível reproduzir o áudio de um participante. Tente liberar o áudio ou reconectar."}</div>}
          {failedPeerNames.length > 0 && <div className="vynk-inline-alert" role="status">A mídia de {failedPeerNames.join(", ")} não conectou. Fizemos uma nova tentativa; se continuar, peça para a pessoa atualizar a sala ou trocar de rede.</div>}
          {canShareScreen && <p className="vynk-stage-hint">Por segurança, a escolha final sempre acontece no navegador. Recomendado: selecione <strong>Tela inteira</strong> e habilite o áudio do sistema quando necessário.</p>}
        </section>
        <aside className="vynk-sidebar">
          <section className="vynk-panel vynk-participants-panel" aria-labelledby="participants-title">
            <div className="vynk-panel-heading"><div><span className="vynk-eyebrow">NA SALA</span><h2 id="participants-title">Participantes</h2></div><span className="vynk-count-pill">{participantCount} / {MAX_PARTICIPANTS}</span></div>
              {isHost && <label className="vynk-join-settings"><input type="checkbox" checked={joinRequestNotificationsEnabled} onChange={(event) => handleJoinNotificationsChange(event.currentTarget.checked)} /> Receber notificações de pedidos para entrar</label>}
              {isHost && joinRequests[0] && <div className="vynk-join-request" role="status"><strong>{joinRequests[0].participantName} quer entrar</strong><span>Essa pessoa está aguardando sua permissão para entrar na sala.</span><div><button onClick={() => handleJoinDecision(joinRequests[0].participantId, true)} className="vynk-permission-button allow">Permitir</button><button onClick={() => handleJoinDecision(joinRequests[0].participantId, false)} className="vynk-permission-button">Recusar</button></div></div>}
             {isHost && screenRequest && <div className="vynk-screen-request" role="status"><strong>{screenRequest.participantName} quer transmitir</strong><span>Autorize essa pessoa a compartilhar a tela.</span><div><button onClick={() => handleScreenPermission(screenRequest.participantId, true)} className="vynk-permission-button allow">Permitir</button><button onClick={() => handleScreenPermission(screenRequest.participantId, false)} className="vynk-permission-button">Recusar</button></div></div>}
            <ul className="vynk-participant-list">
              {participants.filter((p) => p.id !== myId).map((p) => (
                <li key={p.id} className={`vynk-participant ${speakingParticipantIds.has(p.id) && !p.micMuted ? "speaking" : ""}`}>
                   <span className={`vynk-avatar ${p.id === myId ? "mine" : ""} ${speakingParticipantIds.has(p.id) && !p.micMuted ? "speaking" : ""}`} aria-label={speakingParticipantIds.has(p.id) && !p.micMuted ? `${p.name} está falando` : p.name}>{p.name.trim().slice(0, 1).toUpperCase()}</span><span className="vynk-participant-main"><span className="vynk-participant-name-line"><span className="vynk-participant-name-text">{p.name}{p.id === myId && <em>você</em>}</span>{p.isHost && <small>HOST</small>}</span>{isHost && !p.isHost && p.presence === "online" && <button onClick={() => handleScreenPermission(p.id, !p.canShareScreen)} className="vynk-permission-button">{p.canShareScreen ? "Revogar tela" : "Permitir tela"}</button>}{p.id !== myId && <label className="vynk-participant-volume"><span>Voz <output>{participantVolumes.get(p.id) ?? 100}%</output></span><input type="range" min="0" max="200" step="1" value={participantVolumes.get(p.id) ?? 100} disabled={p.presence !== "online"} onChange={(event) => handleParticipantVolumeChange(p.id, Number(event.currentTarget.value))} aria-label={`Volume da voz de ${p.name}`} /></label>}</span><span className={`vynk-presence ${p.presence === "online" ? "online" : p.presence === "reconnecting" ? "reconnecting" : "offline"}`} title={p.micMuted ? "Microfone mutado" : "Microfone ativo"}><span className="vynk-status-dot" /><span className={`vynk-network-status ${networkTone(peerQuality[p.id])}`} title={`Ping: ${formatPing(peerLatency[p.id])} · Conexão ${networkLabel(peerQuality[p.id])}`}><span className="vynk-network-dot" />{formatPing(peerLatency[p.id])}</span><span className={`vynk-mic-indicator vynk-participant-mic ${p.micMuted ? "muted" : ""}`} role="img" aria-label={p.micMuted ? "Microfone mutado" : "Microfone ativo"}><Icon name="mic" size={14} /></span><span className={`vynk-audio-output-indicator vynk-participant-headphones ${p.deafened ? "muted" : ""}`} role="img" aria-label={p.deafened ? "Não escuta o áudio da sala" : "Áudio da sala ativo"} title={p.deafened ? "Não escuta o áudio da sala" : "Áudio da sala ativo"}><Icon name="headphones" size={15} /></span>{p.id === myId && <button type="button" onClick={handleToggleDeafen} aria-pressed={isDeafened} className={`vynk-participant-audio-button ${isDeafened ? "muted" : ""}`} aria-label={isDeafened ? "Reativar áudio da sala" : "Silenciar áudio da sala"} title={isDeafened ? "Reativar áudio da sala" : "Silenciar áudio da sala"}><span className={`vynk-audio-output-indicator ${isDeafened ? "muted" : ""}`} aria-hidden="true"><Icon name="headphones" size={14} /></span></button>}</span>
                </li>
              ))}
              {participants.filter((p) => p.id !== myId).length === 0 && !me && <li className="vynk-empty-row"><span className="vynk-skeleton" />Carregando participantes…</li>}
            </ul>
            {me && <div className={`vynk-self-bar ${speakingParticipantIds.has(me.id) && !me.micMuted ? "speaking" : ""}`}>
              <span className={`vynk-avatar mine ${speakingParticipantIds.has(me.id) && !me.micMuted ? "speaking" : ""}`} aria-label={speakingParticipantIds.has(me.id) && !me.micMuted ? `${me.name} está falando` : me.name}>{me.name.trim().slice(0, 1).toUpperCase()}</span>
              <span className="vynk-self-details"><span className="vynk-self-name">{me.name}<em>você</em></span>{me.isHost && <small>HOST</small>}<span className={`vynk-network-status ${overallQuality}`} title={`Ping médio: ${formatPing(overallPing)} · Conexão ${networkLabel(overallQuality)}`}><span className="vynk-network-dot" />{formatPing(overallPing)}</span></span>
              <span className="vynk-self-actions">
                <button type="button" onClick={handleParticipantMicrophone} disabled={microphone.state === "requesting-permission"} aria-pressed={microphone.state === "active" && !microphone.muted} aria-label={microphone.state === "active" && !microphone.muted ? "Mutar microfone" : "Ativar microfone"} title={microphone.state === "active" && !microphone.muted ? "Mutar microfone" : "Ativar microfone"} className={`vynk-self-action ${microphone.state !== "active" || microphone.muted ? "muted" : ""}`}><span className={`vynk-mic-indicator vynk-self-action-icon ${microphone.state !== "active" || microphone.muted ? "muted" : ""}`} aria-hidden="true"><Icon name="mic" size={19} /></span></button>
                <button type="button" onClick={handleToggleDeafen} aria-pressed={isDeafened} aria-label={isDeafened ? "Reativar áudio da sala" : "Silenciar áudio da sala"} title={isDeafened ? "Reativar áudio da sala" : "Silenciar áudio da sala"} className={`vynk-self-action ${isDeafened ? "muted" : ""}`}><span className={`vynk-audio-output-indicator vynk-self-action-icon ${isDeafened ? "muted" : ""}`} aria-hidden="true"><Icon name="headphones" size={19} /></span></button>
              </span>
            </div>}
          </section>
          <section className="flex min-h-[280px] flex-1 flex-col border-t dark:border-zinc-800" aria-label="Chat da sala">
            <div className="vynk-chat-panel">
            <div className="vynk-panel-heading"><div><span className="vynk-eyebrow">CONVERSA</span><h2>Chat da sala</h2></div><span className="vynk-count-pill">{chatMessages.length}</span></div>
            <div className="vynk-chat-body">
              <ol className="vynk-chat-list" aria-live="polite">
                {chatMessages.length === 0 && <li className="vynk-chat-empty"><span className="vynk-chat-empty-icon">✦</span><strong>O chat está aberto</strong><span>Envie uma mensagem para começar.</span></li>}
                {chatMessages.map((message) => {
                  const isMine = isOwnChatMessage(message, participantSessionId, myId);
                  return <li key={message.id} className={`vynk-message ${isMine ? "mine" : ""}`}><div className="vynk-message-meta"><span>{isMine ? "Você" : message.authorName}</span><time dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.text}</p></li>;
                })}
                <li ref={chatEndRef} aria-hidden="true" />
              </ol>
            </div>
            <form onSubmit={handleChatSubmit} className="vynk-chat-form">{chatError && <p className="vynk-chat-error" role="alert">{chatError}</p>}<div className="vynk-chat-input-row"><textarea value={chatDraft} onChange={(event) => { setChatDraft(event.target.value); if (chatError) setChatError(null); }} onKeyDown={handleChatKeyDown} maxLength={MAX_CHAT_MESSAGE_LENGTH} rows={1} placeholder="Escreva uma mensagem…" aria-label="Mensagem do chat" /><button type="submit" disabled={!chatDraft.trim() || !socket?.connected} aria-label="Enviar mensagem"><Icon name="send" size={17} /></button></div><p className="vynk-chat-hint">Enter envia · Shift+Enter quebra linha · {chatDraft.length}/{MAX_CHAT_MESSAGE_LENGTH}</p></form>
            </div>
          </section>
          <div className="vynk-sidebar-footer"><span><Icon name="lock" size={12} /> P2P e sem gravação</span><span className="vynk-link-preview">{typeof window !== "undefined" ? window.location.origin : "vynk"}/room/{roomId}</span></div>
        </aside>
      </main>
    </div>
  );
}
