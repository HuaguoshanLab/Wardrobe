"""P4 sessions, immutable results and durable model call ledger."""

from alembic import op

revision = "0004_outfits"
down_revision = "0003_weather_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE outfit_sessions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	requirements JSONB NOT NULL, 
	selected_revision_id UUID, 
	locked_garment_ids JSONB NOT NULL, 
	current_job_id UUID, 
	latest_revision_ids JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(current_job_id) REFERENCES jobs (id)
)""")
    op.execute("""CREATE TABLE outfit_revisions (
	id UUID NOT NULL, 
	session_id UUID NOT NULL, 
	parent_revision_id UUID, 
	run_id UUID NOT NULL, 
	position INTEGER NOT NULL, 
	items JSONB NOT NULL, 
	reason VARCHAR NOT NULL, 
	unmet_requirements JSONB NOT NULL, 
	weather_snapshot JSONB NOT NULL, 
	request_snapshot JSONB NOT NULL, 
	provider_mode VARCHAR NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (run_id, position), 
	FOREIGN KEY(session_id) REFERENCES outfit_sessions (id), 
	FOREIGN KEY(parent_revision_id) REFERENCES outfit_revisions (id), 
	FOREIGN KEY(run_id) REFERENCES jobs (id)
)""")
    op.execute("""CREATE TABLE outfit_messages (
	id UUID NOT NULL, 
	session_id UUID NOT NULL, 
	role VARCHAR NOT NULL, 
	content VARCHAR NOT NULL, 
	job_id UUID, 
	revision_ids JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (job_id, role), 
	FOREIGN KEY(session_id) REFERENCES outfit_sessions (id), 
	FOREIGN KEY(job_id) REFERENCES jobs (id)
)""")
    op.execute("""CREATE TABLE outfit_images (
	id UUID NOT NULL, 
	media_asset_id UUID NOT NULL, 
	storage_key VARCHAR NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(media_asset_id) REFERENCES media_assets (id)
)""")
    op.execute("""CREATE TABLE outfit_model_calls (
	job_id UUID NOT NULL, 
	step VARCHAR NOT NULL, 
	attempt INTEGER NOT NULL, 
	state VARCHAR NOT NULL, 
	response JSONB, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (job_id, step, attempt), 
	FOREIGN KEY(job_id) REFERENCES jobs (id)
)""")
    op.execute(
        "ALTER TABLE profiles ADD COLUMN current_session_id UUID REFERENCES outfit_sessions(id)"
    )


def downgrade() -> None:
    op.drop_column("profiles", "current_session_id")
    op.drop_table("outfit_model_calls")
    op.drop_table("outfit_images")
    op.drop_table("outfit_messages")
    op.drop_table("outfit_revisions")
    op.drop_table("outfit_sessions")
