from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class Profile(Base):
    __tablename__ = "profiles"
    owner_id: Mapped[UUID] = mapped_column(primary_key=True)
    current_session_id: Mapped[UUID | None] = mapped_column(ForeignKey("outfit_sessions.id"))
    preferences: Mapped[dict[str, JsonValue]] = mapped_column(JSONB, default=dict)
    preference_version: Mapped[int] = mapped_column(default=1)
    city: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    location_version: Mapped[int] = mapped_column(default=1)


class CityRecord(Base):
    __tablename__ = "weather_cities"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)


class WeatherCache(Base):
    __tablename__ = "weather_cache"
    key: Mapped[str] = mapped_column(String(150), primary_key=True)
    data: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
