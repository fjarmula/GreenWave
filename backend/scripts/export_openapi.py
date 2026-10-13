"""Write the FastAPI OpenAPI document to ``contracts/openapi.json`` (repo root).

That file is the input for frontend type generation (``npm run generate:types``)
and is committed so CI can detect contract drift.
"""

import json
from pathlib import Path

from greenwave.main import app

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
