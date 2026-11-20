#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 4 ]]; then
  echo "Usage: bash $0 BACKUP.zip BACKEND_IMAGE WEB_IMAGE POSTGRES_IMAGE" >&2
  exit 2
fi
python="$(dirname "$0")/../backend/.venv/bin/python"
backup=$1
destination="${backup%.zip}.images"
[[ ! -e "$destination" ]] || { echo "Already exists: $destination" >&2; exit 1; }
stage=$(mktemp -d "${destination}.tmp.XXXXXXXX")
trap 'if [[ -n "$stage" ]]; then rm -rf -- "$stage"; fi' EXIT

docker run --rm --network none --entrypoint python "$2" -c \
  'import json; from app.backup.database import compatibility; print(json.dumps(compatibility()))' \
  > "$stage/compatibility.json"
docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$2" "$3" "$4" > "$stage/image-ids"
"$python" - "$backup" "$stage" "$2" "$3" "$4" <<'PY'
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile

backup, stage = map(Path, sys.argv[1:3])
compatibility = json.loads((stage / "compatibility.json").read_text())
with ZipFile(backup) as archive:
    manifest = json.loads(archive.read("manifest.json"))
if not compatibility or any(manifest.get(key) != value for key, value in compatibility.items()):
    sys.exit("Backend image does not match the backup manifest")
with backup.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
images = {}
for role, name, record in zip(
    ("backend", "web", "postgres"),
    sys.argv[3:],
    (stage / "image-ids").read_text().splitlines(),
    strict=True,
):
    image_id, platform = record.split()
    images[role] = dict(tag=name, image_id=image_id, platform=platform)
(stage / "manifest.json").write_text(
    json.dumps(dict(backup=backup.name, backup_sha256=digest, compatibility=compatibility, images=images),
               indent=2) + "\n"
)
PY

# Keep the tags in the archive so docker load can restore the recorded names.
docker save "$2" "$3" "$4" | gzip -1 > "$stage/images.tar.gz"
(cd "$stage" && shasum -a 256 images.tar.gz manifest.json > SHA256SUMS)
rm "$stage/compatibility.json" "$stage/image-ids"
# A concurrent invocation must not move its temporary directory inside an existing bundle.
"$python" - "$stage" "$destination" <<'PY'
import os
import sys
from pathlib import Path

target = Path(sys.argv[2])
try:
    target.mkdir()
except FileExistsError:
    sys.exit(f"Already exists: {target}")
try:
    os.replace(sys.argv[1], target)
except OSError:
    target.rmdir()
    raise
PY
stage=
printf '%s\n' "$destination"
