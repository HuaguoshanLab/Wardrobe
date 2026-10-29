from alembic import context

from app.db.registry import business_metadata
from app.db.session import get_engine

with get_engine().connect() as connection:
    context.configure(connection=connection, target_metadata=business_metadata())
    with context.begin_transaction():
        context.run_migrations()
