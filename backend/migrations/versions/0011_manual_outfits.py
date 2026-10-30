"""Allow manual snapshots without synthetic sessions, jobs or providers."""

import sqlalchemy as sa
from alembic import op

revision = "0011_manual_outfits"
down_revision = "0010_seasonal"
branch_labels = None
depends_on = None

SOURCE_CHECK = (
    "(source = 'generated' AND session_id IS NOT NULL AND run_id IS NOT NULL "
    "AND provider_mode IS NOT NULL) OR (source = 'manual' AND session_id IS NULL "
    "AND run_id IS NULL AND provider_mode IS NULL)"
)


def upgrade() -> None:
    op.add_column(
        "outfit_revisions",
        sa.Column("source", sa.String(), nullable=False, server_default="generated"),
    )
    for name in ["session_id", "run_id", "provider_mode"]:
        op.alter_column("outfit_revisions", name, nullable=True)
    op.create_check_constraint("ck_outfit_revision_source", "outfit_revisions", SOURCE_CHECK)


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM outfit_revisions WHERE source = 'manual')")
    ).scalar():
        raise RuntimeError("Manual outfits exist; use the matching pre-upgrade recovery point")
    op.drop_constraint("ck_outfit_revision_source", "outfit_revisions", type_="check")
    for name in ["session_id", "run_id", "provider_mode"]:
        op.alter_column("outfit_revisions", name, nullable=False)
    op.drop_column("outfit_revisions", "source")
