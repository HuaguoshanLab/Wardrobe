"""Add reusable condition templates without changing existing business rows."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_condition_templates"
down_revision = "0012_wear_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "condition_templates",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("conditions", postgresql.JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_condition_templates_owner", "condition_templates", ["owner_id", "deleted_at"]
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM condition_templates)")).scalar():
        raise RuntimeError("Templates exist; restore the matching pre-upgrade recovery point")
    op.drop_table("condition_templates")
