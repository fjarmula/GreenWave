"""A minimal .xlsx writer (zip of SpreadsheetML parts) and PRM roster rows for tests."""

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from greenwave.etl.prm_roster import ADDRESS_SHEET, ROSTER_SHEET

_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
_NUMBER = re.compile(r"^\d+$")


def write_xlsx(
    path: Path,
    sheets: dict[str, list[dict[str, str]]],
    *,
    inline_strings: bool = False,
    rich_text: bool = False,
) -> Path:
    """One worksheet per entry, rows keyed by column letter (row numbers from 1).

    Digit-only values are written as numeric cells, the rest as shared strings (or inline strings
    with ``inline_strings``), like the published plan file. ``rich_text`` splits each shared
    string into two formatting runs, as the plan file's headers are.
    """
    shared: list[str] = []
    parts: dict[str, str] = {}
    sheet_entries: list[str] = []
    rels: list[str] = []
    for number, (name, rows) in enumerate(sheets.items(), start=1):
        xml_rows: list[str] = []
        for r, row in enumerate(rows, start=1):
            cells: list[str] = []
            for column, value in row.items():
                ref = f"{column}{r}"
                if _NUMBER.match(value):
                    cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                elif inline_strings:
                    cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
                else:
                    shared.append(value)
                    cells.append(f'<c r="{ref}" t="s"><v>{len(shared) - 1}</v></c>')
            xml_rows.append(f'<row r="{r}">{"".join(cells)}</row>')
        parts[f"xl/worksheets/sheet{number}.xml"] = (
            f'<worksheet xmlns="{_MAIN}"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
        )
        sheet_entries.append(
            f'<sheet name="{escape(name)}" sheetId="{number}" r:id="rId{number}"/>'
        )
        rels.append(
            f'<Relationship Id="rId{number}" Type="{_REL}/worksheet" '
            f'Target="worksheets/sheet{number}.xml"/>'
        )
    rels.append(f'<Relationship Id="rIdS" Type="{_REL}/sharedStrings" Target="sharedStrings.xml"/>')
    parts["xl/workbook.xml"] = (
        f'<workbook xmlns="{_MAIN}" xmlns:r="{_REL}"><sheets>{"".join(sheet_entries)}</sheets>'
        "</workbook>"
    )
    parts["xl/_rels/workbook.xml.rels"] = (
        f'<Relationships xmlns="{_PKG}">{"".join(rels)}</Relationships>'
    )

    def item(text: str) -> str:
        if not rich_text:
            return f"<si><t>{escape(text)}</t></si>"
        half = len(text) // 2
        return (
            f'<si><r><t xml:space="preserve">{escape(text[:half])}</t></r>'
            f'<r><rPr><sz val="10"/></rPr><t xml:space="preserve">{escape(text[half:])}</t></r>'
            "</si>"
        )

    items = "".join(item(s) for s in shared)
    parts["xl/sharedStrings.xml"] = f'<sst xmlns="{_MAIN}">{items}</sst>'
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in parts.items():
            archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)
    return path


@dataclass(frozen=True)
class PrmTeam:
    code: str
    address: str
    type: str = "P2"
    hours: str = "00:00 - 24:00"
    area: str = "1261059"
    base_teryt: str = "1261011"
    place: str = "Kraków - Prądnik Biały"
    weekdays: str = "pon., wt., śr., czw., pt., sob., nd."
    season: tuple[str, str] = ("1 stycznia", "31 grudnia")
    region: str = "RO12/01"


def prm_sheets(
    teams: list[PrmTeam], *, roster_only: tuple[str, ...] = ()
) -> dict[str, list[dict[str, str]]]:
    """Tables 1a and 2a with a header row; codes in ``roster_only`` are left out of 2a."""
    header_1a = {"B": "Numer rejonu operacyjnego", "G": "Nazwa zespołu"}
    header_2a = {"F": "Nazwa zespołu", "K": "Adres"}
    rows_1a: list[dict[str, str]] = [header_1a]
    rows_2a: list[dict[str, str]] = [header_2a]
    for i, team in enumerate(teams):
        team_id = f"{team.base_teryt}{200 + i:03d}"
        rows_1a.append(
            {
                "A": "Małopolskie",
                "B": team.region,
                "D": "DM06-01",
                "E": team.area,
                "F": team_id,
                "G": team.code,
                "H": team.type,
                "I": team.base_teryt,
                "J": team.place,
                "K": "365/ 366 - lata przestępne",
                "L": "24",
                "M": team.weekdays,
                "N": team.hours,
                "O": team.season[0],
                "P": team.season[1],
            }
        )
        if team.code not in roster_only:
            rows_2a.append(
                {
                    "E": team_id,
                    "F": team.code,
                    "G": team.type,
                    "H": team.base_teryt,
                    "K": team.address,
                    "L": "Operator",
                }
            )
    return {ROSTER_SHEET: rows_1a, ADDRESS_SHEET: rows_2a}
