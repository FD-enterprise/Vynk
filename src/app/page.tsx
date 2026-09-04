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
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-lg border dark:border-zinc-800 p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">vynk</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">Salas privadas para compartilhar tela, voz e chat — até 5 pessoas, P2P no navegador.</p>
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Seu nome temporário</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Lucas" maxLength={24} className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={handleCreate} disabled={loading !== null} className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium py-2.5 text-sm transition">{loading === "create" ? "Criando..." : "Criar sala"}</button>
          <div className="relative flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" /><span className="text-xs text-zinc-500">ou entre com código</span><div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Código da sala</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7M4PX" maxLength={6} className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm tracking-widest uppercase outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={handleJoin} disabled={loading !== null} className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-medium py-2.5 text-sm transition disabled:opacity-50">{loading === "join" ? "Entrando..." : "Entrar na sala"}</button>
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-xs text-zinc-500 text-center">Link da sala: <code>/room/K7M4PX</code> — Render: <span className="font-mono text-[10px]">{process.env.NEXT_PUBLIC_SIGNALING_URL || "http://localhost:3001"}</span></p>
        </div>
      </div>
      <p className="mt-6 text-xs text-zinc-500">MVP v0.1 — custo zero • sem gravação • FASE 4</p>
    </div>
  );
}
