"""Garment lifecycle, optional profile, stable subtype references and event ledger."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007_lifecycle"
down_revision = "0006_recognition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "garment_subtypes",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.UniqueConstraint("category", "name"),
    )
    op.add_column(
        "garments", sa.Column("lifecycle", postgresql.JSONB(), nullable=False, server_default="{}")
    )
    op.add_column(
        "garments", sa.Column("ownership", sa.String(), nullable=False, server_default="owned")
    )
    op.add_column(
        "garments", sa.Column("subtype_id", sa.UUID(), sa.ForeignKey("garment_subtypes.id"))
    )
    op.create_table(
        "garment_events",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("garment_id", sa.UUID(), sa.ForeignKey("garments.id"), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("related_event_id", sa.UUID(), sa.ForeignKey("garment_events.id")),
        sa.Column("before", postgresql.JSONB(), nullable=False),
        sa.Column("after", postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint("garment_id", "version"),
    )
    op.create_index("ix_garment_events_garment_id", "garment_events", ["garment_id"])


def downgrade() -> None:
    op.drop_table("garment_events")
    op.drop_column("garments", "subtype_id")
    op.drop_column("garments", "ownership")
    op.drop_column("garments", "lifecycle")
    op.drop_table("garment_subtypes")
