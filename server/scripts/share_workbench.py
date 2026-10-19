"""Start/stop an invitation-only temporary HTTPS workbench without publishing admin routes."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATE = DATA / "temp-share-state.json"
CONFIG = DATA / "temp-share-config.json"
LINK = ROOT / "临时工作台网址.txt"


def private_text(path, text):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)
    path.chmod(0o600)


def process_identity(pid):
    try:
        value = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=,command="], capture_output=True,
                               text=True, check=False).stdout.strip()
        return value or None
    except OSError:
        return None


def alive(entry):
    return entry and process_identity(entry["pid"]) == entry["identity"]


def stop():
    if STATE.exists():
        state = json.loads(STATE.read_text(encoding="utf-8"))
        for entry in reversed(state.get("processes", [])):
            if alive(entry):
                os.killpg(entry["pid"], signal.SIGTERM)
        STATE.unlink(missing_ok=True)
    CONFIG.unlink(missing_ok=True)
    if LINK.exists():
        private_text(LINK, "临时分享已经停止。双击“开启临时分享.command”可生成新的网址。\n")
    print("临时分享已经停止；本机工作台继续运行。")


def spawn(command, log_name, env=None):
    path = DATA / log_name
    with path.open("wb") as log:
        path.chmod(0o600)
        child = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True, env=env)
    identity = process_identity(child.pid)
    if not identity:
        raise RuntimeError("分享进程未能启动，请检查 " + log_name)
    return {"pid": child.pid, "identity": identity}


def tunnel_domain(text):
    # Only use a successful forwarding event, never links in the service's welcome banner.
    for line in reversed(text.splitlines()):
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict) or event.get("type") != "v1.tcpip_forward.register.accepted":
            continue
        match = re.search(r"https://([a-zA-Z0-9-]+\.(?:lhr\.life|localhost\.run))", str(event.get("data", "")))
        if match and match[1] not in ("admin.localhost.run", "www.localhost.run"):
            return match[1]
    return None


def start():
    DATA.mkdir(exist_ok=True)
    with httpx.Client(trust_env=False, timeout=5) as client:
        try:
            response = client.get("http://127.0.0.1:8000/health")
            response.raise_for_status()
        except httpx.HTTPError:
            subprocess.run([sys.executable, "scripts/bootstrap.py"], cwd=ROOT, check=True)
            subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, check=True)
            subprocess.run([sys.executable, "scripts/run_local_background.py"], cwd=ROOT, check=True)
        if STATE.exists():
            previous = json.loads(STATE.read_text(encoding="utf-8"))
            if previous.get("url") and previous.get("expires_at", 0) > time.time() and all(
                    alive(entry) for entry in previous.get("processes", [])):
                print("临时分享正在运行：\n" + previous["url"])
                return
            stop()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        invitation = secrets.token_urlsafe(32)
        expiry = time.time() + 24 * 3600
        private_text(CONFIG, json.dumps({"invitation": invitation, "expires_at": expiry}))
        state = {"processes": [], "expires_at": expiry}
        try:
            env = {**os.environ, "POTTERY_SHARE_CONFIG": str(CONFIG)}
            state["processes"].append(spawn([sys.executable, "-m", "uvicorn", "app.share_gateway:create_gateway",
                "--factory", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], "temp-share-gateway.log", env))
            private_text(STATE, json.dumps(state))
            for _ in range(60):
                try:
                    if client.get("http://127.0.0.1:" + str(port) + "/share-health").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(.2)
            else:
                raise RuntimeError("工作台分享入口没有启动，请检查 data/temp-share-gateway.log。")
            command = ["/usr/bin/ssh", "-F", "/dev/null", "-T", "-o", "BatchMode=yes",
                "-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes", "-o", "IdentityFile=none",
                "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=" + str(DATA / "temp-share-known-hosts"),
                "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
                "-o", "ExitOnForwardFailure=yes", "-R", "80:127.0.0.1:" + str(port),
                "nokey@localhost.run", "--", "--output", "json"]
            state["processes"].append(spawn(command, "temp-share-tunnel.log"))
            private_text(STATE, json.dumps(state))
            print("正在获取临时 HTTPS 网址……", flush=True)
            domain = None
            for _ in range(150):
                text = (DATA / "temp-share-tunnel.log").read_text(encoding="utf-8", errors="replace")
                domain = tunnel_domain(text)
                if domain:
                    break
                if not alive(state["processes"][-1]):
                    raise RuntimeError("临时网址连接失败，请检查 data/temp-share-tunnel.log。")
                time.sleep(.2)
            if not domain:
                raise RuntimeError("未收到临时网址，请检查 data/temp-share-tunnel.log。")
            url = "https://" + domain + "/?invite=" + invitation
            state["url"] = url
            private_text(STATE, json.dumps(state))
            private_text(LINK, "将下面的完整网址发给对方：\n\n" + url + "\n\n电脑需要保持开机、联网。关闭分享请双击“停止临时分享.command”。\n"
                         + "本次分享入口有效至：" + datetime.fromtimestamp(expiry).strftime("%Y-%m-%d %H:%M") + "（本机时间）。\n"
                         + "AI 和声音使用本机后台已有配置，对应请求会使用你的 API 额度。\n")
            print("临时网址已经生成：\n" + url + "\n也已保存到“临时工作台网址.txt”。")
        except BaseException:
            private_text(STATE, json.dumps(state))
            stop()
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("start", "stop"))
    args = parser.parse_args()
    os.chdir(ROOT)
    try:
        return start() if args.action == "start" else stop()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
