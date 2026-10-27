"""Actual default-limit probes, isolated P6 only; no business volume access."""

import hashlib
import json
import shutil
from pathlib import Path
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import psycopg
from app.backup import archive, database
from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import MediaAsset
from backup_capacity import guard, measure, roundtrip
from sqlalchemy import select


def rejected(label, action, codes=("BACKUP_LIMIT",)):
    try:
        action()
    except AppError as exc:
        assert exc.code in codes, exc.code
        print(json.dumps({"probe": label, "result": exc.code}), flush=True)
    else:
        raise AssertionError(label + " accepted unexpectedly")


def size_limits():
    settings = guard()
    root = Path("/data/control/size-probes")
    root.mkdir(exist_ok=True)
    with session_factory()() as db:
        asset = db.scalar(select(MediaAsset))
        path = archive.path_for(asset.original_key)
    # Only a synthetic isolated file; enlarge then restore its original bytes.
    original = path.read_bytes()
    with path.open("ab") as f:
        f.truncate(settings.backup_max_bytes)
    try:
        rejected("export-total-over-2GiB", lambda: archive.export_archive(root))
    finally:
        path.write_bytes(original)
    oversized = root / "oversized.zip"
    with oversized.open("wb") as f:
        f.truncate(settings.backup_max_bytes + 1)
    rejected(
        "upload-package-over-2GiB",
        lambda: archive.validate_archive(oversized, root / "unused"),
    )
    oversized.unlink()
    # High compression is used ONLY for decompression-limit rejection, not capacity evidence.
    bomb = root / "expanded.zip"
    with ZipFile(bomb, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("manifest.json", "{}")
        with z.open("database.json", "w", force_zip64=True) as out:
            for _ in range(2049):
                out.write(b"0" * 1024**2)
    rejected(
        "expanded-over-2GiB", lambda: archive.validate_archive(bomb, root / "unused")
    )
    shutil.rmtree(root)


def json_limits():
    guard()
    with psycopg.connect(database.connection_url()) as c:
        c.execute(
            "INSERT INTO operation_receipts(id,operation,key,request_hash,response) "
            "VALUES (%s,'capacity','capacity-json',%s,jsonb_build_object('payload',repeat('x',%s)))",
            (uuid4(), "0" * 64, 127 * 1024**2),
        )
    measure("127MiB-json-roundtrip", lambda: roundtrip("json-near-limit"))
    with psycopg.connect(database.connection_url()) as c:
        c.execute(
            "UPDATE operation_receipts SET response=jsonb_build_object('payload',repeat('x',%s)) "
            "WHERE key='capacity-json'",
            (128 * 1024**2,),
        )
    rejected(
        "database-export-over-128MiB",
        lambda: database.export_data(Path("/data/control/too-large.json")),
    )
    with psycopg.connect(database.connection_url()) as c:
        c.execute("DELETE FROM operation_receipts WHERE key='capacity-json'")


def file_limits():
    guard()
    root = Path("/data/control/file-probes")
    root.mkdir(exist_ok=True)
    database.export_data(root / "base.json")
    data = database.load_data(root / "base.json")
    original_keys = database.media_keys(data)
    sample = next(iter(data["public.media_assets"]))
    # A tiny valid image keeps the file-count dimension separate from the byte limit.
    import io

    from PIL import Image

    stream = io.BytesIO()
    Image.new("RGB", (1, 1), "blue").save(stream, format="PNG")
    body = stream.getvalue()
    needed = 9999 - len(original_keys)
    if needed <= 0:
        raise RuntimeError(
            "File-count probe requires fewer than 9999 existing media files"
        )
    rows = []
    for i in range(needed):
        key = "original/" + uuid4().hex
        archive.path_for(key).write_bytes(body)
        rows.append(
            {
                **sample,
                "id": str(uuid4()),
                "original_key": key,
                "display_key": None,
                "cutout_key": None,
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        )
    data["public.media_assets"].extend(rows)
    with psycopg.connect(database.connection_url()) as c:
        database.import_data(c, data)
    result = measure("9999-media-files-roundtrip", lambda: roundtrip("file-near-limit"))
    assert result["summary"]["media_files"] == 9999
    extra = dict(rows[-1], id=str(uuid4()), original_key="original/" + uuid4().hex)
    archive.path_for(extra["original_key"]).write_bytes(body)
    data["public.media_assets"].append(extra)
    with psycopg.connect(database.connection_url()) as c:
        database.import_data(c, data)
    rejected("10000-media-plus-database", lambda: archive.export_archive(root))
    with ZipFile(root / "too-many.zip", "w") as z:
        z.writestr("manifest.json", "{}")
        for i in range(10001):
            z.writestr(str(i), b"")
    rejected(
        "10002-zip-entries",
        lambda: archive.validate_archive(root / "too-many.zip", root / "unused"),
        ("INVALID_BACKUP",),
    )


def entry_limits():
    guard()
    root = Path("/data/control/entry-probes")
    root.mkdir(exist_ok=True)
    manifest = {
        **database.compatibility(),
        "files": {"database.json": {"size": 128 * 1024**2 + 1, "sha256": "0" * 64}},
    }
    path = root / "large-database.zip"
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        with z.open("database.json", "w") as output:
            for _ in range(128):
                output.write(b"0" * 1024**2)
            output.write(b"0")
    rejected(
        "uploaded-database-over-128MiB",
        lambda: archive.validate_archive(path, root / "unused"),
    )
    with ZipFile(root / "large-manifest.zip", "w", compression=ZIP_DEFLATED) as z:
        z.writestr("manifest.json", b" " * (4 * 1024**2 + 1))
    rejected(
        "manifest-over-4MiB",
        lambda: archive.validate_archive(root / "large-manifest.zip", root / "unused"),
    )
    shutil.rmtree(root)


if __name__ == "__main__":
    import sys

    {
        "size": size_limits,
        "json": json_limits,
        "files": file_limits,
        "entries": entry_limits,
    }[sys.argv[1]]()
