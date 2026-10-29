"""Editable seasonal inventory and subtype lifecycle."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008_inventory"
down_revision = "0007_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "garment_subtypes",
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "garment_subtypes", sa.Column("version", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_table(
        "inventory_plans",
        sa.Column("season", sa.String(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("city", sa.String(), nullable=False),
        sa.Column("period", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
    )
    op.create_table(
        "inventory_demands",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("season", sa.String(), sa.ForeignKey("inventory_plans.season"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("spec", postgresql.JSONB(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_inventory_demands_season", "inventory_demands", ["season"])


def downgrade() -> None:
    op.drop_table("inventory_demands")
    op.drop_table("inventory_plans")
    op.drop_column("garment_subtypes", "version")
    op.drop_column("garment_subtypes", "active")
