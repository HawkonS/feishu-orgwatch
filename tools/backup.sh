#!/usr/bin/env bash
# ============================================================
# feishu-orgwatch 备份与恢复
# 用法: ./tools/backup.sh [backup|list|restore <目录>] [--force]
# ============================================================
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${ORGWATCH_WORKSPACE:-$PROJECT_ROOT}"
BACKUP_ROOT="${ORGWATCH_BACKUP_DIR:-$ROOT_DIR/backups}"
DB_FILE="$ROOT_DIR/data/feishu-orgwatch.sqlite"
SECRET_FILE="$ROOT_DIR/data/secret.key"
PROPERTIES_FILE="$PROJECT_ROOT/feishu-orgwatch.properties"
PID_FILE="$ROOT_DIR/.runtime/pids"

usage() {
  cat <<'USAGE'
用法: ./tools/backup.sh <命令>

  backup              备份数据库、配置与加密密钥
  list                列出已有备份
  restore <目录>       从备份恢复（需先停止服务；--force 跳过确认）
USAGE
}

require_stopped() {
  [ -f "$PID_FILE" ] || return 0
  local pid
  pid="$(awk -F= '$1 == "supervisor" {print $2}' "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "服务正在运行（PID $pid），请先执行 ./stop.sh 再恢复。" >&2
    exit 1
  fi
}

backup() {
  if [ ! -f "$DB_FILE" ]; then
    echo "数据库不存在: $DB_FILE（尚未完成首次巡查？）" >&2
    exit 1
  fi
  local target="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$target"
  node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { readonly: true });
    db.prepare("VACUUM INTO ?").run(process.argv[2]);
    db.close();
  ' "$DB_FILE" "$target/feishu-orgwatch.sqlite"
  [ -f "$PROPERTIES_FILE" ] && cp "$PROPERTIES_FILE" "$target/feishu-orgwatch.properties"
  [ -f "$SECRET_FILE" ] && cp "$SECRET_FILE" "$target/secret.key"
  cat > "$target/README.txt" <<'TXT'
恢复时请同时保留 feishu-orgwatch.sqlite、feishu-orgwatch.properties 与 secret.key。
secret.key 丢失后，数据库中保存的飞书 App Secret 将无法解密。
TXT
  chmod 600 "$target"/* 2>/dev/null || true
  echo "已备份到: $target"
}

list() {
  if [ ! -d "$BACKUP_ROOT" ]; then
    echo "还没有备份目录：$BACKUP_ROOT"
    return 0
  fi
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort
}

restore() {
  local source="${1:-}"
  shift || true
  local force=false
  for arg in "$@"; do [ "$arg" = "--force" ] && force=true; done
  if [ -z "$source" ] || [ ! -f "$source/feishu-orgwatch.sqlite" ]; then
    echo "用法: ./tools/backup.sh restore <备份目录>" >&2
    exit 1
  fi
  require_stopped
  if [ "$force" = false ]; then
    read -r -p "将覆盖当前数据库与配置，确认恢复？(y/N) " confirm
    case "$confirm" in y|Y|yes|YES) ;; *) echo "已取消。"; exit 0 ;; esac
  fi
  mkdir -p "$(dirname "$DB_FILE")"
  if [ -f "$DB_FILE" ]; then
    local safety
    safety="$(dirname "$DB_FILE")/pre-restore-$(date +%Y%m%d-%H%M%S).sqlite"
    cp "$DB_FILE" "$safety"
    echo "已保留当前数据库快照: $safety"
  fi
  rm -f "$DB_FILE"-wal "$DB_FILE"-shm
  cp "$source/feishu-orgwatch.sqlite" "$DB_FILE"
  [ -f "$source/feishu-orgwatch.properties" ] && cp "$source/feishu-orgwatch.properties" "$PROPERTIES_FILE"
  [ -f "$source/secret.key" ] && cp "$source/secret.key" "$SECRET_FILE"
  chmod 600 "$SECRET_FILE" 2>/dev/null || true
  echo "恢复完成，请执行 ./run.sh 启动服务。"
}

case "${1:-backup}" in
  backup) backup ;;
  list) list ;;
  restore) shift; restore "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
