"""Read/write ``etl_report.json``. Each ETL step owns one top-level section."""

import json
from pathlib import Path

from pydantic import BaseModel

REPORT_FILENAME = "etl_report.json"


def update_report_section(report_path: Path, section: str, content: BaseModel) -> None:
    """Replace one section of the report, keeping the sections written by other steps."""
    existing: dict[str, object] = {}
    if report_path.is_file():
        loaded: object = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError(f"{report_path} does not contain a JSON object")
        existing = loaded
    existing[section] = content.model_dump(mode="json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
