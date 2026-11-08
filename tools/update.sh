#!/usr/bin/env bash
# ============================================================
# feishu-orgwatch 升级脚本
# 拉取 origin/main，确认后应用、构建并重启服务。
# 前端「系统更新」通过 --yes 调用，并读取同一份状态和日志。
# ============================================================
set -Eeuo pipefail
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=true

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

SERVICE_NAME="feishu-orgwatch"
SKIP_CONFIRM=false
FORCE=false
REMOTE_URL="${ORGWATCH_REMOTE_URL:-}"
BRANCH="${ORGWATCH_BRANCH:-main}"
STATE_FILE="${ORGWATCH_UPDATE_STATE_FILE:-$PROJECT_ROOT/.runtime/update-state.json}"
LOG_DIR="${ORGWATCH_UPDATE_LOG_DIR:-$PROJECT_ROOT/.runtime/logs}"
JOB_ID="${ORGWATCH_UPDATE_JOB_ID:-manual-$(date +%s)}"
STARTED_AT="${ORGWATCH_UPDATE_STARTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
UPDATED_AT="$STARTED_AT"
FINISHED=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=true ;;
    --force) FORCE=true ;;
    --help|-h) echo "用法: ./tools/update.sh [--yes] [--force]"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR" "$(dirname "$STATE_FILE")" 2>/dev/null || true
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_DIR/update.log") 2>&1
else
  exec >> "$LOG_DIR/update.log" 2>&1
fi

read_prop() {
  local key="$1"
  if [ -f "$PROJECT_ROOT/feishu-orgwatch.properties" ]; then
    awk -F= -v k="^${key}=" '$0 ~ k {sub(/^[^=]*=/, ""); gsub(/\r/, ""); print; exit}' \
      "$PROJECT_ROOT/feishu-orgwatch.properties"
  fi
}
PORT="${ORGWATCH_UPDATE_PORT:-$(read_prop app.port)}"
PORT="${PORT:-18080}"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

write_state() {
  local state="$1"
  local message="$2"
  UPDATED_AT="$(now_iso)"
  printf '{"jobId":"%s","state":"%s","message":"%s","startedAt":"%s","updatedAt":"%s"}\n' \
    "$JOB_ID" "$state" "$message" "$STARTED_AT" "$UPDATED_AT" > "$STATE_FILE"
}

on_error() {
  local code=$?
  local line="$1"
  if [ "$FINISHED" -eq 0 ]; then
    FINISHED=1
    trap - ERR
    write_state "failed" "更新失败（步骤行 ${line}，退出码 ${code}），请查看 update.log" || true
    echo "❌ 更新失败（步骤行 ${line}，退出码 ${code}）"
  fi
  exit "$code"
}

trap 'on_error $LINENO' ERR

echo "=========================================="
echo "   正在更新 feishu-orgwatch"
echo "=========================================="
echo "任务: $JOB_ID"
write_state "running" "正在检查远程版本"

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "❌ 当前目录不是 Git 仓库，已停止。"
  false
fi

if [ "$FORCE" = false ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ 工作区存在未提交改动，已停止升级。"
    echo "   请先提交或还原；确认要用 --force 覆盖时再执行。"
    false
  fi
fi

CURRENT="$(git rev-parse HEAD)"
echo "当前版本: $(git show -s --format='%h %ad %s' --date=iso "$CURRENT")"

if [ -z "$REMOTE_URL" ]; then
  REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
fi
if [ -z "$REMOTE_URL" ]; then
  echo "❌ 未配置远程仓库，请设置 update.remote-url。"
  false
fi

echo "[1/4] 拉取 $REMOTE_URL ($BRANCH) ..."
if ! git fetch --prune "$REMOTE_URL" "$BRANCH"; then
  echo "❌ 拉取失败，服务未重启。"
  false
fi
TARGET="$(git rev-parse "FETCH_HEAD^{commit}")"
if [ "$TARGET" = "$CURRENT" ]; then
  echo "已是最新版本，无需更新。"
  write_state "succeeded" "已是最新版本"
  FINISHED=1
  exit 0
fi

echo "=== 即将应用 ==="
git log --oneline "HEAD..$TARGET" || true
if [ "$SKIP_CONFIRM" = false ]; then
  read -r -p "确认更新？(y/N) " confirm
  case "$confirm" in
    y|Y|yes|YES) ;;
    *) echo "已取消。"; write_state "succeeded" "已取消更新"; FINISHED=1; exit 0 ;;
  esac
fi

write_state "running" "正在应用新版本"
echo "[2/4] 应用版本 ..."
if ! git merge --ff-only "$TARGET"; then
  echo "❌ 无法快进到远程版本（本地可能有额外提交），服务未重启。"
  false
fi
echo "✅ 代码已更新到 $(git show -s --format='%h %ad %s' --date=iso HEAD)"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 未找到 npm，无法安装依赖与构建。"
  false
fi

write_state "running" "正在安装依赖"
echo "[3/4] 安装依赖并构建 ..."
npm ci --include=dev
npm run build

write_state "restarting" "构建完成，正在重启服务"
echo "[4/4] 重启服务 ..."

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  sudo systemctl restart "$SERVICE_NAME"
else
  bash "$PROJECT_ROOT/stop.sh" || true
  sleep 1
  nohup bash "$PROJECT_ROOT/run.sh" --no-build >/dev/null 2>&1 </dev/null &
fi

HEALTHY=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
  FINISHED=1
  trap - ERR
  write_state "succeeded" "更新完成，服务已重启"
  echo "✅ 服务已重启，更新完成。"
  echo "=========================================="
else
  write_state "failed" "服务重启后未能通过健康检查，请查看 server.log"
  echo "❌ 服务未能通过健康检查，请查看 update.log 和 server.log。"
  exit 1
fi
