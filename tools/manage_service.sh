#!/usr/bin/env bash
# ============================================================
# feishu-orgwatch systemd 服务管理
# 用法: ./tools/manage_service.sh [install|start|stop|restart|status|logs|enable|disable|backup|upgrade]
# 不带参数时进入交互菜单。
# ============================================================
set -Eeuo pipefail

SERVICE_NAME="feishu-orgwatch"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_SCRIPT="${PROJECT_ROOT}/run.sh"
CURRENT_USER="${SUDO_USER:-$USER}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
用法: ./tools/manage_service.sh <命令>

  install    安装并启动 systemd 服务（需要 sudo）
  start      启动服务
  stop       停止服务
  restart    重启服务
  status     查看服务状态
  logs       持续查看日志（Ctrl+C 退出）
  enable     设置开机自启
  disable    取消开机自启
  backup     备份 SQLite 数据库、配置与加密密钥
  upgrade    拉取远程更新并重启
  menu        交互菜单（默认）

不带参数时进入交互菜单。
USAGE
}

require_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo -e "${RED}未找到 systemctl，此脚本仅适用于使用 systemd 的 Linux。${NC}" >&2
    echo "其他环境请直接使用 ./run.sh 与 ./stop.sh，或 Docker Compose。" >&2
    exit 1
  fi
}

is_installed() { [ -f "$SERVICE_FILE" ]; }

install_service() {
  require_systemd
  echo -e "${BLUE}正在安装 systemd 服务 ${SERVICE_NAME}...${NC}"
  sudo -v

  local unit
  unit="[Unit]
Description=feishu-orgwatch - Feishu organization watch
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${RUN_SCRIPT} --no-build
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"

  echo "$unit" | sudo tee "$SERVICE_FILE" >/dev/null
  sudo chmod +x "$RUN_SCRIPT" 2>/dev/null || true
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}服务已安装并启动。${NC}"
    echo "查看日志: journalctl -u ${SERVICE_NAME} -f"
  else
    echo -e "${RED}服务安装后启动失败，最近日志：${NC}"
    sudo journalctl -u "$SERVICE_NAME" -n 30 --no-pager || true
    exit 1
  fi
}

service_action() {
  require_systemd
  local action="$1"
  if [ "$action" != "status" ] && [ "$action" != "logs" ] && ! is_installed; then
    echo -e "${YELLOW}服务尚未安装，先执行 install。${NC}"
    install_service
    return 0
  fi
  case "$action" in
    start|stop|restart|enable|disable)
      sudo -v
      sudo systemctl "$action" "$SERVICE_NAME"
      ;;
    status)
      sudo systemctl status "$SERVICE_NAME" --no-pager || true
      ;;
    logs)
      sudo journalctl -u "$SERVICE_NAME" -f
      ;;
  esac
}

menu() {
  require_systemd
  while true; do
    echo
    if is_installed && systemctl is-active --quiet "$SERVICE_NAME"; then
      echo -e "状态: ${GREEN}运行中${NC} · ${SERVICE_NAME}"
    else
      echo -e "状态: ${RED}未运行${NC} · ${SERVICE_NAME}"
    fi
    cat <<'MENU'
1) 安装/重装服务
2) 启动
3) 停止
4) 重启
5) 查看状态
6) 查看日志
7) 开机自启
8) 取消自启
9) 备份
10) 升级
0) 退出
MENU
    read -r -p "> " choice
    case "$choice" in
      1) install_service ;;
      2) service_action start ;;
      3) service_action stop ;;
      4) service_action restart ;;
      5) service_action status ;;
      6) service_action logs ;;
      7) service_action enable ;;
      8) service_action disable ;;
      9) bash "$PROJECT_ROOT/tools/backup.sh" backup ;;
      10) bash "$PROJECT_ROOT/tools/update.sh" ;;
      0) exit 0 ;;
      *) echo "无效选项" ;;
    esac
  done
}

case "${1:-menu}" in
  install) install_service ;;
  start|stop|restart|status|logs|enable|disable) service_action "${1}" ;;
  backup) bash "$PROJECT_ROOT/tools/backup.sh" backup ;;
  upgrade) bash "$PROJECT_ROOT/tools/update.sh" ;;
  menu) menu ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
