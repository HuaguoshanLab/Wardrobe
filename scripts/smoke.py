"""Compose HTTP smoke; --faults deliberately restarts only this project's services."""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:8088")
parser.add_argument("--faults", action="store_true")
args = parser.parse_args()
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(path, payload=None, key=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Idempotency-Key"] = key
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(args.url + "/api/v1" + path, data=data, headers=headers)
    with http.open(req, timeout=10) as response:
        return json.load(response)["data"]


def wait_for(path, predicate, timeout=50):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            state = request(path)
            if predicate(state):
                return state
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.5)
    raise AssertionError(f"Timeout waiting for {path}")


def compose(*commands):
    subprocess.run(["docker", "compose", *commands], cwd=ROOT, check=True)


assert request("/health/ready")["status"] == "ready"
key = str(uuid4())
payload = {"message": "HTTP smoke", "delay_seconds": 1}
first = request("/diagnostics/jobs", payload, key)
assert request("/diagnostics/jobs", payload, key)["job_id"] == first["job_id"]
path = "/jobs/" + first["job_id"]
done = wait_for(path, lambda state: state["status"] == "succeeded")
assert done["result"]["provider_mode"] == "fake"
with http.open(args.url + "/api/v1" + path + "/events", timeout=10) as response:
    events = [json.loads(line[6:]) for line in response.read().decode().splitlines()
              if line.startswith("data: ")]
assert events[-1]["payload"]["status"] == "succeeded"
assert [e["seq"] for e in events] == list(range(1, done["last_seq"] + 1))
print("PASS: HTTP idempotency, worker execution, persisted result, SSE replay", flush=True)

if args.faults:
    interrupted = request("/diagnostics/jobs", {"message": "crash probe", "delay_seconds": 15}, str(uuid4()))
    crash_path = "/jobs/" + interrupted["job_id"]
    wait_for(crash_path, lambda state: state["status"] == "running")
    compose("kill", "-s", "SIGKILL", "worker")
    compose("up", "-d", "worker")
    wait_for(crash_path, lambda state: state["status"] == "interrupted")
    retried = request(crash_path + "/retry", {}, str(uuid4()))
    wait_for("/jobs/" + retried["job_id"], lambda state: state["status"] == "succeeded")
    print("PASS: killed worker is interrupted; explicit retry creates a new task", flush=True)
    before = request("/capabilities")["data_epoch"]
    compose("restart", "db", "api", "worker")
    wait_for("/health/ready", lambda state: state["status"] == "ready")
    assert request(path)["result"] == done["result"]
    assert request("/capabilities")["data_epoch"] == before
    print("PASS: database/API/worker restart preserves completed results and data epoch", flush=True)
