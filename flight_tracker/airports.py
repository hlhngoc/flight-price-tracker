"""Best-effort mapping from Vietnamese city/place names to IATA airport
codes, so users can type "Đà Nẵng" instead of "DAD" when entering an event.
"""
import unicodedata

_ALIASES: dict[str, str] = {
    "ha noi": "HAN", "hanoi": "HAN",
    "ho chi minh": "SGN", "sai gon": "SGN", "tphcm": "SGN", "hcmc": "SGN", "tp hcm": "SGN",
    "da nang": "DAD",
    "phu quoc": "PQC",
    "nha trang": "CXR", "cam ranh": "CXR",
    "da lat": "DLI",
    "hue": "HUI",
    "quy nhon": "UIH",
    "buon ma thuot": "BMV",
    "vinh": "VII",
    "hai phong": "HPH",
    "con dao": "VCS",
    "can tho": "VCA",
    "pleiku": "PXU",
    "dien bien": "DIN",
    "chu lai": "VCL",
    "rach gia": "VKG",
    "ca mau": "CAH",
    "thanh hoa": "THD",
}


# Canonical Vietnamese display name per code, for showing the user a
# "did you mean <city>?" confirmation after resolving their input. Not
# derived from _ALIASES since that dict is many-keys-to-one-code (e.g.
# "ho chi minh"/"sai gon"/"tphcm" all -> SGN) and its keys are already
# de-accented/normalized, so a naive inversion would pick an arbitrary,
# non-Vietnamese-formatted label.
_CODE_TO_CITY_NAME: dict[str, str] = {
    "HAN": "Hà Nội",
    "SGN": "TP. Hồ Chí Minh",
    "DAD": "Đà Nẵng",
    "PQC": "Phú Quốc",
    "CXR": "Nha Trang",
    "DLI": "Đà Lạt",
    "HUI": "Huế",
    "UIH": "Quy Nhơn",
    "BMV": "Buôn Ma Thuột",
    "VII": "Vinh",
    "HPH": "Hải Phòng",
    "VCS": "Côn Đảo",
    "VCA": "Cần Thơ",
    "PXU": "Pleiku",
    "DIN": "Điện Biên",
    "VCL": "Chu Lai",
    "VKG": "Rạch Giá",
    "CAH": "Cà Mau",
    "THD": "Thanh Hóa",
}


def city_name_for_code(code: str) -> str | None:
    """Human-readable Vietnamese city name for a known IATA code, or None if
    the code isn't one of the cities we have an alias for (e.g. a raw code
    the user typed directly that isn't in our city list).
    """
    return _CODE_TO_CITY_NAME.get(code.strip().upper())


def _normalize(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.strip()


def resolve_airport_code(text: str) -> str:
    """Resolve a city/place name (or an already-valid 3-letter IATA code) to
    an IATA airport code. Raises ValueError if nothing matches.
    """
    stripped = text.strip()
    normalized = _normalize(stripped)
    if normalized in _ALIASES:
        return _ALIASES[normalized]
    if len(stripped) == 3 and stripped.isalpha():
        return stripped.upper()

    # Heuristic: the input may be a free-text venue/location description
    # ("Sun World Ba Na Hills, Da Nang") — look for a known city as a
    # substring instead of requiring an exact match.
    matches = {code for alias, code in _ALIASES.items() if alias in normalized}
    if len(matches) == 1:
        return matches.pop()
    if len(matches) > 1:
        raise ValueError(
            f"Không xác định được sân bay duy nhất từ '{text}' (khớp nhiều: {matches}). "
            "Hãy chỉ định rõ bằng mã IATA (VD: DAD)."
        )
    raise ValueError(
        f"Không nhận diện được địa điểm '{text}'. Hãy dùng mã sân bay IATA (VD: HAN, SGN, DAD)."
    )
