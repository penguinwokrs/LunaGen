#!/usr/bin/env bash
# Windows の Chrome に LunaGen の Native Messaging ホストを登録する（WSL から実行）。
# リポジトリからでも、リリースの lunagen-native-host.zip を解凍した場所からでも動く。
#   bash install.sh          # 登録
#   bash install.sh --remove # 解除
# 前提: Windows の Chrome + WSL、WSL 内に Claude Code（claude コマンド）がありログイン済み。
set -euo pipefail

HOST_NAME="com.penguinwokrs.lunagen_claude"
# package.json の manifest.key から決まる固定ID（native-host/install.test.ts で一致を検証）
EXT_ID="dgfbmaalplhmjancpiekkndbifboefmb"
REG_KEY="HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HOST_NAME"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
# 解凍場所やリポジトリを消しても動くよう、ホスト本体は WSL 内の固定場所へコピーする
HOST_DIR="$HOME/.local/share/lunagen"

if [[ -z "${WSL_DISTRO_NAME:-}" ]] || ! command -v reg.exe >/dev/null; then
  echo "WSL 内で実行してください（Windows の Chrome + WSL のみ対応）" >&2
  exit 1
fi

WIN_DIR_WIN=$(cmd.exe /c "echo %LOCALAPPDATA%\\LunaGen" 2>/dev/null | tr -d '\r')
WIN_DIR=$(wslpath "$WIN_DIR_WIN")

if [[ "${1:-}" == "--remove" ]]; then
  reg.exe delete "$REG_KEY" /f || true
  rm -rf "$WIN_DIR" "$HOST_DIR"
  echo "removed: $HOST_NAME"
  exit 0
fi

if ! command -v python3 >/dev/null; then
  echo "WSL 内に python3 がありません（sudo apt install python3）" >&2
  exit 1
fi
# 無くても登録はできる（後から入れれば動く）。生成時にはエラーとして拡張に返る
if ! command -v claude >/dev/null && [[ ! -x "$HOME/.local/bin/claude" ]]; then
  echo "警告: WSL 内に claude コマンドが見つかりません。Claude Code を入れてログインしてから使ってください" >&2
fi

mkdir -p "$HOST_DIR" "$WIN_DIR"
cp "$SRC_DIR/lunagen_claude.py" "$HOST_DIR/lunagen_claude.py"

# Chrome は .bat を直接起動する。stdin/stdout は wsl.exe 経由で Python に素通しされる。
printf '@echo off\r\nwsl.exe -d %s -e python3 "%s"\r\n' "$WSL_DISTRO_NAME" "$HOST_DIR/lunagen_claude.py" > "$WIN_DIR/lunagen_claude.bat"

cat > "$WIN_DIR/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "LunaGen: claude -p bridge",
  "path": "lunagen_claude.bat",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

reg.exe add "$REG_KEY" /ve /t REG_SZ /d "$WIN_DIR_WIN\\$HOST_NAME.json" /f >/dev/null
echo "registered: $HOST_NAME -> $WIN_DIR_WIN (extension $EXT_ID)"
echo "Chrome の設定画面で「Claude Code」カードの「接続をテストする」を押して確認してください"
