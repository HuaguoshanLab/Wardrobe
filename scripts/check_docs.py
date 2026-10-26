"""Validate repository Markdown links without traversing installed dependencies."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
files = [*ROOT.glob("*.md"), *ROOT.glob("frontend/*.md"), *ROOT.glob("backend/*.md"),
         *ROOT.glob("docs/**/*.md")]
links = 0
for path in files:
    text = path.read_text()
    assert len(re.findall(r"^```", text, re.M)) % 2 == 0, path
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        if re.match(r"\w+://", target):
            continue
        target = target.split("#")[0]
        if target:
            assert (path.parent / target).exists(), (path, target)
        links += 1
    for block in re.findall(r"```json\n(.*?)\n```", text, re.S):
        json.loads(block)
print(f"PASS: {len(files)} Markdown documents, {links} local links")
