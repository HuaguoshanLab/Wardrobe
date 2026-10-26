from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WARDROBE_", extra="ignore")

    database_url: str = "postgresql+psycopg://wardrobe:wardrobe_local_dev@localhost:55438/wardrobe"
    provider_mode: Literal["disabled", "fake", "qwen"] = "disabled"
    lease_seconds: int = Field(default=30, ge=5, le=300)
    poll_seconds: float = Field(default=0.5, ge=0.1, le=10)
    event_retention_days: int = Field(default=7, ge=1)
    media_root: Path = Path("../data/media")
    cutout_enabled: bool = True
    control_root: Path = Path("../data/control")
    backup_max_bytes: int = Field(default=2 * 1024**3, ge=1024**2)

    qwen_api_key: SecretStr = SecretStr("")
    qwen_base_url: str = Field(
        default="", pattern=r"^$|^https://[a-zA-Z0-9.-]+/(?:compatible-mode/v1)/?$"
    )
    qwen_model: Literal["qwen3-vl-plus"] = "qwen3-vl-plus"

    @property
    def qwen_configured(self) -> bool:
        return bool(self.qwen_base_url and self.qwen_api_key.get_secret_value())

    qweather_host: str = Field(default="", pattern=r"^$|^[a-zA-Z0-9-]+\.qweatherapi\.com$")
    qweather_api_key: SecretStr = SecretStr("")
    qweather_token: SecretStr = SecretStr("")

    @property
    def weather_configured(self) -> bool:
        return bool(
            self.qweather_host
            and (self.qweather_api_key.get_secret_value() or self.qweather_token.get_secret_value())
        )

    @property
    def psycopg_url(self) -> str:
        return (
            make_url(self.database_url)
            .set(drivername="postgresql")
            .render_as_string(hide_password=False)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
