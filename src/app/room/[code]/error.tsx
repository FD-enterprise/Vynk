"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RoomError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("[vynk] room page failed to render", error);
  }, [error]);

  return (
    <div className="vynk-gate">
      <div className="vynk-gate-glow" aria-hidden="true" />
      <div className="vynk-gate-card">
        <div className="vynk-brand"><span className="vynk-brand-mark">v</span><span>vynk</span></div>
        <span className="vynk-eyebrow">SALA INDISPONÍVEL</span>
        <h1>Não foi possível carregar a sala.</h1>
        <p>A conexão pode ter sido interrompida. Tente carregar novamente.</p>
        <button onClick={retry} className="vynk-primary-button">Tentar novamente</button>
        <button onClick={() => router.push("/")} className="vynk-name-modal-cancel">Voltar ao início</button>
      </div>
    </div>
  );
}
