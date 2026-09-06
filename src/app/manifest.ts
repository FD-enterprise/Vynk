import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "vynk — salas que conectam",
    short_name: "vynk",
    description: "Salas privadas para compartilhar tela, voz e chat.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e1014",
    theme_color: "#0e1014",
    icons: [
      { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
