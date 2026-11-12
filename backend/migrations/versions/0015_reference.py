"""Independent reference photographs and confirmed visual clues."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0015_reference"
down_revision = "0014_travel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outfit_references",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("original_key", sa.String(), nullable=False),
        sa.Column("display_key", sa.String(), nullable=False),
        sa.Column("analysis", pg.JSONB()),
        sa.Column("clues", pg.JSONB(), nullable=False),
        sa.Column("confirmed", sa.Boolean(), nullable=False),
        sa.Column("current_job_id", sa.UUID(), sa.ForeignKey("jobs.id")),
        sa.Column("revision_ids", pg.JSONB(), nullable=False),
        sa.Column("provider_mode", sa.String()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_reference_owner", "outfit_references", ["owner_id", "created_at"])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM outfit_references)")).scalar():
        raise RuntimeError("Reference data exists; restore the matching recovery point")
    op.drop_table("outfit_references")
