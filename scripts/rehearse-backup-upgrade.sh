#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 ]]; then
  echo "Usage: bash $0 OLD.zip TARGET_VERSION.zip UNUSED_IPV4_SUBNET" >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
python="$root/backend/.venv/bin/python"
old=$1
target=$2
export RECOVERY_SUBNET=$3

select_bundle() {
  local backup=$1 bundle="${1%.zip}.images" details
  (cd "$bundle" && shasum -a 256 -c SHA256SUMS)
  details=$("$python" - "$backup" "$bundle/manifest.json" <<'PY'
import hashlib
import json
import sys

with open(sys.argv[2]) as stream:
    manifest = json.load(stream)
with open(sys.argv[1], "rb") as stream:
    if hashlib.file_digest(stream, "sha256").hexdigest() != manifest["backup_sha256"]:
        sys.exit("Backup SHA-256 does not match the image bundle")
for role in ("backend", "web", "postgres"):
    image = manifest["images"][role]
    print(image["tag"], image["image_id"])
PY
)
  docker load -i "$bundle/images.tar.gz"
  local reference image_id
  while read -r reference image_id; do
    [[ "$(docker image inspect --format '{{.Id}}' "$reference")" == "$image_id" ]] ||
      { echo "Loaded image does not match recorded ID: $reference" >&2; return 1; }
  done <<< "$details"
  read -r RECOVERY_BACKEND _ <<< "$(sed -n '1p' <<< "$details")"
  read -r RECOVERY_WEB _ <<< "$(sed -n '2p' <<< "$details")"
  read -r RECOVERY_POSTGRES postgres_id <<< "$(sed -n '3p' <<< "$details")"
  export RECOVERY_BACKEND RECOVERY_WEB RECOVERY_POSTGRES
}

select_bundle "$old"
original_postgres_id=$postgres_id
mkdir -p "$root/data/acceptance"
out=$(mktemp -d "$root/data/acceptance/recovery.XXXXXXXX")
project="wardrobe-recovery-$(tr '[:upper:]' '[:lower:]' <<< "${out##*.}")"
compose=(docker compose --env-file /dev/null -p "$project" -f "$root/scripts/compose.recovery.yaml")
cleanup() {
  local status=$?
  trap - EXIT
  "${compose[@]}" logs --no-color > "$out/compose.log" 2>&1 || true
  "${compose[@]}" down --volumes || status=1
  printf 'Recovery evidence: %s\n' "$out"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

snapshot() {
  local archive_path
  archive_path=$("${compose[@]}" exec -T api python -c 'from pathlib import Path; import tempfile; from app.backup.archive import export_archive; print(export_archive(Path(tempfile.mkdtemp()))[0])')
  "${compose[@]}" cp "api:$archive_path" "$out/$1.zip"
  "${compose[@]}" exec -T web wget -q -O /dev/null http://127.0.0.1/api/v1/health/ready
}

"${compose[@]}" up -d --wait --wait-timeout 100 web controller
"${compose[@]}" cp "$old" api:/tmp/source.zip
"${compose[@]}" exec -T api python - /tmp/source.zip < "$root/scripts/recovery-drill.py"
snapshot restored
"${compose[@]}" stop web api controller
select_bundle "$target"
[[ "$postgres_id" == "$original_postgres_id" ]] || {
  echo 'This rehearsal requires the same PostgreSQL image for both releases' >&2
  exit 1
}
"${compose[@]}" up -d --wait --wait-timeout 100 web controller
snapshot upgraded
"$python" "$root/scripts/compare-recovery.py" "$old" "$out/restored.zip" "$out/upgraded.zip" |
  tee "$out/comparison.jsonl"
