"""Persistent photo recognition calls and uncertainty notes.

Revision ID: 0006_recognition
Revises: 0005_collections
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006_recognition"
down_revision = "0005_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "import_rows",
        sa.Column("analysis_notes", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.create_table(
        "recognition_calls",
        sa.Column("job_id", sa.UUID(), sa.ForeignKey("jobs.id"), primary_key=True),
        sa.Column("row_id", sa.UUID(), sa.ForeignKey("import_rows.id"), primary_key=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("response", postgresql.JSONB(), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("recognition_calls")
    op.drop_column("import_rows", "analysis_notes")
