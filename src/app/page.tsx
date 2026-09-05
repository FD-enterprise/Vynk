"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getParticipantSessionId, getSignalingSocket } from "@/lib/socket";
import { EVENTS } from "@/lib/events";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"create" | "join" | null>(null);

  const validateName = (v: string) => v.trim().length >= 1 && v.trim().length <= 24;

  const handleCreate = () => {
    if (!validateName(name)) { setError("Informe um nome de 1 a 24 caracteres."); return; }
    setError(null); setLoading("create");
    const socket = getSignalingSocket();
    const onCreated = (data: { roomId: string }) => { cleanup(); localStorage.setItem("vynk_name", name.trim()); router.push(`/room/${data.roomId}`); };
    const onError = (data: { message: string }) => { setError(data.message); setLoading(null); cleanup(); };
    const cleanup = () => { socket.off(EVENTS.ROOM_CREATED, onCreated); socket.off(EVENTS.ROOM_ERROR, onError); };
    socket.on(EVENTS.ROOM_CREATED, onCreated);
    socket.on(EVENTS.ROOM_ERROR, onError);
    const emit = () => socket.emit(EVENTS.ROOM_CREATE, { name: name.trim(), sessionId: getParticipantSessionId() });
    if (socket.connected) emit(); else socket.once("connect", emit);
    setTimeout(() => setLoading((v) => (v === "create" ? null : v)), 8000);
  };

  const handleJoin = () => {
    const upper = code.trim().toUpperCase();
    if (!validateName(name)) { setError("Informe seu nome."); return; }
    if (!/^[A-Z0-9]{6}$/.test(upper)) { setError("Código deve ter 6 caracteres (A-Z, 0-9)."); return; }
    setError(null); setLoading("join");
    const socket = getSignalingSocket();
    const onJoined = (data: { roomId: string }) => { cleanup(); localStorage.setItem("vynk_name", name.trim()); router.push(`/room/${data.roomId}`); };
    const onError = (data: { message: string }) => { setError(data.message); setLoading(null); cleanup(); };
    const cleanup = () => { socket.off(EVENTS.ROOM_JOINED, onJoined); socket.off(EVENTS.ROOM_ERROR, onError); };
    socket.on(EVENTS.ROOM_JOINED, onJoined);
    socket.on(EVENTS.ROOM_ERROR, onError);
    const emit = () => socket.emit(EVENTS.ROOM_JOIN, { roomId: upper, name: name.trim(), sessionId: getParticipantSessionId() });
    if (socket.connected) emit(); else socket.once("connect", emit);
    setTimeout(() => setLoading((v) => (v === "join" ? null : v)), 8000);
  };

  return (
    <div className="vynk-home">
      <div className="vynk-home-grid" aria-hidden="true" />
      <header className="vynk-home-top"><div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div><span className="vynk-home-top-note">P2P · ATÉ 5 PESSOAS</span></header>
      <main className="vynk-home-main">
        <section className="vynk-home-intro"><span className="vynk-eyebrow">SALA PRIVADA, SEM RUÍDO</span><h1>Conecte-se.<br /><em>Compartilhe.</em></h1><p>Uma sala leve para conversar, apresentar uma tela e seguir o fluxo — direto no navegador.</p><div className="vynk-home-features"><span>◉ Voz em tempo real</span><span>◉ Tela compartilhada</span><span>◉ Chat efêmero</span></div></section>
        <section className="vynk-home-card" aria-labelledby="home-card-title"><div className="vynk-home-card-top"><span className="vynk-eyebrow">COMEÇAR AGORA</span><span className="vynk-home-secure">⌁ privado por padrão</span></div><h2 id="home-card-title">Entre na sua sala</h2><p className="vynk-home-card-copy">Crie uma nova sala ou use o código que seu amigo enviou.</p>
          <div className="vynk-home-field"><label htmlFor="name">Como devemos chamar você?</label><input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" maxLength={24} /></div>
          <button onClick={handleCreate} disabled={loading !== null} className="vynk-home-primary">{loading === "create" ? "Criando sala…" : "Criar uma sala"}<span>↗</span></button>
          <div className="vynk-home-separator"><span>ou entre com código</span></div>
          <div className="vynk-home-field"><label htmlFor="code">Código da sala</label><input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7M4PX" maxLength={6} /></div>
          <button onClick={handleJoin} disabled={loading !== null} className="vynk-home-secondary">{loading === "join" ? "Entrando na sala…" : "Entrar com código"}<span>→</span></button>
          {error && <p role="alert" className="vynk-home-error">{error}</p>}
          <p className="vynk-home-footnote">Sem conta. Sem gravação. Seu nome fica só nesta sala.</p>
        </section>
      </main>
      <footer className="vynk-home-footer"><span>vynk / MVP 0.1</span><span>Feito para conversas que precisam acontecer.</span></footer>
    </div>
  );
}
