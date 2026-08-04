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

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(text: string): string {
  const noD = text.replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  return noD.normalize("NFD").replace(COMBINING_DIACRITICS, "").trim();
}

export function resolveAirportCode(text: string): string {
  const stripped = text.trim();
  if (stripped.length === 3 && /^[A-Z]+$/.test(stripped)) {
    return stripped;
  }

  const normalized = normalize(stripped);
  if (normalized in ALIASES) {
    return ALIASES[normalized];
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
