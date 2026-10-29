"""Durable seasonal sessions, reviews and per-item action receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_seasonal"
down_revision = "0009_organization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seasonal_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("season", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("categories", postgresql.JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False),
        sa.Column("target_token", sa.String()),
        sa.Column("summary", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "seasonal_items",
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("seasonal_sessions.id"), primary_key=True),
        sa.Column("garment_id", sa.UUID(), sa.ForeignKey("garments.id"), primary_key=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("reviewed_version", sa.Integer()),
        sa.Column("todo", sa.String(), nullable=False),
    )
    op.create_table(
        "seasonal_actions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("seasonal_sessions.id"), nullable=False),
        sa.Column("garment_id", sa.UUID(), sa.ForeignKey("garments.id"), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_seasonal_actions_session_id", "seasonal_actions", ["session_id"])


def downgrade() -> None:
    for name in ["seasonal_actions", "seasonal_items", "seasonal_sessions"]:
        op.drop_table(name)
