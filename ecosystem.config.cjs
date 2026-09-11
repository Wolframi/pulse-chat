const fs = require("fs");
const path = require("path");

function readSecret(filename) {
  try {
    return fs
      .readFileSync(path.join(__dirname, filename), "utf8")
      .replace(/\r/g, "")
      .trim();
  } catch {
    return "";
  }
}

const giphyKey = readSecret(".giphy-api-key");
const groqKey = readSecret(".groq-api-key");
const groqProxyUrl = readSecret(".groq-proxy-url");
const groqBridgeSecret = readSecret(".groq-bridge-secret");
const groqEgressProxy = readSecret(".groq-egress-proxy");

module.exports = {
  apps: [
    {
      name: "pulse-chat",
      cwd: "/root/pulse-chat",
      script: "npx",
      args: "tsx server.ts",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: "3000",
        PUBLIC_ORIGIN: "https://193.233.247.171.sslip.io",
        TURN_HOST: "193.233.247.171",
        SEED_DEMO: "0",
        NEXT_PUBLIC_DEMO: "0",
        TRUST_PROXY: "1",
        UV_THREADPOOL_SIZE: "8",
        ...(giphyKey ? { GIPHY_API_KEY: giphyKey } : {}),
        ...(groqKey ? { GROQ_API_KEY: groqKey } : {}),
        ...(groqProxyUrl ? { GROQ_PROXY_URL: groqProxyUrl } : {}),
        ...(groqBridgeSecret ? { GROQ_BRIDGE_SECRET: groqBridgeSecret } : {}),
        ...(groqEgressProxy ? { GROQ_EGRESS_PROXY: groqEgressProxy } : {}),
      },
    },
  ],
};
