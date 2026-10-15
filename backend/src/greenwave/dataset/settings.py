"""Where the server finds the processed data. Override with environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# settings.py -> dataset -> greenwave -> src -> backend
BACKEND_ROOT = Path(__file__).resolve().parents[3]


class DatasetSettings(BaseSettings):
    """``GREENWAVE_PROCESSED_DIR`` and ``GREENWAVE_RAW_MANIFEST_PATH`` override the defaults."""

    model_config = SettingsConfigDict(env_prefix="GREENWAVE_")

    processed_dir: Path = BACKEND_ROOT / "data" / "processed"
    raw_manifest_path: Path = BACKEND_ROOT / "data" / "raw" / "MANIFEST.json"
