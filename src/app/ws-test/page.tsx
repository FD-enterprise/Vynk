"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

type Log = { t: string; msg: string };

export default function WsTestPage() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "reconnecting" | "disconnected">("idle");
  const [socketId, setSocketId] = useState<string>("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState(() => "olá da aba " + Math.random().toString(36).slice(2, 5));
  const socketRef = useRef<Socket | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [{ t: new Date().toLocaleTimeString(), msg }, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setStatus("connecting");
      // Fase 3: precisa inicializar o servidor via HTTP antes de conectar (Vercel serverless)
      try {
        await fetch("/api/socket", { method: "GET" });
      } catch {}
      if (cancelled) return;

      const s = io({ path: "/api/socket", transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });
      socketRef.current = s;

      s.on("connect", () => {
        setStatus("connected");
        setSocketId(s.id ?? "");
        addLog(`✓ connect id=${s.id} transport=${s.io.engine.transport.name}`);
      });
      s.on("disconnect", (reason) => {
        setStatus("disconnected");
        addLog(`✗ disconnect: ${reason}`);
      });
      s.io.on("reconnect", (attempt) => {
        setStatus("connected");
        addLog(`↻ reconnect attempt ${attempt} id=${s.id}`);
      });
      s.io.on("reconnect_attempt", (n) => {
        setStatus("reconnecting");
        addLog(`… reconnect_attempt ${n}`);
      });
      s.on("connect_error", (err) => {
        setStatus("disconnected");
        addLog(`⚠ connect_error: ${err.message}`);
      });
      s.on("server:welcome", (data) => addLog(`← server:welcome ${JSON.stringify(data)}`));
      s.on("server:pong", (data) => addLog(`← server:pong ${JSON.stringify(data)}`));
      s.on("server:broadcast", (data) => addLog(`← server:broadcast ${JSON.stringify(data)}`));
    }
    init();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [addLog]);

  const sendPing = () => {
    const s = socketRef.current;
    if (!s || !s.connected) { addLog("! não conectado"); return; }
    const payload = { text: input, at: Date.now() };
    s.emit("client:ping", payload);
    addLog(`→ client:ping ${JSON.stringify(payload)}`);
  };

  const sendBroadcast = () => {
    const s = socketRef.current;
    if (!s || !s.connected) { addLog("! não conectado"); return; }
    s.emit("client:broadcast", { text: input, at: Date.now() });
    addLog(`→ client:broadcast ${input}`);
  };

  const reconnect = () => {
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    setStatus("connecting");
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border dark:border-zinc-800 p-6">
          <h1 className="text-lg font-bold">FASE 3 — Prova de WebSocket na Vercel</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Validação do risco técnico: 2 abas/computadores devem se comunicar via <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/api/socket</code> (Socket.IO) hospedado na Vercel.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className={`px-3 py-1 rounded-full font-mono ${status === "connected" ? "bg-green-100 text-green-700" : status === "reconnecting" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>status: {status}</span>
            <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 font-mono">id: {socketId || "—"}</span>
            <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 font-mono">path: /api/socket</span>
          </div>
          <div className="mt-4 flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="mensagem" className="flex-1 rounded-lg border dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm" />
            <button onClick={sendPing} className="rounded-lg bg-violet-600 text-white px-4 py-2 text-sm font-medium">Ping (echo p/ todos)</button>
            <button onClick={sendBroadcast} className="rounded-lg border dark:border-zinc-700 px-4 py-2 text-sm">Broadcast</button>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={reconnect} className="text-xs underline text-zinc-600">Forçar reconexão</button>
            <span className="text-xs text-zinc-400">Abra 2 abas em /ws-test e teste ping/broadcast. Teste também 2 computadores + reconexão (F12 → Offline).</span>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border dark:border-zinc-800 p-4">
          <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Logs (50 últimos)</h2>
          <div className="mt-3 space-y-1 font-mono text-xs max-h-[420px] overflow-auto">
            {logs.length === 0 && <p className="text-zinc-400">Aguardando conexão…</p>}
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-zinc-400 shrink-0">{l.t}</span>
                <span className="break-all">{l.msg}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-200">Checklist Fase 3 (faça no https://vynk-dun.vercel.app/ws-test):</p>
          <ul className="list-disc list-inside mt-2 text-amber-900 dark:text-amber-100/80 space-y-0.5 text-xs">
            <li>Uma aba conecta e recebe <code>server:welcome</code></li>
            <li>Ping ecoa para a mesma aba (<code>server:pong</code>)</li>
            <li>2 abas: broadcast de A aparece em B</li>
            <li>2 computadores diferentes (ou celular + PC) idem</li>
            <li>Deixe 3 minutos conectado, observe se cai</li>
            <li>F12 → Network → Offline / Online → reconecta automaticamente</li>
            <li>Faça novo deploy na Vercel e veja se reconecta</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
