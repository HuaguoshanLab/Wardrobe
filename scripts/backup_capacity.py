"""Synthetic backup acceptance. Run only in the dedicated P6 container, never production."""

import hashlib
import io
import json
import os
import random
import resource
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import httpx
from app.backup import archive, control, database, workflow
from app.core.config import get_settings
from app.core.maintenance import active
from app.db.models import SystemState
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset
from app.schemas.backups import RestoreApply
from app.services import backups
from PIL import Image
from sqlalchemy import select
from sqlalchemy.engine import make_url


def guard():
    if sys.flags.optimize:
        raise RuntimeError(
            "Acceptance requires enabled assertions; do not use python -O"
        )
    settings = get_settings()
    assert os.environ.get("P6_CAPACITY_ISOLATED") == "1"
    assert make_url(settings.database_url).database == "capacity_test"
    assert make_url(settings.database_url).host == "db"
    assert settings.provider_mode == settings.recognition_mode == "fake"
    assert not settings.qwen_configured and not settings.weather_configured
    assert str(settings.media_root) == "/data/media"
    assert str(settings.control_root) == "/data/control"
    return settings


def fingerprint(data):
    return {
        name: hashlib.sha256(
            json.dumps(
                sorted(json.dumps(row, sort_keys=True) for row in rows),
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        for name, rows in data.items()
        if name != "public.system_state"
    }


def measure(label, action):
    start = time.monotonic()
    result = action()
    print(
        json.dumps(
            {
                "phase": label,
                "seconds": round(time.monotonic() - start, 3),
                "process_peak_rss_kib": resource.getrusage(
                    resource.RUSAGE_SELF
                ).ru_maxrss,
            }
        ),
        flush=True,
    )
    return result


def seed(count):
    rng = random.Random(20261027)
    with session_factory().begin() as db:
        owner = db.get(SystemState, 1).owner_id
        existing = db.scalar(select(Garment))
        attributes = dict(existing.attributes)
        for i in range(count):
            output = io.BytesIO()
            Image.frombytes("RGB", (512, 512), rng.randbytes(512 * 512 * 3)).save(
                output, format="PNG"
            )
            content = output.getvalue()
            key = "original/" + uuid4().hex
            path = Path("/data/media") / key
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_bytes(content)
            asset = MediaAsset(
                owner_id=owner,
                original_key=key,
                original_name=f"synthetic-{i}.png",
                sha256=hashlib.sha256(content).hexdigest(),
                display_key=key,
                cutout_key=None,
                width=512,
                height=512,
            )
            db.add(asset)
            db.flush()
            db.add(
                Garment(owner_id=owner, image_asset_id=asset.id, attributes=attributes)
            )


def upload_http(path):
    from app.schemas.backups import RestoreView

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--fd",
            str(listener.fileno()),
        ],
        pass_fds=(listener.fileno(),),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=300
        ) as client:
            for attempt in range(100):
                if server.poll() is not None:
                    raise RuntimeError("isolated API exited before readiness")
                try:
                    if client.get("/api/v1/health/ready").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("isolated API did not start")
            with path.open("rb") as source:
                response = client.post(
                    "/api/v1/restores/validate",
                    headers={"Idempotency-Key": str(uuid4())},
                    files={"file": ("synthetic.zip", source, "application/zip")},
                )
            assert response.status_code == 202, response.text
            return RestoreView.model_validate(response.json()["data"])
    finally:
        listener.close()
        server.terminate()
        server.wait(timeout=15)


def roundtrip(label):
    if not label or any(
        c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in label
    ):
        raise ValueError(
            "Evidence label must contain only lowercase letters, digits or hyphens"
        )
    accepted = backups.create(str(uuid4()))
    measure(
        label + " export", lambda: workflow.process(control.require(accepted.job_id))
    )
    record = control.require(accepted.job_id)
    assert record.status == "succeeded", record.message
    path = backups.download(record.id)
    expected, summary = archive.validate_archive(path, Path("/data/control/compare"))
    before = fingerprint(expected)
    view = measure(label + " HTTP upload", lambda: upload_http(path))
    measure(
        label + " validate", lambda: workflow.process(control.require(view.restore_id))
    )
    view = backups.restore_view(view.restore_id)
    assert view.status == "ready", view.message
    old_epoch = database.data_epoch()
    payload = RestoreApply(confirmation_token=view.confirmation_token)
    key = str(uuid4())
    accepted = backups.apply(view.restore_id, payload, key)
    assert backups.apply(view.restore_id, payload, key) == accepted
    measure(
        label + " apply", lambda: workflow.process(control.require(view.restore_id))
    )
    restored = control.require(view.restore_id)
    assert restored.status == "succeeded", restored.message
    assert database.data_epoch() != old_epoch
    assert not active()
    output = Path("/data/control/after.json")
    database.export_data(output)
    actual = database.load_data(output)
    assert fingerprint(actual) == before
    for old, new in zip(
        expected["public.system_state"], actual["public.system_state"], strict=True
    ):
        assert {k: v for k, v in old.items() if k != "data_epoch"} == {
            k: v for k, v in new.items() if k != "data_epoch"
        }
    media = {
        k: archive.sha256(Path("/data/media") / k)
        for k in database.media_keys(expected)
    }
    with ZipFile(path) as source:
        manifest = json.loads(source.read("manifest.json"))
    assert all(manifest["files"]["media/" + k]["sha256"] == v for k, v in media.items())
    recovery = control.directory(view.restore_id) / "recovery.zip"
    assert recovery.is_file()
    result = {
        "label": label,
        "backup_id": str(record.id),
        "restore_id": str(view.restore_id),
        "archive_bytes": path.stat().st_size,
        "database_bytes": output.stat().st_size,
        "summary": summary,
        "tables_sha256": before,
        "media_sha256": hashlib.sha256(
            json.dumps(media, sort_keys=True).encode()
        ).hexdigest(),
        "disk_used_bytes": shutil.disk_usage("/data/control").used,
    }
    print(json.dumps(result), flush=True)
    Path("/evidence/" + label + ".json").write_text(json.dumps(result, indent=2))
    # Only this script's temporary artifacts; never remove named volumes or business files.
    shutil.rmtree("/data/control/compare")
    for folder in (control.directory(record.id), control.directory(view.restore_id)):
        for child in folder.iterdir():
            if child.name == "state.json":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    return result


if __name__ == "__main__":
    guard()
    count = int(sys.argv[2])
    measure("seed", lambda: seed(count))
    roundtrip(sys.argv[1])
