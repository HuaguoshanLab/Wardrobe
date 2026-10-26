import time

from app.core.errors import AppError
from app.schemas.jobs import DiagnosticInput, DiagnosticResult


class FakeProvider:
    """Deterministic diagnostic only; never returns pretend wardrobe outfits."""

    def run(self, payload: DiagnosticInput) -> DiagnosticResult:
        time.sleep(payload.delay_seconds)
        if payload.scenario == "failure":
            raise AppError("FAKE_FAILURE", "这是主动选择的模拟失败", 503)
        return DiagnosticResult(message=f"模拟任务完成：{payload.message}")
