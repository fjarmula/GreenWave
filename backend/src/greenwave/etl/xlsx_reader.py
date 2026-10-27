"""Read one worksheet of an .xlsx file with the standard library only (``zipfile`` + ElementTree).

Enough for the PRM plan tables: shared, inline and numeric cells as text. Formulas, dates and
styles are not interpreted (a cell yields its stored value). Any part containing ``<!DOCTYPE`` is
rejected, so no entity expansion can happen.
"""

import posixpath
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_COLUMN = re.compile(r"^([A-Z]+)\d+$")
# A worksheet of the plan file is ~0.2 MB; this only stops a decompression bomb.
_MAX_PART_BYTES = 64 * 1024 * 1024


class XlsxError(ValueError):
    """The file is not a readable workbook, or lacks the requested sheet."""


def _part(archive: zipfile.ZipFile, name: str) -> ElementTree.Element:
    try:
        info = archive.getinfo(name)
    except KeyError as error:
        raise XlsxError(f"workbook has no part {name}") from error
    if info.file_size > _MAX_PART_BYTES:
        raise XlsxError(f"workbook part {name} is larger than {_MAX_PART_BYTES} bytes")
    data = archive.read(info)
    if b"<!DOCTYPE" in data.upper():
        raise XlsxError(f"workbook part {name} contains a DOCTYPE; refusing to parse it")
    try:
        return ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise XlsxError(f"workbook part {name} is not well-formed XML: {error}") from error


def _text(element: ElementTree.Element) -> str:
    """Every ``<t>`` below ``element`` joined: rich-text runs make one string."""
    return "".join(t.text or "" for t in element.iter(f"{_MAIN}t"))


def _sheet_path(archive: zipfile.ZipFile, sheet: str) -> str:
    workbook = _part(archive, "xl/workbook.xml")
    rel_id = next(
        (s.get(_REL_ID) for s in workbook.iter(f"{_MAIN}sheet") if s.get("name") == sheet), None
    )
    if rel_id is None:
        raise XlsxError(f"workbook has no sheet named {sheet!r}")
    rels = _part(archive, "xl/_rels/workbook.xml.rels")
    target = next(
        (r.get("Target") for r in rels.iter(f"{_PKG}Relationship") if r.get("Id") == rel_id),
        None,
    )
    if not target:
        raise XlsxError(f"sheet {sheet!r} has no relationship target")
    return target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    return [_text(item) for item in _part(archive, "xl/sharedStrings.xml").iter(f"{_MAIN}si")]


def _cell_text(cell: ElementTree.Element, shared: list[str]) -> str:
    kind = cell.get("t")
    if kind == "inlineStr":
        inline = cell.find(f"{_MAIN}is")
        return _text(inline) if inline is not None else ""
    value = cell.find(f"{_MAIN}v")
    raw = value.text or "" if value is not None else ""
    if kind == "s":
        try:
            return shared[int(raw)]
        except (ValueError, IndexError) as error:
            raise XlsxError(f"cell {cell.get('r')} refers to a missing shared string") from error
    return raw


def read_sheet(path: Path, sheet: str) -> list[dict[str, str]]:
    """One dict per non-empty row, keyed by column letter, values whitespace-collapsed.

    Empty and whitespace-only cells are left out; rows with no cell left are skipped.
    """
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as error:
        raise XlsxError(f"{path} is not a readable .xlsx file: {error}") from error
    with archive:
        shared = _shared_strings(archive)
        worksheet = _part(archive, _sheet_path(archive, sheet))
        rows: list[dict[str, str]] = []
        for row in worksheet.iter(f"{_MAIN}row"):
            values: dict[str, str] = {}
            for cell in row.iter(f"{_MAIN}c"):
                match = _COLUMN.match(cell.get("r") or "")
                if match is None:
                    raise XlsxError(f"sheet {sheet!r} has a cell without a reference")
                text = " ".join(_cell_text(cell, shared).split())
                if text:
                    values[match.group(1)] = text
            if values:
                rows.append(values)
        return rows
