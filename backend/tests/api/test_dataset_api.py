import json

from fastapi.testclient import TestClient

from greenwave.etl.quality import QUALITY_FILENAME
from greenwave.main import create_app
from tests.support.processed import Layout


def client(layout: Layout) -> TestClient:
    return TestClient(create_app(processed_dir=layout.processed, manifest_path=layout.manifest))


def test_get_dataset_quality_returns_loaded_summary(layout: Layout) -> None:
    written = json.loads((layout.processed / QUALITY_FILENAME).read_text(encoding="utf-8"))

    with client(layout) as c:
        response = c.get("/api/v1/dataset/quality")

    assert response.status_code == 200
    assert response.json() == written
    assert response.json()["is_simulated"] is True


def test_openapi_registers_dataset_quality(layout: Layout) -> None:
    with client(layout) as c:
        doc = c.get("/openapi.json").json()

    operation = doc["paths"]["/api/v1/dataset/quality"]["get"]
    assert operation["tags"] == ["dataset"]
    schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema == {"$ref": "#/components/schemas/DatasetQualityResponse"}
    assert {"QualityCheck", "QualitySource", "QualityStatus"} <= set(doc["components"]["schemas"])
