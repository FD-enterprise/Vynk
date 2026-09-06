This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## WebRTC entre redes diferentes

O frontend usa STUN por padrão. Para habilitar o relay TURN da Cloudflare, configure no ambiente do servidor de signaling (Render):

```bash
CLOUDFLARE_TURN_API_TOKEN=seu-token
CLOUDFLARE_TURN_KEY_ID=seu-key-id
```

O servidor gera credenciais TURN temporárias pela API da Cloudflare e as entrega ao navegador em `GET /turn`. O token da API nunca é enviado ao cliente.

Sem essas duas variáveis, o Vynk mantém somente STUN. O frontend também usa STUN como fallback se o endpoint TURN estiver indisponível.

Para diagnosticar um provedor TURN, configure temporariamente `NEXT_PUBLIC_FORCE_TURN=true`. Isso força o uso do relay e consome a franquia mesmo quando uma conexão direta seria possível; remova ou desative a variável após o teste.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
