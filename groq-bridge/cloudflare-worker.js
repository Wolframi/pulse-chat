const GROQ_API = "https://api.groq.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ ok: true, service: "pulse-groq-bridge" });
    }

    if (!url.pathname.startsWith("/openai/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const target = new URL(url.pathname + url.search, GROQ_API);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.set("User-Agent", "pulse-groq-bridge");

    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
    });
  },
};
