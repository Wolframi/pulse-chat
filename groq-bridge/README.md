# Pulse Groq bridge

The VPS is blocked by Groq. Send transcription through a Cloudflare Worker or Vercel.

## Cloudflare Worker (preferred)

Paste `cloudflare-worker.js` into the worker at `dawn-mode-f3f.polynskijartem.workers.dev`.

It must proxy to `https://api.groq.com`, not `https://groq.com`.

On the chat server:

- `.groq-api-key` — Groq key
- `.groq-proxy-url` — `https://dawn-mode-f3f.polynskijartem.workers.dev`

## Vercel

Required env: `GROQ_API_KEY`, `BRIDGE_SECRET`.

The chat server calls `POST /api/transcribe` with `x-bridge-secret`.
