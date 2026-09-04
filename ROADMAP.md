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

**Status:** `EM ANDAMENTO`

## Objetivo

Validar WebSocket antes de desenvolver o restante do sistema.

Esta fase é obrigatória.

## Tarefas

* [ ] Criar conexão WebSocket mínima
* [ ] Abrir conexão pelo navegador
* [ ] Receber evento do servidor
* [ ] Enviar evento ao servidor
* [ ] Manter duas abas conectadas
* [ ] Testar dois computadores
* [ ] Testar conexão durante alguns minutos
* [ ] Testar reconexão
* [ ] Testar após novo deploy
* [ ] Observar possíveis encerramentos da conexão
* [ ] Registrar limitações encontradas

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

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Criar tipo `Room`
* [ ] Gerar código aleatório
* [ ] Não utilizar IDs públicos sequenciais
* [ ] Criar sala
* [ ] Entrar por código
* [ ] Entrar por link
* [ ] Solicitar nome temporário
* [ ] Identificar host
* [ ] Validar código
* [ ] Validar nome
* [ ] Tratar sala inexistente
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

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Manter participantes da sala
* [ ] Atualizar lista em tempo real
* [ ] Mostrar host
* [ ] Mostrar quantidade
* [ ] Estado `online`
* [ ] Estado `reconnecting`
* [ ] Estado `offline`
* [ ] Detectar fechamento da aba
* [ ] Remover participante desconectado
* [ ] Evitar participante fantasma
* [ ] Evitar participantes duplicados

---

# FASE 6 — Eventos compartilhados

**Status:** `NÃO INICIADA`

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

* [ ] Centralizar nomes
* [ ] Criar tipos TypeScript
* [ ] Validar payloads
* [ ] Não espalhar strings arbitrárias pelo projeto
* [ ] Validar participação antes de encaminhar eventos

---

# FASE 7 — Signaling WebRTC

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Criar `RTCPeerConnection`
* [ ] Configurar STUN
* [ ] Criar offer
* [ ] Enviar offer por WebSocket
* [ ] Receber offer
* [ ] Criar answer
* [ ] Enviar answer
* [ ] Receber answer
* [ ] Enviar ICE candidate
* [ ] Receber ICE candidate
* [ ] Validar `peerId`
* [ ] Impedir signaling entre salas diferentes

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

**Status:** `NÃO INICIADA`

## Objetivo

Conectar somente dois participantes.

## Tarefas

* [ ] PC A cria sala
* [ ] PC B entra
* [ ] Criar conexão
* [ ] Confirmar ICE
* [ ] Confirmar `connected`
* [ ] Tratar `connecting`
* [ ] Tratar `disconnected`
* [ ] Tratar `failed`
* [ ] Fechar conexão ao sair

## Marco

```text
PC A ←════════ WebRTC ════════→ PC B
```

---

# FASE 9 — Compartilhamento de tela

**Status:** `NÃO INICIADA`

## API

```ts
navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,
});
```

## Tarefas

* [ ] Criar botão compartilhar
* [ ] Solicitar permissão
* [ ] Capturar tela
* [ ] Separar vídeo
* [ ] Detectar áudio quando disponível
* [ ] Adicionar tracks
* [ ] Mostrar preview local
* [ ] Tratar permissão negada
* [ ] Funcionar sem áudio da tela

---

# FASE 10 — Recepção da tela

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Receber track de vídeo
* [ ] Criar stream remoto
* [ ] Renderizar stream
* [ ] Receber áudio quando disponível
* [ ] Limpar stream ao terminar

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

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Botão parar
* [ ] Implementar `track.onended`
* [ ] Executar `track.stop()`
* [ ] Remover/substituir track
* [ ] Atualizar estado local
* [ ] Informar participantes
* [ ] Limpar player
* [ ] Evitar imagem congelada

---

# FASE 12 — Microfone

**Status:** `NÃO INICIADA`

## API

```ts
navigator.mediaDevices.getUserMedia({
  audio: true,
});
```

## Tarefas

* [ ] Solicitar microfone
* [ ] Capturar track
* [ ] Adicionar ao peer
* [ ] Mostrar estado
* [ ] Tratar permissão negada
* [ ] Tratar dispositivo inexistente
* [ ] Parar track no cleanup

---

# FASE 13 — Voz bidirecional

**Status:** `NÃO INICIADA`

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

* [ ] Envio A → B
* [ ] Envio B → A
* [ ] Reproduzir áudio remoto
* [ ] Evitar áudio duplicado
* [ ] Tratar saída de participante

---

# FASE 14 — Mute / Unmute

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Mutar
* [ ] Desmutar
* [ ] Mostrar estado local
* [ ] Mostrar estado remoto
* [ ] Sincronizar via WebSocket
* [ ] Recuperar estado após reconexão

---

# FASE 15 — Terceiro participante

**Status:** `NÃO INICIADA`

## Objetivo

Migrar de uma conexão única para coleção de peers.

## Tarefas

* [ ] Estrutura `Map<peerId, RTCPeerConnection>`
* [ ] Criar conexão por participante
* [ ] Remover conexão ao sair
* [ ] Evitar peer duplicado
* [ ] Compartilhar tela do host para todos
* [ ] Compartilhar voz

---

# FASE 16 — Até cinco participantes

**Status:** `NÃO INICIADA`

## Testes

* [ ] 3 pessoas
* [ ] 4 pessoas
* [ ] 5 pessoas

## Tarefas

* [ ] Limite máximo
* [ ] Mensagem de sala cheia
* [ ] Cleanup individual
* [ ] Testar CPU
* [ ] Testar consumo de upload do host
* [ ] Observar qualidade da transmissão

---

# FASE 17 — Chat

**Status:** `NÃO INICIADA`

## Tarefas

* [ ] Enviar mensagem
* [ ] Receber mensagem
* [ ] Autor
* [ ] Timestamp
* [ ] Histórico temporário
* [ ] Validar vazio
* [ ] Limite de tamanho
* [ ] Rate limiting básico
* [ ] Validar participação
* [ ] Texto puro
* [ ] Não renderizar HTML arbitrário

---

# FASE 18 — Reconexão

**Status:** `NÃO INICIADA`

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

* [ ] Detectar queda
* [ ] Estado `reconnecting`
* [ ] Reconectar socket
* [ ] Reentrar na sala
* [ ] Reconstruir peers
* [ ] Recuperar estado da transmissão
* [ ] Evitar duplicação
* [ ] Mostrar erro definitivo

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
