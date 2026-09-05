"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS, MAX_CHAT_MESSAGE_LENGTH, MAX_PARTICIPANTS, type ChatMessage, type Participant } from "@/lib/events";
import { useSocket } from "@/hooks/useSocket";
import { getParticipantSessionId } from "@/lib/socket";
import { useWebRTCSignaling } from "@/hooks/useWebRTCSignaling";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useMicrophone } from "@/hooks/useMicrophone";
import { getRemoteAudioPlaybackState, RemoteAudio, type RemoteAudioPlaybackState } from "@/components/RemoteAudio";

type IconName = "arrow" | "check" | "copy" | "expand" | "lock" | "mic" | "monitor" | "send" | "shrink" | "users" | "volume" | "x";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string[]> = {
    arrow: ["M5 12h13", "m12 6 6 6-6 6"],
    check: ["m5 12 4 4L19 6"],
    copy: ["M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2", "M6 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"],
    expand: ["M8 3H3v5", "m3 3 6 6", "M16 3h5v5", "m21 3-6 6", "M8 21H3v-5", "m3 21 6-6", "M16 21h5v-5", "m21 21-6-6"],
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
  const { socket, state: connState, error: socketError } = useSocket();
  const [name] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("vynk_name") || "" : ""));
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteMicrophoneStreams, setRemoteMicrophoneStreams] = useState<Map<string, MediaStream>>(new Map());
  const [audioPlaybackStates, setAudioPlaybackStates] = useState<Map<string, RemoteAudioPlaybackState>>(new Map());
  const [promptName, setPromptName] = useState(name);
  const [needsName, setNeedsName] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLLIElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleScreenStopped = useCallback(() => {
    socket?.emit(EVENTS.SCREEN_STOPPED, { roomId });
  }, [roomId, socket]);
  const screen = useScreenShare(handleScreenStopped);
  const handleMicrophoneState = useCallback((muted: boolean) => {
    socket?.emit(EVENTS.MICROPHONE_STATE, { roomId, muted });
  }, [roomId, socket]);
  const microphone = useMicrophone(handleMicrophoneState);
  const microphoneStateRef = useRef(microphone.state);
  const microphoneMutedRef = useRef(microphone.muted);

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
    const onJoined = (data: { participants: Participant[] }) => {
      setParticipants(data.participants);
      const me = data.participants.find((p) => p.id === socket.id);
      setIsHost(!!me?.isHost);
      socket.emit(EVENTS.MICROPHONE_STATE, { roomId, muted: microphoneStateRef.current !== "active" || microphoneMutedRef.current });
    };
    const onParticipants = (data: { participants: Participant[] }) => { setParticipants(data.participants); const me = data.participants.find((p) => p.id === socket.id); setIsHost(!!me?.isHost); };
    const onHostChanged = (data: { hostId: string }) => { setParticipants((prev) => prev.map((p) => ({ ...p, isHost: p.id === data.hostId }))); setIsHost(data.hostId === socket.id); };
    const onError = (data: { message: string }) => setError(data.message);
    const onSocketDisconnect = () => setParticipants([]);
    const onScreenStopped = () => {
      setRemoteStreams(new Map());
      setAudioPlaybackStates((current) => new Map([...current].filter(([peerId]) => !peerId.endsWith(":screen"))));
    };
    const onMicrophoneState = (data: { roomId: string; participantId: string; muted: boolean }) => {
      if (data.roomId !== roomId) return;
      setParticipants((current) => current.map((participant) => participant.id === data.participantId ? { ...participant, micMuted: data.muted } : participant));
    };
    const onChatMessage = (data: ChatMessage) => {
      if (data.roomId !== roomId) return;
      setChatMessages((current) => [...current, data].slice(-200));
    };
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_PARTICIPANTS, onParticipants);
    socket.on(EVENTS.PRESENCE_UPDATE, onParticipants);
    socket.on(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
    socket.on(EVENTS.ROOM_ERROR, onError);
    socket.on(EVENTS.SCREEN_STOPPED, onScreenStopped);
    socket.on(EVENTS.MICROPHONE_STATE, onMicrophoneState);
    socket.on(EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on("disconnect", onSocketDisconnect);
    const emitJoin = () => socket.emit(EVENTS.ROOM_JOIN, { roomId, name: effectiveName, sessionId: getParticipantSessionId() });
    if (socket.connected) emitJoin(); else socket.once("connect", emitJoin);
    return () => {
      socket.off(EVENTS.ROOM_JOINED, onJoined);
      socket.off(EVENTS.ROOM_PARTICIPANTS, onParticipants);
      socket.off(EVENTS.PRESENCE_UPDATE, onParticipants);
      socket.off(EVENTS.ROOM_HOST_CHANGED, onHostChanged);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off(EVENTS.SCREEN_STOPPED, onScreenStopped);
      socket.off(EVENTS.MICROPHONE_STATE, onMicrophoneState);
      socket.off(EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off("disconnect", onSocketDisconnect);
    };
  }, [socket, roomId, name, promptName, needsName]);

  useEffect(() => {
    if (!socket) return;
    const onReconnect = () => { setError(null); const n = (localStorage.getItem("vynk_name") || promptName || name).trim(); if (n && roomId) socket.emit(EVENTS.ROOM_JOIN, { roomId, name: n, sessionId: getParticipantSessionId() }); };
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
      next.delete(`${peerId}:screen`);
      return next;
    });
  }, []);

  const { states: peerStates, quality: peerQuality } = useWebRTCSignaling({
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
  });

  const remoteScreenStream = [...remoteStreams.values()].find((stream) => stream.getVideoTracks().some((track) => !track.muted && track.readyState === "live")) ?? null;
  const displayStream = isHost ? screen.stream : remoteScreenStream;
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = displayStream;
  }, [displayStream]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!displayStream && document.fullscreenElement === stageRef.current) void document.exitFullscreen().catch(() => undefined);
  }, [displayStream]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages]);

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
  const handleFullscreen = async () => {
    if (!stageRef.current || !displayStream) return;
    try {
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current.requestFullscreen();
    } catch {
      setError("Não foi possível abrir a transmissão em tela cheia. Verifique as permissões do navegador.");
    }
  };
  const handleMicrophone = async () => {
    if (microphone.state === "active" || microphone.state === "requesting-permission") return;
    await microphone.start();
  };
  const handleToggleMicrophone = () => {
    if (microphone.state !== "active") return;
    microphone.toggle();
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
  const qualityValues = Object.values(peerQuality);
  const mediaQuality = qualityValues.length === 0 ? null : qualityValues.includes("degraded") ? "instável" : qualityValues.every((value) => value === "good") ? "estável" : "conectando";
  const myId = socket?.id ?? "";
  const failedPeerNames = participants.filter((participant) => participant.id !== myId && peerStates[participant.id] === "failed").map((participant) => participant.name);
  const participantCount = participants.filter((p) => p.presence !== "offline").length;
  const connectionLabel = connState === "connected" ? "Conectado" : connState === "reconnecting" ? "Reconectando" : connState === "error" ? "Sem conexão" : "Conectando";
  const connectionTone = connState === "connected" ? "online" : connState === "reconnecting" ? "warning" : "offline";

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
      {[...remoteMicrophoneStreams.entries()].map(([peerId, stream]) => <RemoteAudio key={peerId} peerId={peerId} stream={stream} onPlaybackStateChange={handleAudioPlaybackState} />)}
      {[...remoteStreams.entries()].filter(([, stream]) => stream.getAudioTracks().some((track) => track.readyState === "live")).map(([peerId, stream]) => <RemoteAudio key={`${peerId}:screen`} peerId={`${peerId}:screen`} stream={stream} onPlaybackStateChange={handleAudioPlaybackState} />)}
      <main className="vynk-workspace">
        <section className="vynk-stage-column" aria-label="Palco da sala">
          <div className="vynk-stage-heading"><div><span className="vynk-eyebrow">TRANSMISSÃO AO VIVO</span><h1>{displayStream ? "Tela compartilhada" : "Palco da sala"}</h1></div><span className={`vynk-stage-state ${displayStream ? "active" : ""}`}><span className="vynk-status-dot" />{displayStream ? "Ao vivo" : "Aguardando tela"}</span></div>
          <div ref={stageRef} className="vynk-stage">
            <div className="vynk-stage-grid" aria-hidden="true" />
            {displayStream && <video ref={videoRef} autoPlay muted playsInline className="vynk-stage-video" />}
            {!displayStream && <div className="vynk-stage-empty"><div className="vynk-stage-icon"><Icon name="monitor" size={28} /></div><span className="vynk-eyebrow">{isHost ? "VOCÊ É O HOST" : "SALA EM ESPERA"}</span><h2>{isHost ? "Compartilhe seu palco" : "Aguardando o host"}</h2><p>{isHost ? "Mostre uma janela ou a tela inteira para começar a apresentação." : "Assim que o host iniciar, a transmissão aparecerá aqui."}</p>{isHost && <button onClick={handleShare} disabled={screen.state === "requesting-permission"} className="vynk-stage-action"><Icon name="monitor" size={16} />{screen.state === "requesting-permission" ? "Solicitando acesso…" : "Compartilhar tela"}</button>}{screen.error && <p className="vynk-inline-error">{screen.error}</p>}</div>}
            {displayStream && <div className="vynk-live-badge"><span className="vynk-status-dot" />{isHost ? "Sua tela" : "Ao vivo"}</div>}
            {isHost && <span className="vynk-host-badge">HOST</span>}
            {displayStream && <button onClick={handleFullscreen} className="vynk-fullscreen-button" aria-pressed={isFullscreen} aria-label={isFullscreen ? "Sair da tela cheia" : "Abrir transmissão em tela cheia"} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}><Icon name={isFullscreen ? "shrink" : "expand"} size={17} /><span>{isFullscreen ? "Sair da tela cheia" : "Tela cheia"}</span></button>}
          </div>
          <div className="vynk-control-panel">
            <div className="vynk-control-group">
              {isHost && <button onClick={handleShare} disabled={screen.state === "requesting-permission"} className={`vynk-control-button ${screen.state === "sharing" ? "danger" : "accent"}`} aria-label={screen.state === "sharing" ? "Parar compartilhamento de tela" : "Compartilhar tela"}><Icon name="monitor" size={17} /><span>{screen.state === "requesting-permission" ? "Solicitando…" : screen.state === "sharing" ? "Parar tela" : "Compartilhar tela"}</span></button>}
              {microphone.state === "active" ? <button onClick={handleToggleMicrophone} aria-pressed={microphone.muted} className={`vynk-control-button ${microphone.muted ? "muted" : "active"}`}><Icon name="mic" size={17} /><span>{microphone.muted ? "Desmutar" : "Mutar"}</span></button> : <button onClick={handleMicrophone} disabled={microphone.state === "requesting-permission"} className="vynk-control-button muted"><Icon name="mic" size={17} /><span>{microphone.state === "requesting-permission" ? "Solicitando…" : microphone.state === "error" ? "Tentar microfone" : "Ativar microfone"}</span></button>}
              {hasBlockedAudio && <><span className="sr-only" aria-live="polite">O navegador bloqueou o áudio da chamada. Use o botão para liberar.</span><button onClick={handleEnableCallAudio} className="vynk-control-button audio"><Icon name="volume" size={17} /><span>Liberar áudio</span></button></>}
            </div>
            <div className="vynk-media-status"><span className={`vynk-status-dot ${mediaQuality === "instável" ? "warning" : mediaQuality === "estável" ? "online" : ""}`} />{screen.state === "sharing" ? "Tela sendo compartilhada" : Object.keys(peerStates).length === 0 ? "Aguardando participantes" : mediaQuality ? `Mídia ${mediaQuality}` : "Conectando mídia"}</div>
          </div>
          {(microphone.error || hasAudioError) && <div className="vynk-inline-alert" role="alert">{microphone.error || "Não foi possível reproduzir o áudio de um participante. Tente liberar o áudio ou reconectar."}</div>}
          {failedPeerNames.length > 0 && <div className="vynk-inline-alert" role="status">A mídia de {failedPeerNames.join(", ")} não conectou. Fizemos uma nova tentativa; se continuar, peça para a pessoa atualizar a sala ou trocar de rede.</div>}
          {isHost && <p className="vynk-stage-hint">Para apresentar outra aba, escolha <strong>Tela inteira</strong> no seletor do navegador e habilite o áudio do sistema quando necessário.</p>}
        </section>
        <aside className="vynk-sidebar">
          <section className="vynk-panel vynk-participants-panel" aria-labelledby="participants-title">
            <div className="vynk-panel-heading"><div><span className="vynk-eyebrow">NA SALA</span><h2 id="participants-title">Participantes</h2></div><span className="vynk-count-pill">{participantCount} / {MAX_PARTICIPANTS}</span></div>
            <ul className="vynk-participant-list">
              {participants.map((p) => (
                <li key={p.id} className="vynk-participant">
                  <span className={`vynk-avatar ${p.id === myId ? "mine" : ""}`}>{p.name.trim().slice(0, 1).toUpperCase()}</span><span className="vynk-participant-name"><span>{p.name}{p.id === myId && <em>você</em>}</span>{p.isHost && <small>HOST</small>}</span><span className={`vynk-presence ${p.presence === "online" ? "online" : p.presence === "reconnecting" ? "reconnecting" : "offline"}`}><span className="vynk-status-dot" />{p.micMuted ? "mutado" : "falando"}</span>
                </li>
              ))}
              {participants.length === 0 && <li className="vynk-empty-row"><span className="vynk-skeleton" />Carregando participantes…</li>}
            </ul>
          </section>
          <section className="flex min-h-[280px] flex-1 flex-col border-t dark:border-zinc-800" aria-label="Chat da sala">
            <div className="vynk-chat-panel">
            <div className="vynk-panel-heading"><div><span className="vynk-eyebrow">CONVERSA</span><h2>Chat da sala</h2></div><span className="vynk-count-pill">{chatMessages.length}</span></div>
            <div className="vynk-chat-body">
              <ol className="vynk-chat-list" aria-live="polite">
                {chatMessages.length === 0 && <li className="vynk-chat-empty"><span className="vynk-chat-empty-icon">✦</span><strong>O chat está aberto</strong><span>Envie uma mensagem para começar.</span></li>}
                {chatMessages.map((message) => {
                  const isMine = message.authorId === myId;
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
