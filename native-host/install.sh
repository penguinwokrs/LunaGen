#!/usr/bin/env bash
# Windows の Chrome に LunaGen の Native Messaging ホストを登録する（WSL から実行）。
#   bash native-host/install.sh          # 登録
#   bash native-host/install.sh --remove # 解除
# 拡張IDは package.json の manifest.key から算出する（unpacked/CRX どちらでも同じID）。
set -euo pipefail

HOST_NAME="com.penguinwokrs.lunagen_claude"
REG_KEY="HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HOST_NAME"
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--remove" ]]; then
  reg.exe delete "$REG_KEY" /f
  exit 0
fi

EXT_ID=$(python3 - <<'PY'
import base64, hashlib, json
key = json.load(open("package.json"))["manifest"]["key"]
h = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in h))
PY
)

WIN_DIR_WIN=$(cmd.exe /c "echo %LOCALAPPDATA%\\LunaGen" 2>/dev/null | tr -d '\r')
WIN_DIR=$(wslpath "$WIN_DIR_WIN")
mkdir -p "$WIN_DIR"

HOST_PY="$(pwd)/native-host/lunagen_claude.py"
DISTRO="${WSL_DISTRO_NAME:?WSL 内で実行してください}"

# Chrome は .bat を直接起動する。stdin/stdout は wsl.exe 経由で Python に素通しされる。
printf '@echo off\r\nwsl.exe -d %s -e python3 "%s"\r\n' "$DISTRO" "$HOST_PY" > "$WIN_DIR/lunagen_claude.bat"

cat > "$WIN_DIR/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "LunaGen: claude -p bridge",
  "path": "lunagen_claude.bat",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

reg.exe add "$REG_KEY" /ve /t REG_SZ /d "$WIN_DIR_WIN\\$HOST_NAME.json" /f
echo "registered: $HOST_NAME -> $WIN_DIR_WIN (extension $EXT_ID)"
