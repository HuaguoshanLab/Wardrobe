"""Generate synthetic Excel files for the isolated import flow audit."""

import io
import sys
from pathlib import Path

from openpyxl import load_workbook

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
from app.media.excel import template
from app.media.import_columns import FIELDS

output = root / "data/acceptance/import-audit/fixtures"
output.mkdir(parents=True, exist_ok=True)
for name, values in {
    "valid": {
        "category": "鞋",
        "subtype_name": "休闲鞋",
        "price": "19.9000",
        "source": "获赠",
    },
    "invalid": {"category": "鞋", "price": -1, "fit": "猜测合身"},
    "formula": {"price": "=1+2"},
}.items():
    book = load_workbook(io.BytesIO(template()))
    for field, value in values.items():
        book["garments"].cell(2, FIELDS.index(field) + 1, value)
    book.save(output / f"{name}.xlsx")
