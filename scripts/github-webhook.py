#!/usr/bin/env python3
"""Accept GitHub push webhooks and refresh Pulse Chat from master."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET_FILE = os.environ.get("PULSE_WEBHOOK_SECRET_FILE", "/root/.pulse-github-webhook-secret")
UPDATE_SCRIPT = os.environ.get("PULSE_AUTO_UPDATE", "/usr/local/sbin/pulse-auto-update.sh")
HOST = os.environ.get("PULSE_WEBHOOK_HOST", "127.0.0.1")
PORT = int(os.environ.get("PULSE_WEBHOOK_PORT", "9099"))
PATH = "/hooks/github-deploy"


def secret() -> bytes:
    with open(SECRET_FILE, "r", encoding="utf-8") as fh:
        return fh.read().strip().encode("utf-8")


def valid_sig(body: bytes, header: str) -> bool:
    if not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def deploy() -> None:
    subprocess.call(["/bin/bash", UPDATE_SCRIPT])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.log_date_time_string()} {fmt % args}")

    def _send(self, code: int, body: bytes = b"ok") -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != PATH:
            self._send(404, b"not found")
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 2_000_000:
            self._send(413, b"too large")
            return
        body = self.rfile.read(length)
        sig = self.headers.get("X-Hub-Signature-256", "")
        try:
            if not valid_sig(body, sig):
                self._send(403, b"bad signature")
                return
        except OSError:
            self._send(500, b"secret missing")
            return
        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            self._send(200, b"pong")
            return
        if event != "push":
            self._send(204, b"")
            return
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b"invalid json")
            return
        if payload.get("ref") != "refs/heads/master":
            self._send(202, b"ignored")
            return
        threading.Thread(target=deploy, daemon=True).start()
        self._send(202, b"deploying")


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on {HOST}:{PORT}{PATH}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
