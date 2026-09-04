import type { NextApiRequest, NextApiResponse } from "next";
import { Server as IOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NetSocket & {
    server: HTTPServer & {
      io?: IOServer;
    };
  };
};

// Evita recriar o servidor a cada hot-reload / requisição
export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (res.socket.server.io) {
    res.status(200).json({ ok: true, ws: "already-running" });
    return;
  }

  const io = new IOServer(res.socket.server, {
    path: "/api/socket",
    addTrailingSlash: false,
    transports: ["websocket", "polling"],
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    // evento de boas-vindas
    socket.emit("server:welcome", {
      id: socket.id,
      message: "conectado ao Vercel WebSocket (Fase 3)",
      timestamp: Date.now(),
    });

    // broadcast para teste de 2 abas
    socket.on("client:ping", (payload: unknown) => {
      const data =
        typeof payload === "object" && payload !== null ? payload : { text: String(payload) };
      io.emit("server:pong", {
        fromId: socket.id,
        echo: data,
        timestamp: Date.now(),
      });
    });

    socket.on("client:broadcast", (payload: unknown) => {
      socket.broadcast.emit("server:broadcast", {
        fromId: socket.id,
        payload,
        timestamp: Date.now(),
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    socket.on("disconnect", (_reason) => {
      // opcional: log para debug Vercel
    });
  });

  res.socket.server.io = io;
  res.status(200).json({ ok: true, ws: "initialized" });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
