// Port of flight_tracker/airports.py — keep the alias list in sync with
// that file if you add cities.

const ALIASES: Record<string, string> = {
  "ha noi": "HAN",
  hanoi: "HAN",
  "ho chi minh": "SGN",
  "sai gon": "SGN",
  tphcm: "SGN",
  hcmc: "SGN",
  "tp hcm": "SGN",
  "da nang": "DAD",
  "phu quoc": "PQC",
  "nha trang": "CXR",
  "cam ranh": "CXR",
  "da lat": "DLI",
  hue: "HUI",
  "quy nhon": "UIH",
  "buon ma thuot": "BMV",
  vinh: "VII",
  "hai phong": "HPH",
  "con dao": "VCS",
  "can tho": "VCA",
  pleiku: "PXU",
  "dien bien": "DIN",
  "chu lai": "VCL",
  "rach gia": "VKG",
  "ca mau": "CAH",
  "thanh hoa": "THD",
};

// Canonical Vietnamese display name per code, for showing the user a
// "did you mean <city>?" confirmation after resolving their input. Not
// derived from ALIASES since that dict is many-keys-to-one-code (e.g.
// "ho chi minh"/"sai gon"/"tphcm" all -> SGN) and its keys are already
// de-accented/normalized, so a naive inversion would pick an arbitrary,
// non-Vietnamese-formatted label.
const CODE_TO_CITY_NAME: Record<string, string> = {
  HAN: "Hà Nội",
  SGN: "TP. Hồ Chí Minh",
  DAD: "Đà Nẵng",
  PQC: "Phú Quốc",
  CXR: "Nha Trang",
  DLI: "Đà Lạt",
  HUI: "Huế",
  UIH: "Quy Nhơn",
  BMV: "Buôn Ma Thuột",
  VII: "Vinh",
  HPH: "Hải Phòng",
  VCS: "Côn Đảo",
  VCA: "Cần Thơ",
  PXU: "Pleiku",
  DIN: "Điện Biên",
  VCL: "Chu Lai",
  VKG: "Rạch Giá",
  CAH: "Cà Mau",
  THD: "Thanh Hóa",
};

// Human-readable Vietnamese city name for a known IATA code, or undefined if
// the code isn't one of the cities we have an alias for (e.g. a raw code
// the user typed directly that isn't in our city list).
export function cityNameForCode(code: string): string | undefined {
  return CODE_TO_CITY_NAME[code.trim().toUpperCase()];
}

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(text: string): string {
  const noD = text.replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  return noD.normalize("NFD").replace(COMBINING_DIACRITICS, "").trim();
}

export function resolveAirportCode(text: string): string {
  const stripped = text.trim();
  const normalized = normalize(stripped);
  if (normalized in ALIASES) {
    return ALIASES[normalized];
  }
  if (stripped.length === 3 && /^[A-Za-z]+$/.test(stripped)) {
    return stripped.toUpperCase();
  }

  // Heuristic: the input may be a free-text venue/location description
  // ("Sun World Ba Na Hills, Da Nang") — look for a known city as a
  // substring instead of requiring an exact match.
  const matches = new Set<string>();
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (normalized.includes(alias)) matches.add(code);
  }
  if (matches.size === 1) {
    return [...matches][0];
  }
  if (matches.size > 1) {
    throw new Error(
      `Không xác định được sân bay duy nhất từ '${text}' (khớp nhiều: ${[...matches].join(", ")}). ` +
        "Hãy chỉ định rõ bằng mã IATA (VD: DAD)."
    );
  }
  throw new Error(
    `Không nhận diện được địa điểm '${text}'. Hãy dùng mã sân bay IATA (VD: HAN, SGN, DAD).`
  );
}
