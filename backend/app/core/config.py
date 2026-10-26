from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WARDROBE_", extra="ignore")

    database_url: str = "postgresql+psycopg://wardrobe:wardrobe_local_dev@localhost:55438/wardrobe"
    provider_mode: Literal["disabled", "fake"] = "disabled"
    lease_seconds: int = Field(default=30, ge=5, le=300)
    poll_seconds: float = Field(default=0.5, ge=0.1, le=10)
    event_retention_days: int = Field(default=7, ge=1)
    media_root: Path = Path("../data/media")
    cutout_enabled: bool = True

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
