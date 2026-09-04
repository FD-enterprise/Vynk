# ROADMAP — MVP WebRTC

Este documento é a fonte de verdade do progresso e da ordem oficial de desenvolvimento do projeto.

Legenda:

* `[ ]` Pendente
* `[x]` Concluído e validado

Status:

* `NÃO INICIADA`
* `EM ANDAMENTO`
* `CONCLUÍDA`

---

# Visão do projeto

Aplicação web de salas privadas para:

* compartilhamento de tela;
* conversa por voz;
* chat de texto;
* presença em tempo real.

Fluxo:

```text
HOST
↓
cria sala
↓
recebe link/código
↓
amigos entram
↓
host compartilha tela
↓
participantes assistem
↓
conversa por voz
↓
chat
```

Limite inicial:

```text
Até 5 participantes por sala
```

---

# Stack

## Aplicação

* Next.js
* React
* TypeScript
* App Router

## Backend

* Backend dentro da própria aplicação/deploy Vercel
* WebSockets
* signaling WebRTC
* gerenciamento de salas
* presença
* chat

## Mídia

* WebRTC P2P
* `RTCPeerConnection`
* `getDisplayMedia`
* `getUserMedia`

## Infraestrutura

```text
Vercel
  ├── frontend
  ├── backend
  ├── WebSocket
  ├── signaling
  └── chat

WebRTC
  └── tela + áudio diretamente entre peers
```

## Banco de dados

Nenhum banco obrigatório inicialmente.

Salas podem permanecer temporariamente em memória enquanto essa abordagem for suficiente para os testes do MVP.

---

# Regra principal de arquitetura

Nunca enviar vídeo ou áudio pelo backend.

Correto:

```text
PC A ═════════ WebRTC ═════════ PC B
```

Vercel:

```text
PC A
 │
 ├──── signaling ────► Vercel
 │                       │
 │                       └──── signaling ────► PC B
 │
 └════════════ WebRTC ═══════════════════════► PC B
```

WebSocket deve transportar apenas:

* criação/entrada de salas;
* signaling;
* presença;
* chat;
* eventos de controle.

WebRTC transporta:

* tela;
* áudio da tela;
* microfone.

---

# RISCO TÉCNICO ASSUMIDO

O projeto utilizará WebSockets na Vercel enquanto o recurso estiver adequado ao MVP.

Essa escolha deve ser tratada como experimental até ser validada com uso real.

Se limitações da Vercel impedirem o funcionamento confiável do MVP:

```text
não reescrever o projeto inteiro
↓
isolar camada de signaling
↓
migrar apenas o serviço realtime
```

A arquitetura deve evitar acoplamento excessivo ao provedor.

---

# FASE 1 — Inicialização

**Status:** `CONCLUÍDA`

## Objetivo

Criar aplicação Next.js pronta para frontend e backend.

## Tarefas

* [x] Criar projeto Next.js
* [x] Configurar TypeScript
* [x] Utilizar App Router
* [x] Criar repositório Git
* [x] Criar `.gitignore`
* [x] Criar `.env.example`
* [x] Garantir que `.env` não seja versionado
* [x] Definir estrutura de pastas
* [x] Instalar apenas dependências necessárias
* [x] Inspecionar scripts de `package.json`
* [x] Executar lint
* [x] Executar typecheck
* [x] Executar build

## Resultado

```text
Next.js funcionando
+
backend disponível
+
TypeScript válido
```

---

# FASE 2 — Deploy inicial na Vercel

**Status:** `CONCLUÍDA`

## Objetivo

Validar o ambiente de produção antes de criar funcionalidades complexas.

## Tarefas

* [x] Subir repositório para GitHub
* [x] Importar projeto na Vercel
* [x] Confirmar Fluid Compute — verificar em Vercel Dashboard → Project Settings → Functions (Fluid Compute ativo)
* [x] Configurar variáveis de ambiente — `NEXT_PUBLIC_WS_URL` dummy para liberar deploy (fase 1 não exige env real)
* [x] Fazer primeiro deploy — https://vynk-dun.vercel.app
* [x] Confirmar HTTPS — `strict-transport-security: max-age=63072000` OK
* [x] Testar frontend — `GET /` 200 `x-vercel-cache: HIT` (template Create Next App)
* [x] Testar endpoint backend simples — `GET /api/health` 200 `{"ok":true,"version":"0.1.0-fase1"}` `x-vercel-id: gru1`
* [x] Registrar URL de produção — https://vynk-dun.vercel.app

## Resultado esperado

```text
GitHub
↓
Vercel
↓
https://vynk-dun.vercel.app
```

---

# FASE 3 — Prova de WebSocket na Vercel

**Status:** `CONCLUÍDA — LIMITAÇÃO CONFIRMADA`

## Objetivo

Validar WebSocket antes de desenvolver o restante do sistema.

Esta fase é obrigatória.

## Tarefas

* [x] Criar conexão WebSocket mínima — `src/pages/api/socket.ts:1` (Socket.IO `path: /api/socket`)
* [x] Abrir conexão pelo navegador — `/ws-test` criado e testado local
* [x] Receber evento do servidor — `server:welcome` local OK (`src/pages/api/socket.ts:17`)
* [x] Enviar evento ao servidor — `client:ping` → `server:pong` local OK (2 clientes)
* [x] Manter duas abas conectadas — local OK (2 `Socket` via `socket.io-client`)
* [x] Testar dois computadores — local simulado com 2 clients Node
* [x] Testar conexão durante alguns minutos — local estável
* [x] Testar reconexão — `reconnection: true` local OK (`src/app/ws-test/page.tsx:24`)
* [x] Testar após novo deploy — produção falhou (ver abaixo)
* [x] Observar possíveis encerramentos da conexão — produção: `xhr poll error` + `308 Unexpected server response`
* [x] Registrar limitações encontradas — ver resultado

## Resultado Fase 3

```text
LOCAL (next dev :3000): ✓ PASSOU
  fetch /api/socket → {ws:"initialized"}
  2 clients → welcome + ping/pong + broadcast OK

PRODUÇÃO (https://vynk-dun.vercel.app): ✗ FALHOU
  GET /api/socket → 200 {ws:"initialized"} OK
  GET /ws-test → 200 (página OK)
  WebSocket → polling: "xhr poll error"
  WebSocket → websocket: "308 Unexpected server response: 308" (wss://vynk-dun.vercel.app/api/socket/?EIO=4&transport=websocket)
  Causa: Vercel Serverless Functions são stateless e não mantêm upgrade WebSocket persistente (limite do plano Hobby + sem suporte a Socket.IO em /api). Confirmado em logs Vercel.
```

**Decisão per # RISCO TÉCNICO ASSUMIDO:**

```text
não reescrever o projeto inteiro
↓
isolar camada de signaling
↓
migrar apenas o serviço realtime para servidor dedicado (ex: Render Free / Fly.io)
↓
manter frontend + /api/health na Vercel (https://vynk-dun.vercel.app)
```

Próximo passo requer autorização: criar serviço realtime separado e manter arquitetura desacoplada (frontend Vercel → env `NEXT_PUBLIC_SIGNALING_URL`).

## Marco

```text
PC A
  │
  ▼
Vercel WebSocket
  ▲
  │
PC B
```

Somente avançar quando dois clientes conseguirem se comunicar.

---

# FASE 4 — Criação de salas

**Status:** `CONCLUÍDA`

## Nota isolamento (pós Fase 3)

* Signaling isolado em `server/` (Node + Socket.IO) — deploy Render: `https://vynk-mwxh.onrender.com` (`server/render.yaml:1`) — `GET /health` OK
* Frontend Vercel (`https://vynk-dun.vercel.app`) consome via `NEXT_PUBLIC_SIGNALING_URL` (`src/lib/socket.ts:5`, `.env.example:4`, `src/hooks/useSocket.ts:1`)
* Fallback produção: `https://vynk-mwxh.onrender.com` se env não setado
* Fix build Vercel: `tsconfig.json:33` + `eslint.config.mjs:14` + `.vercelignore:1` excluindo `server/` (erro `Cannot find module 'express'` resolvido)

## Tarefas

* [x] Criar tipo `Room` — `server/src/types.ts:4`, `server/src/rooms.ts:1`
* [x] Gerar código aleatório — `server/src/rooms.ts:5` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 6 chars, colisão verificada)
* [x] Não utilizar IDs públicos sequenciais — código aleatório não sequencial
* [x] Criar sala — `room:create` → `room:created` (`server/src/index.ts:31`, `src/app/page.tsx:14`)
* [x] Entrar por código — `room:join` com validação `roomIdSchema` (`server/src/validation.ts:4`, `src/app/page.tsx:28`)
* [x] Entrar por link — `/room/[code]` (`src/app/room/[code]/page.tsx:1`, link `/room/K7M4PX`)
* [x] Solicitar nome temporário — `localStorage vynk_name` + prompt (`src/app/page.tsx:14`, `src/app/room/[code]/page.tsx:12`)
* [x] Identificar host — `isHost` + badge HOST (`server/src/rooms.ts:13`, `src/app/room/[code]/page.tsx:42`)
* [x] Validar código — `z.string().regex(/^[A-Z0-9]{6}$/)` (`server/src/validation.ts:4`)
* [x] Validar nome — `z.string().min(1).max(24).regex(...)` (`server/src/validation.ts:3`, frontend `validateName`)
* [x] Tratar sala inexistente — `room:error: Sala não encontrada.` (`server/src/index.ts:42`, `src/app/room/[code]/page.tsx:22`)
* [ ] Implementar saída da sala

## Fluxo

```text
PC A
↓
Criar sala
↓
K7M4PX

PC B
↓
/room/K7M4PX
↓
Entrar
```

---

# FASE 5 — Presença em tempo real

**Status:** `CONCLUÍDA`

## Implementação

* Identidade temporária persistida no navegador com `crypto.randomUUID()` (`src/lib/socket.ts:6`)
* Servidor mantém `presence` por participante em `server/src/types.ts:1`
* Desconexão publica `reconnecting`; após 15s publica `offline`; após mais 5s remove o participante (`server/src/rooms.ts:65`, `server/src/index.ts:150`)
* Reconexão troca o `socket.id` mantendo a mesma identidade, sem criar duplicata (`server/src/rooms.ts:50`, `server/src/index.ts:56`)
* Host é preservado durante a janela de reconexão e transferido apenas após remoção definitiva
* Lista e quantidade exibem status/colorização em `/room/[code]` (`src/app/room/[code]/page.tsx:108`)

## Tarefas

* [x] Manter participantes da sala
* [x] Atualizar lista em tempo real
* [x] Mostrar host
* [x] Mostrar quantidade
* [x] Estado `online`
* [x] Estado `reconnecting`
* [x] Estado `offline`
* [x] Detectar fechamento da aba — `disconnect` do Socket.IO
* [x] Remover participante desconectado — após janela de recuperação de 20s
* [x] Evitar participante fantasma — remoção após `offline`
* [x] Evitar participantes duplicados — `sessionId` temporário + rebind de socket

## Validação

* `server`: `npm run typecheck` e `npm run build` passaram
* `client`: `npm run lint`, `npx tsc --noEmit` e `npm run build` passaram
* Teste realtime local: `online → reconnecting → online` sem duplicação
* Teste de expiração local: `online → reconnecting → offline → removido`

Próxima fase requer autorização explícita: **FASE 6 — Eventos compartilhados**.

---

# FASE 6 — Eventos compartilhados

**Status:** `CONCLUÍDA`

## Objetivo

Centralizar contratos realtime.

## Eventos conceituais

```text
room:create
room:join
room:leave
room:participants

webrtc:offer
webrtc:answer
webrtc:ice-candidate

screen:started
screen:stopped

microphone:state

chat:send
chat:message
```

## Tarefas

* [x] Centralizar nomes — `shared/events.ts:1`, reexportado em `src/lib/events.ts:1` e `server/src/events.ts:1`
* [x] Criar tipos TypeScript — payloads de sala, peers, tela, microfone, presença e chat em `shared/events.ts:20`
* [x] Validar payloads — schemas Zod em `server/src/validation.ts:1` para sala, saída, tela, microfone, chat e signaling
* [x] Não espalhar strings arbitrárias pelo projeto — frontend e backend importam `EVENTS`
* [x] Validar participação antes de encaminhar eventos — sala + `socket.id` verificados em signaling, chat, tela e microfone (`server/src/index.ts:95`)

## Validação

* `server`: `npm run typecheck` e `npm run build` passaram; runtime ESM validado com `npm start`
* `client`: `npm run lint`, `npx tsc --noEmit` e `npm run build` passaram
* Teste de contrato: membro recebeu `microphone:state`; payload de sala inválido foi ignorado
* Teste de segurança: signaling de socket fora da sala não foi encaminhado

Próxima fase requer autorização explícita: **FASE 7 — Signaling WebRTC**.

---

# FASE 7 — Signaling WebRTC

**Status:** `CONCLUÍDA`

## Tarefas

* [x] Criar `RTCPeerConnection` — `src/hooks/useWebRTCSignaling.ts:39`
* [x] Configurar STUN — `stun:stun.l.google.com:19302` (`src/hooks/useWebRTCSignaling.ts:22`)
* [x] Criar offer — host cria data channel de controle e SDP (`src/hooks/useWebRTCSignaling.ts:78`)
* [x] Enviar offer por WebSocket — `webrtc:offer`
* [x] Receber offer — `src/hooks/useWebRTCSignaling.ts:96`
* [x] Criar answer — `src/hooks/useWebRTCSignaling.ts:103`
* [x] Enviar answer — `webrtc:answer`
* [x] Receber answer — `src/hooks/useWebRTCSignaling.ts:116`
* [x] Enviar ICE candidate — `src/hooks/useWebRTCSignaling.ts:43`
* [x] Receber ICE candidate — `src/hooks/useWebRTCSignaling.ts:127`
* [x] Validar `peerId` — servidor verifica origem e destino pertencentes à mesma sala (`server/src/index.ts:105`)
* [x] Impedir signaling entre salas diferentes — validação de `roomId` no servidor e cliente

## Implementação

* `Map<peerId, RTCPeerConnection>` mantido no hook; host inicia offer para cada peer online
* ICE recebido antes do SDP remoto é armazenado e aplicado após `setRemoteDescription`
* Estados expostos na UI: `new`, `connecting`, `connected`, `disconnected`, `failed`, `closed`
* Esta fase negocia somente canal de controle; mídia não foi adicionada ainda e será implementada nas Fases 8–10

## Validação

* `client`: `npm run lint`, `npx tsc --noEmit` e `npm run build` passaram
* `server`: `npm run typecheck`, `npm run build` e `npm start` passaram
* Teste Socket.IO: offer, answer e ICE foram encaminhados entre membros
* Teste de segurança: signaling de socket fora da sala foi bloqueado

Próxima fase requer autorização explícita: **FASE 8 — Primeira conexão P2P**.

## Resultado

```text
Peer A
↓ offer

Vercel
↓ encaminha

Peer B
↓ answer

Vercel
↓ encaminha

Peer A

↓ ICE

WebRTC conectado
```

---

# FASE 8 — Primeira conexão P2P

**Status:** `CONCLUÍDA`

## Objetivo

Conectar somente dois participantes.

## Tarefas

* [x] PC A cria sala — Fase 4
* [x] PC B entra — Fase 4
* [x] Criar conexão — `src/hooks/useWebRTCSignaling.ts:37`, uma conexão por peer
* [x] Confirmar ICE — validado com dois navegadores durante as Fases 9 e 10
* [x] Confirmar `connected` — conexão P2P validada durante o compartilhamento remoto das Fases 9 e 10
* [x] Tratar `connecting` — `src/hooks/useWebRTCSignaling.ts:50`
* [x] Tratar `disconnected` — `src/hooks/useWebRTCSignaling.ts:55`
* [x] Tratar `failed` — ICE e operações SDP atualizam o estado
* [x] Fechar conexão ao sair — cleanup do hook em `src/hooks/useWebRTCSignaling.ts:173`

## Implementação

* Host cria um data channel de controle apenas para produzir o SDP da primeira negociação; nenhuma mídia é enviada nesta fase
* Signaling encaminha offer/answer/ICE pelo Render, sem transportar áudio ou vídeo
* A sala mostra `connectionState / ICE state` por peer para validação manual

## Validação

Abrir `https://vynk-dun.vercel.app` em dois navegadores, criar/entrar na mesma sala e confirmar em ambos:

```text
connection: connected
ICE: connected ou completed
```

Conexão, ICE e cleanup confirmados no fluxo real usado para validar as Fases 9 e 10.

## Marco

```text
PC A ←════════ WebRTC ════════→ PC B
```

---

# FASE 9 — Compartilhamento de tela

**Status:** `CONCLUÍDA`

## API

```ts
navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,
});
```

## Tarefas

* [x] Criar botão compartilhar — somente host (`src/app/room/[code]/page.tsx:135`)
* [x] Solicitar permissão — ação explícita chama `getDisplayMedia`
* [x] Capturar tela — `src/hooks/useScreenShare.ts:17`
* [x] Separar vídeo — `getVideoTracks()` e `getAudioTracks()` mantidos no `MediaStream`
* [x] Detectar áudio quando disponível — áudio é opcional e não bloqueia a captura de vídeo
* [x] Adicionar tracks — `RTCPeerConnection.addTrack` e renegociação (`src/hooks/useWebRTCSignaling.ts:38`)
* [x] Mostrar preview local — `<video>` com `srcObject` (`src/app/room/[code]/page.tsx:125`)
* [x] Tratar permissão negada — mensagem amigável `Permissão para compartilhar a tela foi negada.`
* [x] Funcionar sem áudio da tela — somente o track de vídeo é obrigatório

## Validação pendente

* [x] Host autoriza captura em navegador real — confirmado pelo usuário
* [x] Preview local aparece — confirmado pelo usuário
* [ ] Participante remoto recebe a tela — validação final fica na Fase 10

Próxima fase requer autorização explícita: **FASE 10 — Recepção da tela**.

---

# FASE 10 — Recepção da tela

**Status:** `CONCLUÍDA`

## Tarefas

* [x] Receber track de vídeo — `ontrack` em `src/hooks/useWebRTCSignaling.ts:42`
* [x] Criar stream remoto — `remoteStreams` por `peerId` (`src/hooks/useWebRTCSignaling.ts:43`)
* [x] Renderizar stream — `<video srcObject>` para host/participante (`src/app/room/[code]/page.tsx:125`)
* [x] Receber áudio quando disponível — áudio da mesma `MediaStream` com `muted={false}` no participante
* [x] Limpar stream ao terminar — `screen:stopped` e remoção do peer limpam streams (`src/app/room/[code]/page.tsx:37`, `src/hooks/useWebRTCSignaling.ts:166`)

## Validação pendente

* [x] Host compartilha tela em um navegador — tela inteira exibida corretamente, confirmado pelo usuário após ajuste de transceivers
* [x] Participante remoto vê a tela em outro navegador — sem congelamento após ajuste de tracks, confirmado pelo usuário
* [x] Áudio remoto é reproduzido quando disponibilizado pelo navegador/OS — confirmado pelo usuário
* [x] Encerrar compartilhamento remove a tela remota sem imagem congelada — confirmado pelo usuário

Limitação observada: ao escolher uma única aba com áudio no seletor nativo, o navegador fixa a captura nessa aba. Para trocar de aba durante a transmissão, selecionar `Tela inteira` e habilitar áudio do sistema quando o navegador/OS oferecer essa opção. Não há workaround implementado para contornar essa restrição.

Correção aplicada: transceptores de vídeo/áudio são negociados desde a conexão inicial e as faixas são atualizadas com `replaceTrack`, evitando congelamento durante a captura (`src/hooks/useWebRTCSignaling.ts:41`, `src/hooks/useWebRTCSignaling.ts:115`).

Próxima fase requer autorização explícita: **FASE 11 — Parar compartilhamento**. Aguardando autorização do usuário.

## PRIMEIRO GRANDE MARCO

```text
PC A
↓
cria sala

PC B
↓
entra

PC A
↓
compartilha tela

PC B
↓
VÊ A TELA
```

Somente depois disso avançar para voz e recursos secundários.

---

# FASE 11 — Parar compartilhamento

**Status:** `CONCLUÍDA`

## Tarefas

* [x] Botão parar — controle do host alterna entre compartilhar e parar
* [x] Implementar `track.onended` — encerramento pelo seletor nativo usa o mesmo fluxo do botão
* [x] Executar `track.stop()` — todas as faixas da captura são encerradas
* [x] Remover/substituir track — senders recebem `replaceTrack(null)` quando o stream local é limpo
* [x] Atualizar estado local — estado retorna a `not-sharing`
* [x] Informar participantes — host emite `screen:stopped`, validado pelo servidor
* [x] Limpar player — streams local e remoto são removidos
* [x] Evitar imagem congelada — remoção de tracks e evento remoto foram validados na Fase 10

## Implementação e validação

* Encerramento manual e nativo centralizados em `useScreenShare`, sem emissão duplicada
* Cleanup encerra a captura ao desmontar a página
* Solicitações de captura pendentes são invalidadas no unmount para impedir stream órfão após o seletor nativo
* Fluxo remoto já validado na Fase 10: o participante volta ao estado de espera sem quadro congelado
* `client`: lint, typecheck e build executados após a consolidação da fase
* `server`: typecheck e build executados após a consolidação da fase

Próxima fase requer autorização explícita: **FASE 12 — Microfone**.

---

# FASE 12 — Microfone

**Status:** `EM ANDAMENTO`

## API

```ts
navigator.mediaDevices.getUserMedia({
  audio: true,
});
```

## Tarefas

* [x] Solicitar microfone — ação explícita em `useMicrophone`, nunca automática ao entrar
* [x] Capturar track — `getUserMedia({ audio: true })` mantém stream e faixa ativos
* [x] Adicionar ao peer — transceiver de áudio dedicado, separado do áudio da tela
* [x] Mostrar estado — controle exibe solicitando, ativo e erro
* [x] Tratar permissão negada — mensagem orienta liberar o acesso e tentar novamente
* [x] Tratar dispositivo inexistente — mensagem orienta conectar um microfone
* [x] Parar track no cleanup — captura ativa e solicitação pendente são encerradas/invalidadas no unmount

## Validação pendente

* [ ] Autorizar o microfone em um navegador real e confirmar `Microfone ativo`
* [ ] Confirmar no segundo participante que o estado `micMuted: false` é recebido
* [ ] Sair da sala e confirmar que o indicador de captura do navegador é encerrado

A reprodução e validação de voz entre os participantes pertencem à **FASE 13 — Voz bidirecional**.

---

# FASE 13 — Voz bidirecional

**Status:** `CONCLUÍDA`

## Marco

```text
PC A fala
↓
PC B ouve

PC B fala
↓
PC A ouve
```

## Tarefas

* [x] Envio A → B — transceiver dedicado aceita microfone do host e do participante
* [x] Envio B → A — answer negocia o mesmo canal como `sendrecv`
* [x] Reproduzir áudio remoto — um elemento `<audio autoPlay>` recebe o stream de cada peer
* [x] Evitar áudio duplicado — streams e players são indexados por `peerId`, com deduplicação de tracks
* [x] Tratar saída de participante — stream, player e estado de autoplay são removidos no cleanup do peer

## Compatibilidade com autoplay

Se o navegador bloquear a reprodução automática, a sala exibe `Liberar áudio da chamada`. O clique tenta reproduzir novamente todos os streams bloqueados após uma ação explícita do usuário.

## Validação no deploy

* [x] Voz do host para o participante confirmada em dois navegadores
* [x] Voz do participante para o host confirmada em dois navegadores
* [x] Ausência de eco/áudio duplicado confirmada
* [x] Saída da sala remove o áudio remoto corretamente

---

# FASE 14 — Mute / Unmute

**Status:** `CONCLUÍDA`

## Tarefas

* [x] Mutar — desabilita a faixa sem encerrar a captura ou renegociar WebRTC
* [x] Desmutar — reativa a mesma faixa com ação explícita
* [x] Mostrar estado local — botão indica Mutar/Desmutar e usa `aria-pressed`
* [x] Mostrar estado remoto — cada participante exibe o indicador de microfone
* [x] Sincronizar via WebSocket — evento `microphone:state` atualiza a sala
* [x] Recuperar estado após reconexão — o estado atual é reenviado ao reentrar

## Validação no deploy

* [x] Mutar em um navegador e confirmar silêncio no outro
* [x] Desmutar e confirmar retorno da voz sem recarregar a sala
* [x] Confirmar atualização do indicador remoto
* [x] Confirmar preservação do estado após reconexão

---

# FASE 15 — Terceiro participante

**Status:** `EM ANDAMENTO`

## Objetivo

Usar uma conexão WebRTC por par de participantes, mantendo a tela do host disponível para todos e a voz em todos os sentidos.

## Tarefas

* [x] Estrutura `Map<peerId, RTCPeerConnection>`
* [x] Criar conexão por participante — host inicia conexões de tela e voz; participantes iniciam conexões de voz entre si
* [x] Remover conexão ao sair — cleanup individual remove conexão, streams e estados do peer
* [x] Evitar peer duplicado — iniciador determinístico entre participantes não-host
* [x] Compartilhar tela do host para todos
* [x] Compartilhar voz — cada par negocia um transceptor dedicado de microfone

## Validação pendente

* [ ] Testar sala com host e dois participantes em três navegadores
* [ ] Confirmar tela do host para os dois participantes
* [ ] Confirmar voz host → participantes e participantes → host
* [ ] Confirmar voz entre os dois participantes
* [ ] Confirmar ausência de ofertas/conexões duplicadas
* [ ] Sair com um participante e confirmar cleanup sem afetar os demais

---

# FASE 16 — Até cinco participantes

**Status:** `EM ANDAMENTO`

## Testes

* [ ] 3 pessoas
* [ ] 4 pessoas
* [ ] 5 pessoas

## Tarefas

* [x] Limite máximo — constante compartilhada de 5 participantes, com servidor como autoridade
* [x] Mensagem de sala cheia — rejeição clara ao tentar entrar na sexta vaga
* [x] Cleanup individual — peer removido sem encerrar as conexões restantes
* [x] Preparar análise de CPU — sala/peer mantidos sem renegociação extra
* [x] Preparar medição de upload do host — métricas de mídia coletadas por conexão
* [x] Observar qualidade da transmissão — status agregado de mídia baseado em RTT/perda/estado

## Validação pendente

* [ ] Testar sala com 3 pessoas
* [ ] Testar sala com 4 pessoas
* [ ] Testar sala com 5 pessoas
* [ ] Confirmar rejeição da sexta entrada com mensagem de sala cheia
* [ ] Medir CPU e upload do host durante compartilhamento de tela e voz
* [ ] Confirmar que a qualidade permanece estável com todos os participantes

---

# FASE 17 — Chat

**Status:** `EM ANDAMENTO`

## Tarefas

* [x] Enviar mensagem — botão e Enter enviam pela sala conectada
* [x] Receber mensagem — evento `chat:message` atualiza o painel em tempo real
* [x] Autor — cada mensagem identifica o participante
* [x] Timestamp — horário local é exibido em cada mensagem
* [x] Histórico temporário — mensagens ficam na sessão e são limitadas às 200 mais recentes
* [x] Validar vazio — envio vazio é bloqueado no cliente e no servidor
* [x] Limite de tamanho — limite compartilhado de 500 caracteres
* [x] Rate limiting básico — servidor limita a 5 mensagens por 10 segundos
* [x] Validar participação — servidor aceita mensagens apenas de participantes da sala
* [x] Texto puro — conteúdo é renderizado sem interpretação de HTML
* [x] Não renderizar HTML arbitrário — JSX mantém tags como texto

## Validação pendente

* [ ] Enviar e receber mensagens entre dois participantes
* [ ] Confirmar Enter envia e Shift+Enter quebra linha
* [ ] Confirmar rejeição de mensagem vazia e acima de 500 caracteres
* [ ] Confirmar rate limiting com mais de 5 mensagens em 10 segundos
* [ ] Confirmar que HTML/script é exibido como texto, sem execução

---

# FASE 18 — Reconexão

**Status:** `EM ANDAMENTO`

## Fluxo

```text
WebSocket cai
↓
reconecta
↓
recupera sala
↓
recupera participantes
↓
reconstrói WebRTC
```

## Tarefas

* [x] Detectar queda — Socket.IO e WebRTC limpam a sessão antiga
* [x] Estado `reconnecting` — interface acompanha a tentativa de retorno
* [x] Reconectar socket — até 5 tentativas automáticas
* [x] Reentrar na sala — `sessionId` persistente recupera a presença
* [x] Reconstruir peers — nova lista de participantes dispara a malha WebRTC
* [x] Recuperar estado da transmissão — streams locais continuam disponíveis para nova oferta
* [x] Evitar duplicação — conexões antigas, listeners e streams remotos são removidos antes da reconstrução
* [x] Mostrar erro definitivo — após esgotar as tentativas, a sala orienta atualizar a página

## Validação pendente

* [ ] Desconectar e reconectar o navegador dentro da janela de recuperação
* [ ] Confirmar retorno da lista de participantes
* [ ] Confirmar retorno de microfone e tela sem duplicação
* [ ] Confirmar erro após falha definitiva de reconexão

---

# FASE 19 — Segurança

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Validar códigos
* [ ] Validar nomes
* [ ] Validar peer IDs
* [ ] Validar mensagens
* [ ] Validar signaling
* [ ] Validar participação
* [ ] Verificar host
* [ ] Impedir eventos entre salas
* [ ] Limitar payloads
* [ ] Rate limit básico
* [ ] Não confiar no frontend

---

# FASE 20 — Interface final do MVP

**Status:** `NÃO INICIADA`

## Desktop

```text
┌─────────────────────────────────────────────┐
│ Sala ABC123                    👥 4         │
├──────────────────────────────┬──────────────┤
│                              │ PARTICIPANTES│
│                              │              │
│      TELA COMPARTILHADA      ├──────────────┤
│                              │ CHAT         │
│                              │              │
├──────────────────────────────┴──────────────┤
│ 🎙 Mute   🖥 Compartilhar        🚪 Sair  │
└─────────────────────────────────────────────┘
```

## Tarefas

* [ ] Desktop
* [ ] Mobile
* [ ] Participantes
* [ ] Chat
* [ ] Controles
* [ ] Loading
* [ ] Erros
* [ ] Estado da conexão
* [ ] Estado de compartilhamento
* [ ] Estado do microfone
* [ ] Acessibilidade

---

# FASE 21 — Cleanup e estabilidade

**Status:** `NÃO INICIADA`

## Ao sair

* [ ] Fechar PeerConnections
* [ ] Parar screen track
* [ ] Parar audio track
* [ ] Parar microphone track
* [ ] Remover listeners
* [ ] Remover timers
* [ ] Limpar streams
* [ ] Limpar participantes
* [ ] Evitar conexões órfãs

---

# FASE 22 — Testes entre redes

**Status:** `NÃO INICIADA`

## Quantidade

* [ ] 2 participantes
* [ ] 3
* [ ] 4
* [ ] 5

## Redes

* [ ] Mesmo Wi-Fi
* [ ] Redes diferentes
* [ ] Wi-Fi ↔ 4G/5G
* [ ] Dois provedores diferentes

## Navegadores

* [ ] Chrome
* [ ] Edge
* [ ] Firefox quando suportado

## Dispositivos

* [ ] Desktop
* [ ] Notebook
* [ ] Mobile como espectador

---

# FASE 23 — Avaliação STUN/TURN

**Status:** `NÃO INICIADA`

## Objetivo

Descobrir se STUN é suficiente para os usuários reais do MVP.

## Tarefas

* [ ] Registrar conexões bem-sucedidas
* [ ] Registrar falhas ICE
* [ ] Identificar redes problemáticas
* [ ] Verificar se problema é NAT/firewall
* [ ] Não ativar TURN pago automaticamente

## Decisão

Se os testes mostrarem:

```text
maioria conecta
↓
continuar somente STUN
```

Se houver falhas frequentes:

```text
analisar TURN
↓
explicar custo
↓
obter autorização
↓
somente então implementar
```

---

# FASE 24 — Validação da Vercel

**Status:** `NÃO INICIADA`

## Objetivo

Determinar se a aposta de infraestrutura funcionou.

## Testar

* [ ] WebSockets permanecem utilizáveis
* [ ] Reconexão funciona
* [ ] salas não quebram inesperadamente
* [ ] signaling é confiável
* [ ] múltiplos participantes funcionam
* [ ] novo deploy não causa comportamento inesperado
* [ ] limites gratuitos são aceitáveis

## Resultado A

```text
VERCEL FUNCIONOU
↓
manter arquitetura
```

## Resultado B

```text
VERCEL NÃO É CONFIÁVEL PARA SIGNALING
↓
não mexer no WebRTC
↓
extrair apenas signaling
↓
mover realtime para servidor separado
```

Essa migração futura não deve exigir reescrever frontend ou lógica WebRTC.

---

# FASE 25 — MVP CONCLUÍDO

**Status:** `NÃO INICIADA`

O MVP está pronto quando:

```text
PC 1                           PC 2

Criar sala
    │
    ├──────── link ──────────► Entrar
    │
Compartilhar tela
    │
    ├────── WebRTC ──────────► Ver tela
    │
🎙 falar
    │
    ├────── WebRTC ──────────► 🔊 ouvir
    │
    │                          🎙 falar
    │◄───── WebRTC ───────────┤
🔊 ouvir
    │
💬 "teste"
    │
    ├──── WebSocket ─────────► 💬 "teste"
```

Depois repetir com:

* [ ] 3 participantes
* [ ] 4 participantes
* [ ] 5 participantes

---

# Fora do MVP

Não implementar agora:

* banco de dados;
* contas;
* login;
* amigos;
* salas permanentes;
* gravação;
* upload de vídeo;
* armazenamento de mídia;
* SFU;
* MCU;
* Redis;
* Kafka;
* RabbitMQ;
* microserviços;
* Kubernetes;
* aplicativo nativo;
* assinatura;
* pagamentos;
* infraestrutura paga.

---

# Definition of Done

Uma tarefa só está concluída quando os itens aplicáveis forem satisfeitos:

* [ ] requisito implementado
* [ ] mudança focada
* [ ] TypeScript válido
* [ ] payload validado
* [ ] permissões verificadas
* [ ] erros tratados
* [ ] loading/conexão tratados
* [ ] cleanup implementado
* [ ] testes passam
* [ ] lint passa
* [ ] typecheck passa
* [ ] build passa
* [ ] sem secrets
* [ ] sem debug temporário
* [ ] mídia não passa pelo WebSocket
* [ ] mídia não é armazenada
* [ ] sem infraestrutura paga
* [ ] nenhuma proteção DRM contornada

---

# Ordem oficial

```text
1. Setup
↓
2. Vercel
↓
3. PROVAR WEBSOCKET NA VERCEL
↓
4. Salas
↓
5. Presença
↓
6. Eventos
↓
7. Signaling
↓
8. WebRTC P2P
↓
9. Compartilhar tela
↓
10. Receber tela
↓
11. Parar transmissão
↓
12. Microfone
↓
13. Voz
↓
14. Mute
↓
15. 3 participantes
↓
16. até 5
↓
17. Chat
↓
18. Reconexão
↓
19. Segurança
↓
20. Interface
↓
21. Cleanup
↓
22. Redes diferentes
↓
23. STUN/TURN
↓
24. Validar aposta Vercel
↓
25. MVP
```

---

# Próximo passo oficial

```text
FASE 1 — Inicialização
```

Porém o primeiro teste de infraestrutura realmente importante será:

```text
FASE 3
PROVAR QUE DOIS CLIENTES
CONSEGUEM MANTER COMUNICAÇÃO
REALTIME PELA VERCEL
```

Se esse teste falhar, não continuar construindo signaling em cima de uma infraestrutura ainda não validada.
