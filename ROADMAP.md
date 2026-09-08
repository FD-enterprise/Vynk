# ROADMAP — Vynk

Documento de estado do produto, da arquitetura e das validações pendentes.

Última atualização: 06/09/2026

Legenda:

- `[x]` Implementado e validado no código ou em teste correspondente
- `[ ]` Pendente ou ainda sem validação suficiente
- `IMPLEMENTADO` Código concluído; pode faltar validação manual específica
- `VALIDADO` Confirmado por teste automatizado ou uso manual registrado

---

## Estado atual

```text
IMPLEMENTAÇÃO DO MVP: CONCLUÍDA
VALIDAÇÃO MULTI-REDE E MULTI-DISPOSITIVO: PENDENTE
```

O Vynk é uma aplicação de salas temporárias para:

- compartilhamento de tela;
- áudio da tela quando o navegador/OS disponibiliza;
- voz bidirecional;
- chat efêmero;
- presença e reconexão;
- aprovação do host para pedidos vindos da lista pública;
- instalação como PWA.

Limite atual: até 5 participantes por sala.

---

## Arquitetura real

### Frontend

- Next.js `16.3.4`
- React `19.2.8`
- TypeScript
- App Router
- Deploy planejado/registrado na Vercel: `https://vynk-dun.vercel.app`

### Signaling

- Node.js + Express + Socket.IO
- Serviço separado em `server/`
- Deploy Render: `https://vynk-mwxh.onrender.com`
- Healthcheck: `/health`
- URL configurada pelo frontend com `NEXT_PUBLIC_SIGNALING_URL`
- Fallback de produção mantido em `src/lib/socket.ts`

### Mídia

- WebRTC mesh: uma `RTCPeerConnection` por par de participantes
- `RTCPeerConnection`, `getDisplayMedia` e `getUserMedia`
- Signaling transporta apenas eventos de controle, SDP e ICE
- Mídia segue diretamente entre peers quando possível
- Quando necessário, o relay é o TURN da Cloudflare, não o servidor Render

### Persistência

- Nenhum banco de dados
- Salas, participantes, pedidos e histórico de chat ficam em memória no processo Render
- Reiniciar o serviço encerra as salas existentes

### Infraestrutura TURN

- Credenciais temporárias geradas no servidor via API da Cloudflare
- Endpoint do signaling: `GET /turn`
- Variáveis privadas no Render:
  - `CLOUDFLARE_TURN_API_TOKEN`
  - `CLOUDFLARE_TURN_KEY_ID`
- STUN do Google e Cloudflare continuam disponíveis como fallback
- `NEXT_PUBLIC_FORCE_TURN=true` existe apenas para diagnóstico e não deve ficar ativo normalmente

---

## Funcionalidades concluídas

### Salas e entrada

- [x] Criar sala com código aleatório de 6 caracteres
- [x] Entrar diretamente com código
- [x] Entrar por link `/room/[code]`
- [x] Solicitar nome temporário, validado entre 1 e 24 caracteres
- [x] Modal `Como podemos te chamar?` ao tentar entrar sem nome
- [x] Lista de salas ativas na home
- [x] Exibir host e ocupação da sala
- [x] Solicitar entrada em sala a partir da lista
- [x] Host aprovar ou recusar pedidos de entrada
- [x] Cancelar pedidos pendentes quando necessário
- [x] Bloquear entrada aprovada quando a sala fica cheia
- [x] Limite de 5 participantes controlado pelo servidor
- [x] Controles do host: remover participante, transferir host e encerrar sala
- [x] Bloquear novas entradas sem cancelar pedidos já existentes

Regra atual:

- entrada direta por código continua imediata;
- entrada pela lista exige aprovação do host.

Arquivos principais: `src/app/page.tsx`, `src/app/room/[code]/page.tsx`, `server/src/index.ts`, `server/src/rooms.ts`.

### Presença e reconexão

- [x] Identidade temporária por aba com `sessionId`
- [x] Estados `online`, `reconnecting` e `offline`
- [x] Recuperar participante após reconexão dentro da janela de recuperação
- [x] Evitar duplicação após refresh/reconexão
- [x] Transferir host após remoção definitiva do host anterior
- [x] Limpar participante, peers, streams e timers ao sair

### Signaling WebRTC

- [x] Eventos compartilhados em `shared/events.ts`
- [x] Offer, answer e ICE candidate
- [x] Validação Zod no servidor
- [x] Verificação de origem, destino e participação na sala
- [x] Fila para ICE recebido antes do SDP remoto
- [x] Retry controlado após falha ICE
- [x] Limpeza de listeners, timers, data channels e peer connections

### Tela compartilhada

- [x] Captura explícita com `getDisplayMedia`
- [x] Preview local
- [x] Tela do host distribuída para os participantes
- [x] Participante autorizado pelo host pode compartilhar tela
- [x] Parar pelo botão ou pelo encerramento nativo do seletor
- [x] Encerrar tracks e remover imagem remota sem quadro congelado
- [x] Fullscreen da transmissão
- [x] Preferência de captura em 30 FPS
- [x] Bitrate máximo de vídeo configurado em `3,5 Mbps`
- [x] `degradationPreference: maintain-resolution` para preservar detalhe da tela
- [x] Bitrate máximo do áudio da tela configurado em `256 kbps`
- [x] Áudio de sistema marcado como conteúdo musical
- [x] Cancelamento de eco, ganho automático e redução de ruído desativados para áudio de sistema quando suportado

Arquivos principais: `src/hooks/useScreenShare.ts`, `src/hooks/useWebRTCSignaling.ts`.

### Voz

- [x] Solicitar microfone somente por ação explícita
- [x] Voz bidirecional entre participantes
- [x] Transceiver separado para microfone e áudio da tela
- [x] Mutar/desmutar sem renegociação
- [x] Mute forçado pelo host, com liberação pelo menu de moderação
- [x] Indicador remoto de microfone
- [x] Controle individual de voz por participante
- [x] Volume individual de `0%` a `200%`, padrão `100%`
- [x] `GainNode` para permitir amplificação acima de 100%
- [x] Controle separado para volume da transmissão
- [x] Tratamento de autoplay bloqueado com ação `Liberar áudio`

### Chat

- [x] Enviar por botão ou Enter
- [x] Shift+Enter para quebra de linha
- [x] Histórico temporário limitado a 200 mensagens
- [x] Mensagem limitada a 500 caracteres
- [x] Nome, autor e horário local
- [x] Rate limit básico no servidor
- [x] Renderização como texto, sem HTML arbitrário

### Interface e acessibilidade

- [x] Layout desktop com palco e painel lateral
- [x] Layout mobile responsivo
- [x] Estado de conexão e qualidade de mídia
- [x] Estados de loading, erro e permissão
- [x] Foco visível e labels acessíveis
- [x] Controles de volume acessíveis
- [x] Home reorganizada por criar, entrar com código e descobrir salas
- [x] Modal de nome antes da entrada

### PWA

- [x] Manifesto em `/manifest.webmanifest`
- [x] Ícone do Vynk
- [x] `display: standalone`
- [x] Tema escuro para instalação
- [x] Service worker registrado somente em produção
- [x] Service worker sem cache agressivo de páginas dinâmicas

Arquivos principais: `src/app/manifest.ts`, `public/icon.svg`, `public/sw.js`, `src/components/ServiceWorkerRegistration.tsx`.

---

## Segurança e limites

- [x] Códigos e nomes validados no servidor
- [x] Peer IDs limitados por tamanho e caracteres permitidos
- [x] SDP e ICE limitados por tamanho e schema
- [x] Participação verificada antes de signaling, chat, microfone e tela
- [x] Host verificado para permissões de tela e aprovação de entrada
- [x] Payload HTTP e buffer Socket.IO limitados
- [x] Rate limit para criação, entrada, pedidos, chat e signaling
- [x] Tokens da Cloudflare mantidos fora do bundle do navegador
- [x] Nenhum áudio ou vídeo armazenado
- [x] Nenhuma mídia enviada pelo signaling Render

Limitações conhecidas:

- salas desaparecem quando o processo Render reinicia;
- a arquitetura mesh aumenta o upload do transmissor conforme entram participantes;
- áudio da tela depende do suporte do navegador e do sistema operacional;
- amplificar voz acima de 100% pode causar clipping se a origem já estiver alta;
- o service worker não oferece uso offline completo, por decisão para não cachear salas e bundles dinâmicos;
- o ícone atual é SVG; adicionar versões raster específicas pode melhorar compatibilidade de instalação em alguns dispositivos Apple.

---

## Validação automatizada atual

Comandos do frontend:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Comandos do signaling:

```bash
cd server
npm run typecheck
npm run build
```

Estado conhecido no último ciclo:

- [x] Typecheck do frontend
- [x] Lint do frontend
- [x] 10 testes automatizados passando
- [x] Build de produção do frontend
- [x] Typecheck do signaling
- [x] Build de produção do signaling
- [x] `git diff --check`

---

## Validação pendente

### Salas e aprovação

- [ ] Testar lista vazia e lista com várias salas em produção
- [ ] Testar pedido aprovado em dois navegadores reais
- [ ] Testar pedido recusado
- [ ] Testar pedido cancelado ou expirado
- [ ] Testar duas solicitações simultâneas para a mesma sala
- [ ] Confirmar que sala cheia não permite nova aprovação

### WebRTC e redes

- [ ] Testar 2 participantes em redes diferentes
- [ ] Testar 3 participantes em três navegadores
- [ ] Testar 4 participantes
- [ ] Testar 5 participantes
- [ ] Testar Wi-Fi, 4G/5G e provedores diferentes
- [ ] Confirmar tela para todos os participantes
- [ ] Confirmar voz entre todos os pares
- [ ] Confirmar reconexão sem peers duplicados
- [ ] Confirmar encerramento correto de câmera, microfone e tela ao sair

### TURN e consumo

- [ ] Confirmar no navegador se a conexão usa `host`, `srflx` ou `relay`
- [ ] Validar `GET /turn` com variáveis reais do Render
- [ ] Testar uma rede que exija relay
- [ ] Medir upload com 2, 3 e 5 participantes
- [ ] Comparar qualidade do áudio da tela em voz, vídeo e música
- [ ] Confirmar que `NEXT_PUBLIC_FORCE_TURN` permanece desligado fora do diagnóstico
- [ ] Registrar custo e volume de tráfego do Cloudflare TURN

### PWA e interface

- [ ] Instalar no Chrome/Edge desktop
- [ ] Instalar no Android
- [ ] Instalar no iOS pelo menu de compartilhamento
- [ ] Confirmar abertura em modo standalone
- [ ] Revisar home em 390px, 768px e 1440px
- [ ] Validar navegação por teclado no modal de nome e nos pedidos do host

---

## Próximas prioridades

1. Validar entrada por lista e aprovação em produção.
2. Completar testes com 3–5 participantes e redes diferentes.
3. Medir `bytesSent`, candidato ICE selecionado, RTT e perda por peer.
4. Ajustar bitrate somente com base nas medições de qualidade e custo.
5. Adicionar testes automatizados de contrato para lista, pedido, aprovação e recusa.
6. Melhorar compatibilidade de ícones PWA com versões PNG 192x192 e 512x512.
7. Avaliar persistência externa somente se salas em memória se tornarem insuficientes.

---

## Fora do escopo atual

- contas e login;
- banco de dados de salas;
- salas permanentes;
- histórico persistente de chat;
- gravação;
- upload ou armazenamento de mídia;
- SFU/MCU;
- Redis, filas ou mensageria externa;
- aplicativo nativo separado;
- pagamentos e assinaturas;
- DRM ou tentativa de contornar proteções do navegador.

---

## Definition of Done

Uma mudança funcional só deve ser considerada concluída quando aplicável:

- [ ] requisito implementado;
- [ ] validação de payload e permissão no servidor;
- [ ] estados de loading, erro e reconexão tratados;
- [ ] cleanup de listeners, timers e mídia implementado;
- [ ] typecheck passa;
- [ ] lint passa;
- [ ] testes passam;
- [ ] build passa;
- [ ] nenhum segredo versionado;
- [ ] mídia não passa pelo signaling;
- [ ] mídia não é armazenada;
- [ ] documentação atualizada.
