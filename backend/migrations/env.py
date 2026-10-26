from alembic import context

from app.db import outfits, profile, wardrobe  # noqa: F401 -- register P2 tables in Alembic metadata
from app.db.models import Base
from app.db.session import get_engine

with get_engine().connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
