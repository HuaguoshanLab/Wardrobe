import json
from pathlib import Path

from app.api.jobs import EVENT_SCHEMA
from app.main import app


def main() -> None:
    document = app.openapi()
    event = EVENT_SCHEMA.model_json_schema(ref_template="#/components/schemas/{model}")
    document["components"]["schemas"].update(event.pop("$defs", {}))
    document["components"]["schemas"]["EventView"] = event
    Path("openapi.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
