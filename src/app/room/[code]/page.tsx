"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS, type Participant } from "@/lib/events";
import { useSocket } from "@/hooks/useSocket";
import { getParticipantSessionId } from "@/lib/socket";
import { useWebRTCSignaling } from "@/hooks/useWebRTCSignaling";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useMicrophone } from "@/hooks/useMicrophone";
import { getRemoteAudioPlaybackState, RemoteAudio, type RemoteAudioPlaybackState } from "@/components/RemoteAudio";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomId = ((params?.code as string) ?? "").toUpperCase();
  const { socket, state: connState } = useSocket();
  const [name] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("vynk_name") || "" : ""));
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteMicrophoneStreams, setRemoteMicrophoneStreams] = useState<Map<string, MediaStream>>(new Map());
  const [audioPlaybackStates, setAudioPlaybackStates] = useState<Map<string, RemoteAudioPlaybackState>>(new Map());
  const [promptName, setPromptName] = useState(name);
  const [needsName, setNeedsName] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleScreenStopped = useCallback(() => {
    socket?.emit(EVENTS.SCREEN_STOPPED, { roomId });
  }, [roomId, socket]);
  const screen = useScreenShare(handleScreenStopped);
  const handleMicrophoneState = useCallback((muted: boolean) => {
    socket?.emit(EVENTS.MICROPHONE_STATE, { roomId, muted });
  }, [roomId, socket]);
  const microphone = useMicrophone(handleMicrophoneState);
  const microphoneStateRef = useRef(microphone.state);

  useEffect(() => {
    microphoneStateRef.current = microphone.state;
  }, [microphone.state]);

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
    const onJoined = (data: { participants: Participant[] }) => {
      setParticipants(data.participants);
      const me = data.participants.find((p) => p.id === socket.id);
      setIsHost(!!me?.isHost);
      socket.emit(EVENTS.MICROPHONE_STATE, { roomId, muted: microphoneStateRef.current !== "active" });
    };
    const onParticipants = (data: { participants: Participant[] }) => { setParticipants(data.participants); const me = data.participants.find((p) => p.id === socket.id); setIsHost(!!me?.isHost); };
    const onHostChanged = (data: { hostId: string }) => { setParticipants((prev) => prev.map((p) => ({ ...p, isHost: p.id === data.hostId }))); setIsHost(data.hostId === socket.id); };
    const onError = (data: { message: string }) => setError(data.message);
    const onScreenStopped = () => setRemoteStreams(new Map());
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_PARTICIPANTS, onParticipants);
    socket.on(EVENTS.PRESENCE_UPDATE, onParticipants);
    socket.on(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
    socket.on(EVENTS.ROOM_ERROR, onError);
    socket.on(EVENTS.SCREEN_STOPPED, onScreenStopped);
    const emitJoin = () => socket.emit(EVENTS.ROOM_JOIN, { roomId, name: effectiveName, sessionId: getParticipantSessionId() });
    if (socket.connected) emitJoin(); else socket.once("connect", emitJoin);
    return () => {
      socket.off(EVENTS.ROOM_JOINED, onJoined);
      socket.off(EVENTS.ROOM_PARTICIPANTS, onParticipants);
      socket.off(EVENTS.PRESENCE_UPDATE, onParticipants);
      socket.off(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off(EVENTS.SCREEN_STOPPED, onScreenStopped);
    };
  }, [socket, roomId, name, promptName, needsName]);

  useEffect(() => {
    if (!socket) return;
    const onReconnect = () => { const n = (localStorage.getItem("vynk_name") || promptName || name).trim(); if (n && roomId) socket.emit(EVENTS.ROOM_JOIN, { roomId, name: n, sessionId: getParticipantSessionId() }); };
    socket.on("reconnect" as never, onReconnect);
    socket.io.on("reconnect", onReconnect);
    return () => { socket.off("reconnect" as never, onReconnect); socket.io.off("reconnect", onReconnect); };
  }, [socket, roomId, promptName, name]);

  const handleRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((current) => {
      const next = new Map(current);
      next.set(peerId, stream);
      return next;
    });
  }, []);
  const handleRemoteMicrophoneStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteMicrophoneStreams((current) => {
      const next = new Map(current);
      next.set(peerId, stream);
      return next;
    });
  }, []);
  const handleAudioPlaybackState = useCallback((peerId: string, state: RemoteAudioPlaybackState) => {
    setAudioPlaybackStates((current) => {
      if (current.get(peerId) === state) return current;
      const next = new Map(current);
      next.set(peerId, state);
      return next;
    });
  }, []);
  const handleRemotePeerRemoved = useCallback((peerId: string) => {
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
      return next;
    });
  }, []);

  const { states: peerStates, iceStates } = useWebRTCSignaling({
    socket,
    roomId,
    selfId: socket?.id ?? "",
    isHost,
    peers: participants.filter((participant) => participant.presence === "online"),
    localScreenStream: screen.stream,
    localMicrophoneStream: microphone.stream,
    onRemoteStream: handleRemoteStream,
    onRemoteMicrophoneStream: handleRemoteMicrophoneStream,
    onRemotePeerRemoved: handleRemotePeerRemoved,
  });

  const remoteScreenStream = [...remoteStreams.values()].find((stream) => stream.getVideoTracks().some((track) => !track.muted && track.readyState === "live")) ?? null;
  const displayStream = isHost ? screen.stream : remoteScreenStream;
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = displayStream;
  }, [displayStream]);

  const handleLeave = () => { socket?.emit(EVENTS.ROOM_LEAVE, { roomId }); router.push("/"); };
  const handleCopy = async () => { await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`); };
  const handleShare = async () => {
    if (!isHost) return;
    if (screen.state === "sharing") {
      screen.stop();
      return;
    }
    const stream = await screen.start();
    if (stream) socket?.emit(EVENTS.SCREEN_STARTED, { roomId });
  };
  const handleMicrophone = async () => {
    if (microphone.state === "active" || microphone.state === "requesting-permission") return;
    await microphone.start();
  };
  const handleEnableCallAudio = () => {
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
  const myId = socket?.id ?? "";

  if (needsName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
        <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow border dark:border-zinc-800">
          <h2 className="font-semibold">Informe seu nome</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">Nome temporário para entrar em {roomId}</p>
          <input value={promptName} onChange={(e) => setPromptName(e.target.value)} placeholder="Seu nome" maxLength={24} className="mt-4 w-full rounded-lg border px-3 py-2 text-sm dark:bg-zinc-800 dark:border-zinc-700" />
          <button onClick={() => { if (!promptName.trim()) return; localStorage.setItem("vynk_name", promptName.trim()); setNeedsName(false); }} className="mt-3 w-full rounded-lg bg-violet-600 text-white py-2 text-sm font-medium">Entrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="h-14 flex items-center justify-between px-3 sm:px-4 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm">vynk</span>
          <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 font-mono">Sala {roomId}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${connState === "connected" ? "bg-green-100 text-green-700" : connState === "reconnecting" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{connState}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-zinc-500">👥 {participants.filter((p) => p.presence !== "offline").length}/5</span>
          <button onClick={handleCopy} className="text-xs border rounded-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">Copiar link</button>
          <button onClick={handleLeave} className="text-xs bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white rounded-full px-3 py-1.5">Sair</button>
        </div>
      </header>
      {error && <div className="mx-3 sm:mx-4 mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700">{error}</div>}
      {[...remoteMicrophoneStreams.entries()].map(([peerId, stream]) => <RemoteAudio key={peerId} peerId={peerId} stream={stream} onPlaybackStateChange={handleAudioPlaybackState} />)}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 flex flex-col p-3 sm:p-4 gap-3 min-h-[40vh] lg:min-h-0">
          <div className="flex-1 relative bg-black rounded-xl overflow-hidden flex items-center justify-center min-h-[240px]">
            {displayStream && <video ref={videoRef} autoPlay muted={isHost} playsInline className="w-full h-full object-contain" />}
            {!displayStream && <div className="text-zinc-400 text-center p-6">
              <div className="text-4xl mb-3">🖥️</div>
              <p className="text-sm">{isHost ? "Você é o host — compartilhe sua tela quando quiser." : "Aguardando host compartilhar a tela…"}</p>
              <p className="text-xs text-zinc-500 mt-2">A transmissão acontece diretamente entre os participantes.</p>
              {screen.error && <p className="text-xs text-red-400 mt-2">{screen.error}</p>}
            </div>}
            {isHost && <div className="absolute top-3 left-3 bg-violet-600 text-white text-xs px-2 py-1 rounded-full">HOST</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl p-3 text-xs text-zinc-500">
            {isHost && <button onClick={handleShare} disabled={screen.state === "requesting-permission"} className={`rounded-full px-4 py-2 text-sm font-medium text-white ${screen.state === "sharing" ? "bg-red-600" : "bg-violet-600"} disabled:opacity-50`}>{screen.state === "requesting-permission" ? "Solicitando…" : screen.state === "sharing" ? "⏹ Parar tela" : "🖥 Compartilhar tela"}</button>}
            {microphone.state === "active" ? <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300" role="status">🎙 Microfone ativo</span> : <button onClick={handleMicrophone} disabled={microphone.state === "requesting-permission"} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800">{microphone.state === "requesting-permission" ? "Solicitando microfone…" : microphone.state === "error" ? "Tentar microfone novamente" : "🎙 Ativar microfone"}</button>}
            {hasBlockedAudio && <><span className="sr-only" aria-live="polite">O navegador bloqueou o áudio da chamada. Use o botão para liberar.</span><button onClick={handleEnableCallAudio} className="rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50">🔊 Liberar áudio da chamada</button></>}
            <span>{screen.state === "sharing" ? "Sua tela está sendo compartilhada." : "Conexão:"}</span>
            {Object.keys(peerStates).length === 0 ? "aguardando outro peer" : Object.entries(peerStates).map(([peerId, state]) => `${peerId.slice(0, 5)} ${state} / ICE ${iceStates[peerId] ?? "new"}`).join(" · ")}
            {microphone.error && <span className="basis-full text-red-600 dark:text-red-400" role="alert">{microphone.error}</span>}
            {hasAudioError && <span className="basis-full text-red-600 dark:text-red-400" role="alert">Não foi possível reproduzir o áudio de um participante. Aguarde a reconexão ou entre novamente na sala.</span>}
          </div>
          {isHost && <p className="px-2 text-center text-[11px] text-zinc-500">Para trocar de aba durante a transmissão, selecione <strong>Tela inteira</strong> no seletor do navegador e habilite o áudio do sistema quando disponível. Ao escolher uma única aba, o navegador fixa a captura nela.</p>}
        </div>
        <aside className="w-full lg:w-[360px] flex flex-col border-t lg:border-t-0 lg:border-l bg-white dark:bg-zinc-900 dark:border-zinc-800">
          <div className="p-4">
            <h3 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Participantes — {participants.filter((p) => p.presence !== "offline").length}/5</h3>
            <ul className="mt-3 space-y-2">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${p.presence === "online" ? (p.id === myId ? "bg-violet-600" : "bg-green-500") : p.presence === "reconnecting" ? "bg-amber-500" : "bg-zinc-400"}`} />{p.name}{p.isHost && <span className="text-[10px] bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded-full">HOST</span>}{p.id === myId && <span className="text-xs text-zinc-400">(você)</span>}</span>
                  <span className="text-xs text-zinc-500">{p.presence === "online" ? "online" : p.presence === "reconnecting" ? "reconectando…" : "offline"}</span>
                </li>
              ))}
              {participants.length === 0 && <li className="text-xs text-zinc-500">Carregando…</li>}
            </ul>
          </div>
          <div className="p-4 border-t dark:border-zinc-800 text-xs text-zinc-500">
            <p>Link: <span className="font-mono">{typeof window !== "undefined" ? window.location.href : `/room/${roomId}`}</span></p>
            <p className="mt-1">Compartilhe este link para entrar por código.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
