"""Create local-only secrets once. Never print secrets or replace existing configuration."""

import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / ".env.langfuse"
worker_target = ROOT / ".env.langfuse-worker"
if target.exists() or worker_target.exists():
    raise SystemExit("Langfuse configuration already exists; left unchanged.")
values = {
    key: secrets.token_hex(32)
    for key in (
        "LF_POSTGRES_PASSWORD",
        "LF_CLICKHOUSE_PASSWORD",
        "LF_REDIS_PASSWORD",
        "LF_MINIO_PASSWORD",
        "LF_SALT",
        "LF_ENCRYPTION_KEY",
        "LF_NEXTAUTH_SECRET",
        "LF_ADMIN_PASSWORD",
    )
}
values.update(
    {
        "LF_ADMIN_EMAIL": "admin@wardrobe.local",
        "LANGFUSE_PUBLIC_KEY": "pk-lf-" + secrets.token_hex(16),
        "LANGFUSE_SECRET_KEY": "sk-lf-" + secrets.token_hex(32),
        "LANGFUSE_ENABLED": "true",
        "LANGFUSE_BASE_URL": "http://host.docker.internal:3006",
        "LANGFUSE_ENVIRONMENT": "local",
        "LANGFUSE_CAPTURE_TEXT": "false",
        "LANGFUSE_PRICE_PROFILE": "bailian_beijing_20261028",
    }
)
try:
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit(".env.langfuse already exists; left unchanged.") from None
with os.fdopen(fd, "w") as stream:
    stream.write("# Local credentials; excluded from Git. Do not publish.\n")
    stream.writelines(f"{key}={value}\n" for key, value in values.items())
with os.fdopen(
    os.open(worker_target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w"
) as stream:
    stream.write(
        "# Only application tracing credentials; no infrastructure/admin secrets.\n"
    )
    stream.writelines(
        f"WARDROBE_{key}={value}\n"
        for key, value in values.items()
        if key.startswith("LANGFUSE_")
    )
print(
    "Created .env.langfuse (0600). Login credentials: LF_ADMIN_EMAIL / LF_ADMIN_PASSWORD."
)
