#!/usr/bin/env bash
# 兼容旧名称，等价于 tools/reset_admin_password.sh
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$PROJECT_ROOT/scripts/reset-admin-password.mjs" "$@"
