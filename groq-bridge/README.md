# Pulse Groq bridge

Vercel proxy so the VPS can transcribe voice notes when Groq blocks the server IP.

Required Vercel env:

- `GROQ_API_KEY`
- `BRIDGE_SECRET`

The chat server calls `POST /api/transcribe` with the same multipart body Groq expects and header `x-bridge-secret`.
