"""Verify an idle backup, a same-version restore export and an upgraded export."""

import hashlib
import json
import sys
from zipfile import ZipFile


def read(path):
    with ZipFile(path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        files = manifest["files"]
        if set(archive.namelist()) != {*files, "manifest.json"}:
            raise ValueError(f"Unexpected archive file list: {path}")
        for name, entry in files.items():
            with archive.open(name) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                    raise ValueError(f"Hash mismatch in {path}: {name}")
            if archive.getinfo(name).file_size != entry["size"]:
                raise ValueError(f"Size mismatch in {path}: {name}")
        return (
            manifest["alembic_revision"],
            json.loads(archive.read("database.json")),
            {name: meta for name, meta in files.items() if name.startswith("media/")},
        )


def canonical(records):
    return sorted(json.dumps(row, sort_keys=True) for row in records)


def compare(before, after, *, restore):
    previous_rev, previous, previous_media = before
    revision, current, current_media = after
    if (previous_rev == revision) != restore:
        raise ValueError(f"Unexpected Alembic revision: {previous_rev} -> {revision}")

    for table, rows in previous.items():
        if table == "public.alembic_version":
            continue
        actual = current[table]

        if restore and table == "public.system_state":
            rows, actual = (
                [
                    {key: value for key, value in row.items() if key != "data_epoch"}
                    for row in records
                ]
                for records in (rows, actual)
            )

        if canonical(rows) != canonical(actual):
            raise ValueError(f"Row mismatch in {table}")
    extra = set(current) - set(previous)
    if any(current[table] for table in extra):
        raise ValueError(f"Unexpected rows in new tables: {sorted(extra)}")
    if previous_media != current_media:
        raise ValueError("Referenced media list or SHA-256 changed")
    print(
        json.dumps(
            {
                "before": previous_rev,
                "after": revision,
                "tables": len(previous),
                "new_tables": sorted(extra),
                "rows": sum(map(len, previous.values())),
                "media": len(previous_media),
            }
        )
    )


def main():
    original, restored, upgraded = map(read, sys.argv[1:])
    if any(
        row["status"] in {"queued", "running", "cancel_requested"}
        for row in original[1]["public.jobs"]
    ):
        raise ValueError(
            "This exact-row comparison requires a backup without active jobs"
        )
    if (
        original[1]["public.system_state"][0]["data_epoch"]
        == restored[1]["public.system_state"][0]["data_epoch"]
    ):
        raise ValueError("Restore did not change data_epoch")
    compare(original, restored, restore=True)
    compare(restored, upgraded, restore=False)


if __name__ == "__main__":
    main()
