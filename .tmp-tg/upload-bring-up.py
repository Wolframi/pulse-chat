import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

local = os.path.join(os.path.dirname(__file__), "remote-bring-up.sh")
body = open(local, "r", encoding="utf-8").read().replace("\r\n", "\n")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "193.233.247.171",
    username="root",
    password=os.environ["PULSE_SSH_PASS"],
    look_for_keys=False,
    allow_agent=False,
    timeout=25,
    banner_timeout=25,
    auth_timeout=25,
)
tr = c.get_transport()
if tr:
    tr.set_keepalive(10)

sftp = c.open_sftp()
with sftp.file("/root/remote-bring-up.sh", "w") as f:
    f.write(body)
sftp.chmod("/root/remote-bring-up.sh", 0o755)
sftp.close()
print("uploaded /root/remote-bring-up.sh", flush=True)

_stdin, stdout, stderr = c.exec_command("bash /root/remote-bring-up.sh", timeout=480)
chan = stdout.channel
started = time.time()
timeout = 480
while True:
    if time.time() - started > timeout:
        print("TIMEOUT", flush=True)
        sys.exit(124)
    if chan.recv_ready():
        sys.stdout.write(chan.recv(8192).decode("utf-8", "replace"))
        sys.stdout.flush()
    if chan.recv_stderr_ready():
        sys.stdout.write(chan.recv_stderr(8192).decode("utf-8", "replace"))
        sys.stdout.flush()
    if chan.exit_status_ready():
        while chan.recv_ready():
            sys.stdout.write(chan.recv(8192).decode("utf-8", "replace"))
        while chan.recv_stderr_ready():
            sys.stdout.write(chan.recv_stderr(8192).decode("utf-8", "replace"))
        leftover = stdout.read().decode("utf-8", "replace")
        leftover_err = stderr.read().decode("utf-8", "replace")
        if leftover:
            sys.stdout.write(leftover)
        if leftover_err:
            sys.stdout.write(leftover_err)
        sys.stdout.flush()
        code = chan.recv_exit_status()
        print("\nexit", code, flush=True)
        c.close()
        sys.exit(code)
    time.sleep(0.12)
