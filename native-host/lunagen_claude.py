#!/usr/bin/env python3
"""LunaGen の Native Messaging ホスト（WSL 側）。

Chrome(Windows) → lunagen_claude.bat → wsl.exe → このスクリプト → `claude -p`。
入出力は Native Messaging の形式（4バイト little-endian の長さ + UTF-8 JSON）。
受信: {"prompt": str, "model"?: str}  返信: {"text": str} または {"error": str}

`claude -p` はログイン済みのサブスク認証で動く。--bare は API キー必須になるので使わない。
CLAUDE.md・MCP・ツールは読ませない（入力が約10万トークン膨らむのを実測で確認済み）。
"""
import json
import os
import shutil
import struct
import subprocess
import sys

SYSTEM_PROMPT = "あなたはメッセージ文面の生成器です。指示された本文だけを出力し、前置き・解説・Markdown装飾・文字数の注記は付けないでください。"
TIMEOUT_SEC = 180


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("<I", raw)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def claude_bin():
    # wsl.exe -e 経由だとログインシェルを通らず PATH に ~/.local/bin が無いことがある
    return shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")


def build_cmd(model):
    return [
        claude_bin(), "-p",
        "--output-format", "json",
        "--model", model,
        "--tools", "",
        "--system-prompt", SYSTEM_PROMPT,
        "--setting-sources", "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]


def generate(req):
    prompt = req.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return {"error": "prompt が空です"}
    model = req.get("model") or "haiku"
    try:
        # cwd を固定してプロジェクトの CLAUDE.md を拾わないようにする
        proc = subprocess.run(
            build_cmd(model), input=prompt, capture_output=True, text=True,
            timeout=TIMEOUT_SEC, cwd=os.path.expanduser("~"),
        )
    except FileNotFoundError:
        return {"error": "WSL 内に claude コマンドが見つかりません"}
    except subprocess.TimeoutExpired:
        return {"error": f"claude が {TIMEOUT_SEC} 秒以内に応答しませんでした"}
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()[:500]}
    if out.get("is_error"):
        return {"error": str(out.get("result") or out.get("subtype") or "claude error")[:500]}
    return {"text": (out.get("result") or "").strip()}


def main():
    req = read_message()
    if req is None:
        return
    try:
        send_message(generate(req))
    except Exception as e:  # ホストが黙って落ちると拡張側は原因不明の切断しか見えない
        send_message({"error": f"host error: {e}"})


if __name__ == "__main__":
    main()
