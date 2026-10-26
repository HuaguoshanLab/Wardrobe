"""Run from any directory: file budgets and static import boundary checks."""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if sys.version_info < (3, 13):
    raise SystemExit("Use Python 3.13: backend/.venv/bin/python scripts/check_structure.py")
errors: list[str] = []
count = 0
largest: list[tuple[int, str]] = []

for base in (ROOT / "backend/app", ROOT / "backend/tests", ROOT / "frontend/src"):
    for path in base.rglob("*"):
        if path.suffix not in {".py", ".ts", ".tsx", ".css"} or "generated" in path.parts:
            continue
        count += 1
        source = path.read_text()
        relative = path.relative_to(ROOT).as_posix()
        lines = len(source.splitlines())
        largest.append((lines, relative))
        if lines > 600:
            errors.append(f"{relative}: {lines} lines, split or record a reviewed exception")
        elif lines > 400:
            print(f"REVIEW {relative}: {lines} lines")
        if path.suffix == ".py" and "backend/app/" in relative:
            layer = relative.split("/")[2]
            forbidden = {
                "domain": ("fastapi", "sqlalchemy", "psycopg", "app.api", "app.providers"),
                "repositories": ("app.api", "app.agent"),
                "providers": ("app.api", "app.agent"),
                "services": ("app.api", "app.agent"),
            }.get(layer, ())
            for node in ast.walk(ast.parse(source)):
                imports = ([node.module or ""] if isinstance(node, ast.ImportFrom)
                           else [n.name for n in node.names] if isinstance(node, ast.Import) else [])
                for name in imports:
                    if any(name == prefix or name.startswith(prefix + ".") for prefix in forbidden):
                        errors.append(f"{relative}: forbidden dependency {name}")
        if path.suffix in {".ts", ".tsx"}:
            for name in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]', source):
                if name.startswith("."):
                    target = (path.parent / name).resolve()
                elif name.startswith("@/"):
                    target = ROOT / "frontend/src" / name[2:]
                else:
                    continue
                if not target.is_relative_to(ROOT / "frontend/src"):
                    continue
                parts = target.relative_to(ROOT / "frontend/src").parts
                own = path.relative_to(ROOT / "frontend/src").parts
                if own[0] in {"lib", "components"} and parts[0] == "features":
                    errors.append(f"{relative}: shared layer depends on feature {name}")
                if (own[0] == "features" and parts[0] == "features"
                        and own[1] != parts[1] and len(parts) > 3):
                    errors.append(f"{relative}: imports another feature's private module {name}")

for lines, path in sorted(largest, reverse=True)[:5]:
    print(f"{lines:4} {path}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {count} handwritten files; static imports and file budgets checked")
