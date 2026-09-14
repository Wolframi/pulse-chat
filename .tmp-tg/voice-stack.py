import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "193.233.247.171",
    username="root",
    password=os.environ["PULSE_SSH_PASS"],
    look_for_keys=False,
    allow_agent=False,
    timeout=25,
)
_stdin, stdout, stderr = c.exec_command(
    "livekit-server --version; "
    "echo ---; systemctl is-active livekit; "
    "echo ---; turnserver -V 2>&1 | head -n 3; "
    "echo ---; curl -sS -m 5 http://127.0.0.1:3000/api/health/livekit; echo; "
    "echo ---; sed -n '1,20p' /root/pulse-chat/.livekit-server.yaml",
    timeout=20,
)
sys.stdout.write(stdout.read().decode("utf-8", "replace"))
sys.stdout.write(stderr.read().decode("utf-8", "replace"))
c.close()
