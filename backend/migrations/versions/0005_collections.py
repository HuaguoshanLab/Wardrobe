"""History visibility, favorites and actual wear records."""

import sqlalchemy as sa
from alembic import op

revision = "0005_collections"
down_revision = "0004_outfits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "outfit_revisions", sa.Column("hidden_from_history_at", sa.DateTime(timezone=True))
    )
    op.add_column(
        "outfit_revisions",
        sa.Column("history_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_table(
        "favorites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "revision_id",
            sa.Uuid(),
            sa.ForeignKey("outfit_revisions.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "wear_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("outfit_revisions.id"), nullable=False),
        sa.Column("worn_on", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("revision_id", "worn_on"),
    )


def downgrade() -> None:
    op.drop_table("wear_records")
    op.drop_table("favorites")
    op.drop_column("outfit_revisions", "history_version")
    op.drop_column("outfit_revisions", "hidden_from_history_at")
