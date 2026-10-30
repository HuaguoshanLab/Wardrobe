"""Versioned subjective feedback, attached only to actual wear records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_wear_feedback"
down_revision = "0011_manual_outfits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wear_feedback",
        sa.Column("wear_record_id", sa.UUID(), nullable=False),
        sa.Column("feedback", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["wear_record_id"], ["wear_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("wear_record_id"),
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM wear_feedback)")).scalar():
        raise RuntimeError("Feedback exists; restore the matching pre-upgrade recovery point")
    op.drop_table("wear_feedback")
