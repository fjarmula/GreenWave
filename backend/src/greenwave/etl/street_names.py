"""Street-name normalisation so OSM names can be compared with Ulice.geojson ``nazwa_ulicy``."""

import re
import unicodedata

# Honorific and rank words appear abbreviated, in full, or not at all depending on the source
# ("Generała Henryka Kamieńskiego" vs "Henryka Kamieńskiego"), so they are dropped.
_TITLE_WORDS = (
    "ul ulica im imienia ks księdza św świętego świętej gen generała płk pułkownika por porucznika "
    "ppor podporucznika rtm rotmistrza kard kardynała bp biskupa abp arcybiskupa dr doktora prof "
    "profesora mjr majora kpt kapitana hm harcmistrza marsz marszałka"
)
# Street-type words are kept (a "Plac X" is not the same street as "X") but spelled one way.
_TYPE_WORDS = {"al": "aleja", "aleje": "aleja", "pl": "plac", "os": "osiedle"}
_NON_ALNUM = re.compile(r"[^0-9a-z]+")
# NFKD does not decompose these.
_EXTRA_FOLDING = str.maketrans({"ł": "l", "Ł": "l", "ø": "o", "đ": "d"})


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.translate(_EXTRA_FOLDING).casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


_DROPPED = frozenset(_fold(word) for word in _TITLE_WORDS.split())


def normalise_street_name(name: str) -> str:
    """Case, diacritics, punctuation, honorifics and type-word spelling folded away."""
    tokens = _NON_ALNUM.sub(" ", _fold(name)).split()
    return " ".join(_TYPE_WORDS.get(token, token) for token in tokens if token not in _DROPPED)
