.PHONY: up stop logs test structure
up:
	docker compose up -d --build --wait
stop:
	docker compose stop
logs:
	docker compose logs --tail=100 api worker
test:
	docker compose --profile test run --build --rm test
structure:
	backend/.venv/bin/python scripts/check_structure.py
	backend/.venv/bin/python scripts/check_docs.py
