"""Run inside an isolated API container, with an active recovery controller."""

import os
import sys
import time
from uuid import uuid4

import httpx


def main():
    if (
        os.getenv("WARDROBE_DATABASE_URL")
        != "postgresql+psycopg://wardrobe:recovery_only@db:5432/recovery_test"
        or os.getenv("WARDROBE_PROVIDER_MODE") != "fake"
        or os.getenv("WARDROBE_RECOGNITION_MODE") != "fake"
    ):
        raise RuntimeError("Use the isolated recovery Compose project")
    with (
        open(sys.argv[1], "rb") as archive,
        httpx.Client(
            base_url="http://127.0.0.1:8000/api/v1", trust_env=False, timeout=120
        ) as client,
    ):

        def data(response):
            response.raise_for_status()
            return response.json()["data"]

        def wait(path, pending, expected):
            for _ in range(180):
                state = data(client.get(path))
                if state["status"] == expected:
                    return state
                if state["status"] not in pending:
                    raise RuntimeError(f"{state['status']}: {state['message']}")
                time.sleep(1)
            raise TimeoutError(f"Restore did not reach {expected}")

        view = data(
            client.post(
                "/restores/validate",
                files={"file": ("backup.zip", archive, "application/zip")},
                headers={"Idempotency-Key": str(uuid4())},
            )
        )
        path = f"/restores/{view['restore_id']}"
        validated = wait(path, {"validating"}, "ready")
        print(f"{view['restore_id']}: validated", flush=True)
        data(
            client.post(
                f"{path}/apply",
                json={"confirmation_token": validated["confirmation_token"]},
                headers={"Idempotency-Key": str(uuid4())},
            )
        )
        result = wait(path, {"queued", "running"}, "succeeded")
        print(f"{view['restore_id']}: {result['status']}", flush=True)


if __name__ == "__main__":
    main()
