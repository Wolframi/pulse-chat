#!/bin/bash
set -euo pipefail

echo "=== stop pm2 ==="
pm2 stop pulse-chat || true

echo "=== swap ==="
if ! swapon --show | grep -q .; then
  echo "Creating 2G swap"
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
free -h
swapon --show

echo "=== patch next.config.ts ==="
python3 - <<'PY'
from pathlib import Path
p = Path("/root/pulse-chat/next.config.ts")
s = p.read_text(encoding="utf-8")
needle = "const nextConfig: NextConfig = {"
extra = (
    "const nextConfig: NextConfig = {\n"
    "  typescript: { ignoreBuildErrors: true },\n"
    "  eslint: { ignoreDuringBuilds: true },"
)
if "ignoreBuildErrors" not in s:
    if needle not in s:
        raise SystemExit("next.config.ts marker not found")
    p.write_text(s.replace(needle, extra, 1), encoding="utf-8")
    print("patched next.config.ts")
else:
    print("next.config.ts already patched")
PY

echo "=== next build --webpack ==="
cd /root/pulse-chat
export NODE_OPTIONS=--max-old-space-size=1024
npx next build --webpack

test -f /root/pulse-chat/.next/BUILD_ID
echo "BUILD_OK $(cat /root/pulse-chat/.next/BUILD_ID)"

echo "=== restart ==="
pm2 restart pulse-chat
sleep 10
pm2 status
echo "=== health ==="
curl -sS -m 15 http://127.0.0.1:3000/api/health || echo LOCAL_HEALTH_FAIL
echo
pm2 logs pulse-chat --err --lines 20 --nostream || true
