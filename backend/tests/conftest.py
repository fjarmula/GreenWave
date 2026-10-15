"""Make the shared ETL fixture modules (``osm_fixtures``, ``pipeline_fixtures``) importable
from every test directory, not only from ``tests/etl`` (pytest adds a test file's own directory)."""

import sys
from pathlib import Path

_ETL_TESTS = str(Path(__file__).parent / "etl")
if _ETL_TESTS not in sys.path:
    sys.path.insert(0, _ETL_TESTS)
