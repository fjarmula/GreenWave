"""Write ``frontend/src/data/stations.snapshot.json`` from ``stations.parquet``.

The dashboard's mock transport (no backend) ranks stations by straight-line distance from this
committed snapshot. Regenerating it is a manual step after ``run_etl.py places``:

    uv run python scripts/export_station_snapshot.py

It lists every station in ``stations.parquet`` (the ETL already dropped off-network ones), sorted by
``station_id``, as a ``StationsResponse``.
"""

import json
from pathlib import Path

import polars as pl

from greenwave.artifacts import STATIONS_FILENAME
from greenwave.dataset import DatasetSettings
from greenwave.routing.station_ranking import station_from_row
from greenwave.schemas import StationsResponse

OUTPUT_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "stations.snapshot.json"
)


def export_snapshot(stations_path: Path, output_path: Path) -> StationsResponse:
    frame = pl.read_parquet(stations_path).sort("station_id")
    snapshot = StationsResponse(
        schema_version="1.0",
        stations=[station_from_row(row) for row in frame.iter_rows(named=True)],
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(snapshot.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return snapshot


def main() -> None:
    snapshot = export_snapshot(DatasetSettings().processed_dir / STATIONS_FILENAME, OUTPUT_PATH)
    print(f"wrote {OUTPUT_PATH} ({len(snapshot.stations)} stations)")


if __name__ == "__main__":
    main()
