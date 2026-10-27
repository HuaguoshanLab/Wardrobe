from uuid import UUID

from pydantic import BaseModel, ConfigDict, JsonValue


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Envelope[T](Schema):
    data: T
    request_id: UUID


class ErrorDetail(Schema):
    code: str
    message: str
    details: list[dict[str, JsonValue]] = []
    retryable: bool = False


class ErrorEnvelope(Schema):
    error: ErrorDetail
    request_id: UUID


class Health(Schema):
    status: str


class Capabilities(Schema):
    provider_mode: str
    model: str
    recognition: str
    weather: str
    cutout: str
    maintenance: bool
    data_epoch: UUID
