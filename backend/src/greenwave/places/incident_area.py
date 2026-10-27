"""An incident's PRM operating area: the Kraków delegatura (city part) of its district.

PRM teams in Kraków are assigned to the four delegatura TERYT codes (Table 1a, column E). The
district of an incident comes from the nearest EMUiA address within ``AREA_LOOKUP_RADIUS_M``;
EMUiA covers the City of Kraków only, so outside it (or far from any address) the area is
unknown (``None``). Works for typed addresses and map clicks alike.
"""

from dataclasses import dataclass

import numpy as np
import polars as pl
import shapely

from greenwave.etl.config import AREA_LOOKUP_RADIUS_M
from greenwave.etl.geo import project_points
from greenwave.schemas import Position

# The 18 districts of Kraków by number, from the legend of the PRM plan's Table 1/1a ("WYKAZ
# DZIELNIC MIASTA KRAKOWA"), and the delegatura each belongs to (TERYT 1261xx9).
KRAKOW_DISTRICT_NAMES: dict[int, str] = {
    1: "Stare Miasto", 2: "Grzegórzki", 3: "Prądnik Czerwony", 4: "Prądnik Biały",
    5: "Krowodrza", 6: "Bronowice", 7: "Zwierzyniec", 8: "Dębniki",
    9: "Łagiewniki - Borek Fałęcki", 10: "Swoszowice", 11: "Podgórze Duchackie",
    12: "Bieżanów - Prokocim", 13: "Podgórze", 14: "Czyżyny", 15: "Mistrzejowice",
    16: "Bieńczyce", 17: "Wzgórza Krzesławickie", 18: "Nowa Huta",
}  # fmt: skip
DELEGATURA_NAMES: dict[str, str] = {
    "1261059": "Śródmieście",
    "1261029": "Krowodrza",
    "1261049": "Podgórze",
    "1261039": "Nowa Huta",
}
KRAKOW_DISTRICT_DELEGATURA: dict[int, str] = {
    **dict.fromkeys(range(1, 4), "1261059"),  # I-III Śródmieście
    **dict.fromkeys(range(4, 8), "1261029"),  # IV-VII Krowodrza
    **dict.fromkeys(range(8, 14), "1261049"),  # VIII-XIII Podgórze
    **dict.fromkeys(range(14, 19), "1261039"),  # XIV-XVIII Nowa Huta
}


@dataclass(frozen=True)
class IncidentArea:
    teryt: str  # the delegatura TERYT code teams' operating areas list
    delegatura_name: str
    district_number: int
    district_name: str


class IncidentAreaLocator:
    """Nearest EMUiA-backed address (``district_number`` set) in metres, built once at startup."""

    def __init__(self, xy: np.ndarray, districts: list[int]) -> None:
        self._tree = shapely.STRtree(shapely.points(xy)) if districts else None
        self._districts = districts

    @classmethod
    def from_addresses(cls, frame: pl.DataFrame) -> "IncidentAreaLocator":
        rows = frame.filter(pl.col("district_number").is_not_null())
        xy = project_points(
            rows["lng"].to_numpy().astype(np.float64), rows["lat"].to_numpy().astype(np.float64)
        )
        return cls(xy, [int(d) for d in rows["district_number"].to_list()])

    def locate(self, position: Position) -> IncidentArea | None:
        if self._tree is None:
            return None
        point = shapely.points(project_points(np.array([position.lng]), np.array([position.lat])))
        index, _ = self._tree.query_nearest(
            point, max_distance=AREA_LOOKUP_RADIUS_M, return_distance=True, all_matches=False
        )
        if index.shape[1] == 0:
            return None
        district = self._districts[int(index[1][0])]
        teryt = KRAKOW_DISTRICT_DELEGATURA[district]
        return IncidentArea(
            teryt, DELEGATURA_NAMES[teryt], district, KRAKOW_DISTRICT_NAMES[district]
        )
