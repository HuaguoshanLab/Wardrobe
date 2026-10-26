from alembic import command
from alembic.config import Config

from app.agent.checkpoints import setup_checkpoints
from app.services.seed import seed_demo


def main() -> None:
    command.upgrade(Config("alembic.ini"), "head")
    setup_checkpoints()
    seed_demo()


if __name__ == "__main__":
    main()
