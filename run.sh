#!/usr/bin/env bash
# ============================================================
# feishu-orgwatch 一键启动脚本
#
# 默认构建并启动生产服务（API + 前端静态资源同端口）。
# --dev 启动 tsx watch 与 Vite 开发服务器。
# ============================================================
set -Eeuo pipefail
umask 077

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ORGWATCH_WORKSPACE:-$CODE_DIR}"
export ORGWATCH_WORKSPACE="$ROOT_DIR"
cd "$CODE_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/pids"
MODE="production"
SKIP_BUILD=false
DEV_WEB_PORT="${ORGWATCH_WEB_PORT:-5173}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { printf '%b\n' "${GREEN}[feishu-orgwatch]${NC} $*"; }
log_warn() { printf '%b\n' "${YELLOW}[feishu-orgwatch]${NC} $*"; }
log_error() { printf '%b\n' "${RED}[feishu-orgwatch]${NC} $*" >&2; }

for arg in "$@"; do
  case "$arg" in
    --dev) MODE="development" ;;
    --no-build) SKIP_BUILD=true ;;
    --help|-h)
      cat <<'EOF'
用法: ./run.sh [--dev|--no-build]

  默认       构建并启动生产服务
  --dev      启动后端 watch 与 Vite 开发服务器
  --no-build 使用已构建的生产产物

首次启动会生成 feishu-orgwatch.properties、data/ 与 .runtime/，
并自动创建默认管理员 hawkon；随机初始密码见 .runtime/default-admin.txt，请登录后立即修改。
EOF
      exit 0
      ;;
    *) log_error "未知参数: $arg"; exit 2 ;;
  esac
done

if [ "${ORGWATCH_DEV:-0}" = "1" ]; then
  MODE="development"
fi

if ! command -v node >/dev/null 2>&1; then
  log_error "未找到 Node.js，请安装 Node.js 22.12 或更高版本。"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  log_error "未找到 npm。"
  exit 1
fi

if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||major===22&&minor>=12?0:1)'; then
  log_error "Node.js 版本过低: $(node --version)，需要 22.12 或更高版本。"
  exit 1
fi

if [ ! -d "$CODE_DIR/node_modules" ]; then
  log_info "正在安装依赖（首次启动可能需要几分钟）..."
  npm ci --include=dev
fi

if ! node -e 'require("better-sqlite3")' >/dev/null 2>&1; then
  log_error "当前 Node.js 无法加载 better-sqlite3（原生模块与 Node 版本不匹配）。"
  log_error "请使用启动服务时的 Node 版本，或执行: npm rebuild better-sqlite3"
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
if [ -f "$PID_FILE" ]; then
  existing="$(awk -F= '$1 == "supervisor" {print $2}' "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
    log_error "feishu-orgwatch 已经在运行 (PID: $existing)，请先执行 ./stop.sh。"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

log_info "正在检查配置..."
CONFIG_JSON="$(node "$CODE_DIR/tools/configure.mjs")"
json_value() {
  CONFIG_JSON="$CONFIG_JSON" node -e 'process.stdout.write(String(JSON.parse(process.env.CONFIG_JSON)[process.argv[1]] ?? ""))' "$1"
}
APP_HOST="$(json_value host)"
APP_PORT="$(json_value port)"
LOG_DIR="$(json_value logDir)"
SITE_NAME="$(json_value siteName)"
mkdir -p "$LOG_DIR"

if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || [ "$APP_PORT" -lt 1 ] || [ "$APP_PORT" -gt 65535 ]; then
  log_error "配置中的应用端口无效: $APP_PORT"
  exit 1
fi

if [ "$MODE" = "production" ]; then
  export NODE_ENV=production
  if [ "$SKIP_BUILD" = false ]; then
    log_info "正在构建生产产物..."
    npm run build
  fi
  if [ ! -f "$CODE_DIR/apps/server/dist/main.js" ] || [ ! -f "$CODE_DIR/apps/web/dist/index.html" ]; then
    log_error "缺少生产产物，请先执行 npm run build（或去掉 --no-build）。"
    exit 1
  fi
  server_command=(node "$CODE_DIR/apps/server/dist/main.js")
  web_command=()
else
  export NODE_ENV=development
  server_command=(node "$CODE_DIR/node_modules/tsx/dist/cli.mjs" watch --tsconfig "$CODE_DIR/apps/server/tsconfig.json" "$CODE_DIR/apps/server/src/main.ts")
  web_command=(node "$CODE_DIR/node_modules/vite/bin/vite.js" "$CODE_DIR/apps/web" --host 0.0.0.0 --port "$DEV_WEB_PORT" --strictPort)
fi

server_pid=""
web_pid=""
stopping="false"

write_pid_file() {
  cat > "$PID_FILE" <<EOF
supervisor=$$
server=${server_pid:-}
web=${web_pid:-}
mode=$MODE
EOF
}

is_running() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

stop_child() {
  local pid="${1:-}"
  [ -z "$pid" ] || ! is_running "$pid" && return 0
  kill -TERM "$pid" 2>/dev/null || true
}

wait_child() {
  local pid="${1:-}" i
  [ -z "$pid" ] && return 0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    is_running "$pid" || return 0
    sleep 1
  done
  is_running "$pid" && kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  [ "$stopping" = "true" ] && return 0
  stopping="true"
  stop_child "$server_pid"
  stop_child "$web_pid"
  wait_child "$server_pid"
  wait_child "$web_pid"
  rm -f "$PID_FILE"
}

on_signal() { cleanup; exit 0; }

trap cleanup EXIT
trap on_signal INT TERM HUP

log_info "启动模式: $MODE"
log_info "日志目录: $LOG_DIR"

(exec "${server_command[@]}" >> "$LOG_DIR/server.log" 2>&1) &
server_pid=$!
if [ "${#web_command[@]}" -gt 0 ]; then
  (exec "${web_command[@]}" >> "$LOG_DIR/web.log" 2>&1) &
  web_pid=$!
fi
write_pid_file

if [ "$MODE" = "production" ]; then
  log_info "等待服务就绪..."
  if ! node -e '
    const url = process.argv[1];
    let attempts = 0;
    const tick = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) process.exit(0);
      } catch {}
      if (++attempts > 80) process.exit(1);
      setTimeout(tick, 500);
    };
    tick();
  ' "http://127.0.0.1:${APP_PORT}/api/health"; then
    log_error "服务启动失败，请查看 $LOG_DIR/server.log"
    exit 1
  fi
fi

if [ "$MODE" = "production" ]; then
  log_info "服务地址: http://127.0.0.1:${APP_PORT}"
else
  log_info "后端 API: http://127.0.0.1:${APP_PORT}"
  log_info "前端开发: http://127.0.0.1:${DEV_WEB_PORT}"
fi
if [ -f "$ROOT_DIR/.runtime/default-admin.txt" ]; then
  log_info "默认管理员初始密码: $ROOT_DIR/.runtime/default-admin.txt"
fi
log_info "日志: $LOG_DIR"
log_info "按 Ctrl+C 停止服务。"

while true; do
  if ! is_running "$server_pid" || { [ -n "$web_pid" ] && ! is_running "$web_pid"; }; then
    log_error "子服务异常退出，请查看 $LOG_DIR。"
    exit 1
  fi
  sleep 2
done
