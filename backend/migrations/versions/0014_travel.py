"""Add independent travel plans and immutable multi-day revisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0014_travel"
down_revision = "0013_condition_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "travel_plans",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("draft", pg.JSONB(), nullable=False),
        sa.Column("current_job_id", sa.UUID(), sa.ForeignKey("jobs.id")),
        sa.Column("current_revision_id", sa.UUID()),
        sa.Column("packed_ids", pg.JSONB(), nullable=False),
        sa.Column("added_ids", pg.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_travel_owner", "travel_plans", ["owner_id", "created_at"])
    op.create_table(
        "travel_revisions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("plan_id", sa.UUID(), sa.ForeignKey("travel_plans.id"), nullable=False),
        sa.Column("job_id", sa.UUID(), sa.ForeignKey("jobs.id"), nullable=False, unique=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("days", pg.JSONB(), nullable=False),
        sa.Column("request", pg.JSONB(), nullable=False),
        sa.Column("provider_mode", sa.String(), nullable=False),
        sa.Column("warnings", pg.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("plan_id", "number"),
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM travel_plans)")).scalar():
        raise RuntimeError("Travel data exists; restore the matching recovery point")
    op.drop_table("travel_revisions")
    op.drop_table("travel_plans")
