"""Foundation task ledger; checkpoint schema is managed separately."""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    state = op.create_table(
        "system_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("data_epoch", sa.Uuid(), nullable=False),
    )
    op.bulk_insert(state, [{"id": 1, "owner_id": uuid4(), "data_epoch": uuid4()}])
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(100), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("input_snapshot", pg.JSONB(), nullable=False),
        sa.Column("result", pg.JSONB()),
        sa.Column("error", pg.JSONB()),
        sa.Column("provider_response", pg.JSONB()),
        sa.Column("call_state", sa.String(24), nullable=False),
        sa.Column("retry_of_job_id", sa.Uuid(), sa.ForeignKey("jobs.id")),
        sa.Column("lease_token", sa.Uuid()),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("last_seq", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "operation", "idempotency_key"),
    )
    op.create_index("ix_jobs_claim", "jobs", ["status", "created_at"])
    op.create_table(
        "job_events",
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("jobs.id"), primary_key=True),
        sa.Column("seq", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(24), nullable=False),
        sa.Column("payload", pg.JSONB(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("job_events")
    op.drop_table("jobs")
    op.drop_table("system_state")
