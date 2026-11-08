#!/usr/bin/env bash
# 重启 feishu-orgwatch：优先 systemd，其次 run.sh/stop.sh。
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="feishu-orgwatch"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  sudo systemctl restart "$SERVICE_NAME"
  systemctl is-active --quiet "$SERVICE_NAME" && echo "${SERVICE_NAME} 已重启。" || {
    echo "重启失败，请查看 journalctl -u ${SERVICE_NAME}" >&2
    exit 1
  }
  exit 0
fi

bash "$PROJECT_ROOT/stop.sh" || true
sleep 1
nohup bash "$PROJECT_ROOT/run.sh" --no-build >/dev/null 2>&1 < /dev/null &
echo "已在后台重启（日志见 data/logs）。"
