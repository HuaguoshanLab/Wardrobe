"""Supply plans, immutable fulfillment links and reason-specific organization decisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009_organization"
down_revision = "0008_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supply_plans",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("budget", sa.String()),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("cancelled_quantity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "supply_sources",
        sa.Column("plan_id", sa.UUID(), sa.ForeignKey("supply_plans.id"), primary_key=True),
        sa.Column("demand_id", sa.UUID(), sa.ForeignKey("inventory_demands.id"), primary_key=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
    )
    op.create_table(
        "supply_links",
        sa.Column("plan_id", sa.UUID(), sa.ForeignKey("supply_plans.id"), primary_key=True),
        sa.Column("garment_id", sa.UUID(), sa.ForeignKey("garments.id"), primary_key=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("garment_id"),
    )
    op.create_table(
        "organization_decisions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("garment_id", sa.UUID(), sa.ForeignKey("garments.id"), nullable=False),
        sa.Column("reason_key", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("garment_id", "reason_key"),
    )
    op.create_index(
        "ix_organization_decisions_garment_id", "organization_decisions", ["garment_id"]
    )


def downgrade() -> None:
    for name in ["organization_decisions", "supply_links", "supply_sources", "supply_plans"]:
        op.drop_table(name)
