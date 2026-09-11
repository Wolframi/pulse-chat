const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "pulse-groq-bridge" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = String(process.env.BRIDGE_SECRET || "").trim();
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  const provided = String(req.headers["x-bridge-secret"] || "").trim();
  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!groqKey) {
    res.status(500).json({ error: "GROQ_API_KEY is not configured" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }

  let body;
  try {
    body = await readRawBody(req);
  } catch {
    res.status(400).json({ error: "Failed to read body" });
    return;
  }
  if (!body.byteLength) {
    res.status(400).json({ error: "Empty body" });
    return;
  }
  if (body.byteLength > 4.5 * 1024 * 1024) {
    res.status(413).json({ error: "Audio too large for the bridge" });
    return;
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": contentType,
        "User-Agent": "pulse-groq-bridge",
      },
      body,
    });
    const text = await groqRes.text();
    res.status(groqRes.status);
    const groqType = groqRes.headers.get("content-type") || "application/json";
    res.setHeader("content-type", groqType);
    res.send(text);
  } catch (error) {
    res.status(502).json({
      error: "Groq bridge failed",
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}
