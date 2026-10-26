"""P3 profile and weather cache; retain all existing wardrobe data."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_weather_profile"
down_revision = "ea067667e0f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("owner_id", sa.Uuid(), primary_key=True),
        sa.Column("preferences", postgresql.JSONB(), nullable=False),
        sa.Column("preference_version", sa.Integer(), nullable=False),
        sa.Column("city", postgresql.JSONB(), nullable=True),
        sa.Column("location_version", sa.Integer(), nullable=False),
    )
    op.execute("INSERT INTO profiles SELECT owner_id, '{}'::jsonb, 1, NULL, 1 FROM system_state")
    op.create_table(
        "weather_cities",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
    )
    op.create_table(
        "weather_cache",
        sa.Column("key", sa.String(150), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("weather_cache")
    op.drop_table("weather_cities")
    op.drop_table("profiles")
