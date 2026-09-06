"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getParticipantSessionId, getSignalingSocket } from "@/lib/socket";
import { EVENTS, type PublicRoom } from "@/lib/events";

type LoadingState = "create" | "join" | "list" | "join-request" | "pending";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [showRooms, setShowRooms] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const pendingRequestCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => pendingRequestCleanup.current?.(), []);

  const validateName = (v: string) => v.trim().length >= 1 && v.trim().length <= 24;

  const handleCreate = () => {
    if (!validateName(name)) { setError("Informe um nome de 1 a 24 caracteres."); return; }
    pendingRequestCleanup.current?.();
    setError(null); setStatus(null); setLoading("create");
    const socket = getSignalingSocket();
    const emit = () => socket.emit(EVENTS.ROOM_CREATE, { name: name.trim(), sessionId: getParticipantSessionId() });
    let timer: number | null = null;
    const onCreated = (data: { roomId: string }) => { cleanup(); localStorage.setItem("vynk_name", name.trim()); router.push(`/room/${data.roomId}`); };
    const onError = (data: { message: string }) => { setError(data.message); setLoading(null); cleanup(); };
    const cleanup = () => {
      socket.off(EVENTS.ROOM_CREATED, onCreated);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off("connect", emit);
      if (timer) window.clearTimeout(timer);
      if (pendingRequestCleanup.current === cleanup) pendingRequestCleanup.current = null;
    };
    pendingRequestCleanup.current = cleanup;
    socket.on(EVENTS.ROOM_CREATED, onCreated);
    socket.on(EVENTS.ROOM_ERROR, onError);
    if (socket.connected) emit(); else socket.once("connect", emit);
    timer = window.setTimeout(() => { cleanup(); setLoading((v) => (v === "create" ? null : v)); setError("O servidor demorou para responder. Tente novamente."); }, 8000);
  };

  const handleJoin = () => {
    const upper = code.trim().toUpperCase();
    if (!validateName(name)) { setError("Informe seu nome."); return; }
    if (!/^[A-Z0-9]{6}$/.test(upper)) { setError("Código deve ter 6 caracteres (A-Z, 0-9)."); return; }
    pendingRequestCleanup.current?.();
    setError(null); setStatus(null); setLoading("join");
    const socket = getSignalingSocket();
    const emit = () => socket.emit(EVENTS.ROOM_JOIN, { roomId: upper, name: name.trim(), sessionId: getParticipantSessionId() });
    let timer: number | null = null;
    const onJoined = (data: { roomId: string }) => { cleanup(); localStorage.setItem("vynk_name", name.trim()); router.push(`/room/${data.roomId}`); };
    const onError = (data: { message: string }) => { setError(data.message); setLoading(null); cleanup(); };
    const cleanup = () => {
      socket.off(EVENTS.ROOM_JOINED, onJoined);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off("connect", emit);
      if (timer) window.clearTimeout(timer);
      if (pendingRequestCleanup.current === cleanup) pendingRequestCleanup.current = null;
    };
    pendingRequestCleanup.current = cleanup;
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_ERROR, onError);
    if (socket.connected) emit(); else socket.once("connect", emit);
    timer = window.setTimeout(() => { cleanup(); setLoading((v) => (v === "join" ? null : v)); setError("O servidor demorou para responder. Tente novamente."); }, 8000);
  };

  const handleListRooms = () => {
    pendingRequestCleanup.current?.();
    setError(null); setStatus(null); setLoading("list");
    const socket = getSignalingSocket();
    const emit = () => socket.emit(EVENTS.ROOM_LIST_REQUEST);
    let timer: number | null = null;
    const onRooms = (data: { rooms: PublicRoom[] }) => { cleanup(); setRooms(data.rooms); setShowRooms(true); setLoading(null); };
    const onError = (data: { message: string }) => { setError(data.message); setLoading(null); cleanup(); };
    const cleanup = () => {
      socket.off(EVENTS.ROOM_LIST, onRooms);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off("connect", emit);
      if (timer) window.clearTimeout(timer);
      if (pendingRequestCleanup.current === cleanup) pendingRequestCleanup.current = null;
    };
    pendingRequestCleanup.current = cleanup;
    socket.on(EVENTS.ROOM_LIST, onRooms);
    socket.on(EVENTS.ROOM_ERROR, onError);
    if (socket.connected) emit(); else socket.once("connect", emit);
    timer = window.setTimeout(() => { cleanup(); setLoading(null); setError("O servidor demorou para responder. Tente novamente."); }, 8000);
  };

  const handleRequestJoin = (roomId: string) => {
    if (!validateName(name)) { setError("Informe um nome antes de pedir para entrar."); return; }
    pendingRequestCleanup.current?.();
    setError(null); setStatus(null); setPendingRoomId(roomId); setLoading("join-request");
    localStorage.setItem("vynk_name", name.trim());
    const socket = getSignalingSocket();
    const emit = () => socket.emit(EVENTS.ROOM_JOIN_REQUEST, { roomId, name: name.trim(), sessionId: getParticipantSessionId() });
    let timer: number | null = null;
    const onPending = (data: { roomId: string; message: string }) => { if (data.roomId !== roomId) return; setStatus(data.message); setLoading("pending"); };
    const onJoined = (data: { roomId: string }) => { cleanup(); setStatus(null); setPendingRoomId(null); router.push(`/room/${data.roomId}`); };
    const onResult = (data: { roomId: string; allowed: boolean; message: string }) => {
      if (data.roomId !== roomId) return;
      cleanup(); setLoading(null); setPendingRoomId(null); setStatus(null);
      if (!data.allowed) setError(data.message);
    };
    const onError = (data: { message: string; roomId?: string }) => { if (data.roomId && data.roomId !== roomId) return; setError(data.message); setLoading(null); setPendingRoomId(null); cleanup(); };
    const cleanup = () => {
      socket.emit(EVENTS.ROOM_JOIN_CANCEL, { roomId });
      socket.off(EVENTS.ROOM_JOIN_PENDING, onPending);
      socket.off(EVENTS.ROOM_JOINED, onJoined);
      socket.off(EVENTS.ROOM_JOIN_RESULT, onResult);
      socket.off(EVENTS.ROOM_ERROR, onError);
      socket.off("connect", emit);
      if (timer) window.clearTimeout(timer);
      if (pendingRequestCleanup.current === cleanup) pendingRequestCleanup.current = null;
    };
    pendingRequestCleanup.current = cleanup;
    socket.on(EVENTS.ROOM_JOIN_PENDING, onPending);
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_JOIN_RESULT, onResult);
    socket.on(EVENTS.ROOM_ERROR, onError);
    if (socket.connected) emit(); else socket.once("connect", emit);
    timer = window.setTimeout(() => { cleanup(); setLoading(null); setPendingRoomId(null); setStatus("O pedido ainda não foi respondido. Tente novamente mais tarde."); }, 60_000);
  };

  return (
    <div className="vynk-home">
      <div className="vynk-home-grid" aria-hidden="true" />
      <header className="vynk-home-top"><div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div><span className="vynk-home-top-note">P2P · ATÉ 5 PESSOAS</span></header>
      <main className="vynk-home-main">
        <section className="vynk-home-intro"><span className="vynk-eyebrow">SALA PRIVADA, SEM RUÍDO</span><h1>Conecte-se.<br /><em>Compartilhe.</em></h1><p>Uma sala leve para conversar, apresentar uma tela e seguir o fluxo — direto no navegador.</p><div className="vynk-home-features"><span>◉ Voz em tempo real</span><span>◉ Tela compartilhada</span><span>◉ Chat efêmero</span></div></section>
        <section className="vynk-home-card" aria-labelledby="home-card-title">
          <div className="vynk-home-card-top"><span className="vynk-eyebrow">SEU PONTO DE ENCONTRO</span><span className="vynk-home-secure">SEM CONTA</span></div>
          <h2 id="home-card-title">Vamos nos conectar?</h2>
          <p className="vynk-home-card-copy">Escolha seu nome e encontre sua turma.</p>
          <div className="vynk-home-field vynk-home-identity">
            <label htmlFor="name">Seu nome na sala</label>
            <input id="name" autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como você quer aparecer?" maxLength={24} />
          </div>
          <div className="vynk-home-create">
            <button onClick={handleCreate} disabled={loading !== null} className="vynk-home-primary">{loading === "create" ? "Criando sala…" : "Criar uma sala"}<span aria-hidden="true">↗</span></button>
            <p>Comece uma conversa e convide seus amigos.</p>
          </div>
          <form className="vynk-home-code-entry" onSubmit={(event) => { event.preventDefault(); if (loading === null) handleJoin(); }}>
            <label htmlFor="code">Já tem um código?</label>
            <div className="vynk-home-code-row">
              <input id="code" aria-label="Código da sala" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7M4PX" maxLength={6} />
              <button type="submit" disabled={loading !== null} className="vynk-home-secondary">{loading === "join" ? "Entrando…" : "Entrar"}<span aria-hidden="true">→</span></button>
            </div>
          </form>
          <div className="vynk-home-discover">
            <div><strong>Encontre uma conversa</strong><p>Explore as salas e peça para entrar.</p></div>
            <button onClick={handleListRooms} disabled={loading !== null} aria-expanded={showRooms} className="vynk-home-secondary vynk-room-list-button">{loading === "list" ? "Buscando…" : "Salas criadas"}<span aria-hidden="true">→</span></button>
          </div>
           {showRooms && <section className="vynk-room-directory" aria-labelledby="room-directory-title"><div className="vynk-room-directory-heading"><div><span className="vynk-eyebrow">SALAS DISPONÍVEIS</span><h3 id="room-directory-title">Escolha uma sala</h3></div><button onClick={handleListRooms} disabled={loading !== null} className="vynk-room-refresh" aria-label="Atualizar lista de salas">↻</button></div>{rooms.length === 0 ? <p className="vynk-room-empty">Nenhuma sala criada no momento.</p> : <div className="vynk-room-list">{rooms.map((room) => { const full = room.participantCount >= room.maxParticipants; const pending = pendingRoomId === room.id; return <article key={room.id} className="vynk-room-item"><div><strong>{room.id}</strong><span>{room.hostName} · {room.participantCount}/{room.maxParticipants} pessoas</span></div><button onClick={() => handleRequestJoin(room.id)} disabled={loading !== null || full} className="vynk-room-join-button">{pending && loading === "pending" ? "Aguardando…" : full ? "Sala cheia" : "Pedir entrada"}</button></article>; })}</div>}</section>}
           {status && <p role="status" className="vynk-home-status">{status}</p>}
           {error && <p role="alert" className="vynk-home-error">{error}</p>}
          <p className="vynk-home-footnote">Voz, tela e conversa. Sem gravação.</p>
        </section>
      </main>
      <footer className="vynk-home-footer"><span>vynk / MVP 0.1</span><span>Feito para conversas que precisam acontecer.</span></footer>
    </div>
  );
}
