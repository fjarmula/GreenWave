import zipfile
from pathlib import Path

import pytest

from greenwave.etl.xlsx_reader import XlsxError, read_sheet
from tests.support.xlsx_fixtures import write_xlsx


def test_reads_shared_and_inline_strings(tmp_path: Path) -> None:
    rows = [{"A": "Nazwa zespołu", "B": "1261011"}]
    shared = write_xlsx(tmp_path / "shared.xlsx", {"S": rows}, rich_text=True)
    inline = write_xlsx(tmp_path / "inline.xlsx", {"S": rows}, inline_strings=True)

    assert read_sheet(shared, "S") == [{"A": "Nazwa zespołu", "B": "1261011"}]
    assert read_sheet(inline, "S") == [{"A": "Nazwa zespołu", "B": "1261011"}]


def test_reads_the_named_sheet(tmp_path: Path) -> None:
    path = write_xlsx(tmp_path / "w.xlsx", {"One": [{"A": "first"}], "Two": [{"A": "second"}]})

    assert read_sheet(path, "Two") == [{"A": "second"}]


def test_skips_empty_cells(tmp_path: Path) -> None:
    path = write_xlsx(tmp_path / "w.xlsx", {"S": [{"A": "x", "B": "", "C": "  "}, {"A": " "}]})

    assert read_sheet(path, "S") == [{"A": "x"}]


def test_collapses_whitespace(tmp_path: Path) -> None:
    path = write_xlsx(tmp_path / "w.xlsx", {"S": [{"A": "  Kraków -\n  Podgórze  "}]})

    assert read_sheet(path, "S") == [{"A": "Kraków - Podgórze"}]


def test_rejects_doctype(tmp_path: Path) -> None:
    path = write_xlsx(tmp_path / "w.xlsx", {"S": [{"A": "x"}]})
    hostile = tmp_path / "hostile.xlsx"
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(hostile, "w") as target:
        for name in source.namelist():
            data = source.read(name)
            if name == "xl/sharedStrings.xml":
                data = data.replace(b"<sst", b'<!DOCTYPE sst [<!ENTITY a "b">]><sst', 1)
            target.writestr(name, data)

    with pytest.raises(XlsxError, match="DOCTYPE"):
        read_sheet(hostile, "S")


def test_missing_sheet_raises(tmp_path: Path) -> None:
    path = write_xlsx(tmp_path / "w.xlsx", {"S": [{"A": "x"}]})

    with pytest.raises(XlsxError, match="Tabela nr 9"):
        read_sheet(path, "Tabela nr 9")


def test_not_a_workbook_raises(tmp_path: Path) -> None:
    path = tmp_path / "w.xlsx"
    path.write_bytes(b"not a zip")

    with pytest.raises(XlsxError):
        read_sheet(path, "S")
