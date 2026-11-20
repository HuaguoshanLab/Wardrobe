#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

front() { (cd frontend && npm "$@"); }
back() { (cd backend && ".venv/bin/$1" "${@:2}"); }

printf '\n== 前后端检查 ==\n'
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  printf '请在 PATH 中启用 Node 24。\n' >&2
  exit 1
fi
backend/.venv/bin/python scripts/check_structure.py
backend/.venv/bin/python scripts/check_docs.py
back ruff check app tests
back ruff format --check app tests
back mypy app
front run format:check
front run build
front test

printf '\n== 隔离 PostgreSQL 集成回归 ==\n'
docker info --format '{{.ServerVersion}}'
# Explicit subnets let the suite run even when Docker's default address pool is exhausted.
subnets=$(docker network ls --quiet |
  xargs docker network inspect --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' |
  backend/.venv/bin/python -c '
import ipaddress
import os
import random
import sys

pool = ipaddress.IPv4Network(os.getenv("WARDROBE_VERIFY_NETWORK_POOL", "172.31.240.0/20"))
occupied = [ipaddress.ip_network(line) for line in sys.stdin.read().split()]
candidates = [
    subnet for subnet in pool.subnets(new_prefix=28)
    if not any(subnet.overlaps(other) for other in occupied)
]
if len(candidates) < 2:
    sys.exit("No two free /28 networks in WARDROBE_VERIFY_NETWORK_POOL")
print(*random.sample(candidates, 2))
')
read -r WARDROBE_VERIFY_INTERNAL_SUBNET WARDROBE_VERIFY_INGRESS_SUBNET <<< "$subnets"
export WARDROBE_VERIFY_INTERNAL_SUBNET WARDROBE_VERIFY_INGRESS_SUBNET

mkdir -p data/acceptance
run_dir=$(mktemp -d "$PWD/data/acceptance/verify.XXXXXXXX")
project="wardrobe-verify-$(basename "$run_dir" | cut -d. -f2 | tr '[:upper:]' '[:lower:]')"
compose=(docker compose --env-file /dev/null -p "$project" -f scripts/compose.verify.yaml --profile test)
cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    "${compose[@]}" logs --no-color > "$run_dir/compose.log" 2>&1 || true
    printf '失败日志与浏览器产物目录：%s\n' "$run_dir" >&2
  fi
  if ! "${compose[@]}" down --volumes --rmi local; then
    printf '清理隔离项目失败：%s\n' "$project" >&2
    (( status != 0 )) || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose[@]}" build test migrate web
"${compose[@]}" run --rm test 2>&1 | tee "$run_dir/pytest.log"

printf '\n== 主流程浏览器回归 ==\n'
"${compose[@]}" up -d --wait --wait-timeout 120 --no-build web worker controller
endpoint=$("${compose[@]}" port web 80)
WARDROBE_VERIFY_PROJECT="$project" E2E_BASE_URL="http://$endpoint" \
  WARDROBE_VERIFY_RESULTS="$run_dir/browser" P6_ISOLATED_REGRESSION=1 P7_ISOLATED_REGRESSION=1 \
  front run test:e2e -- --config playwright.verify.config.ts 2>&1 | tee "$run_dir/playwright.log"
printf '浏览器产物目录：%s/browser\n' "$run_dir"
