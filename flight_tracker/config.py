"""Environment configuration. Values are read lazily so that commands which
don't need a given credential (e.g. `add-route` doesn't need SMTP) don't
fail just because that credential isn't set.
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent.parent


class MissingConfig(RuntimeError):
    pass


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise MissingConfig(f"Missing required environment variable: {name}")
    return value


def firebase_service_account() -> dict:
    """Full service-account JSON key content, pasted as one env var — see
    SETUP.md. Using the whole JSON (rather than splitting into separate
    project_id/client_email/private_key vars) avoids the private key's
    embedded newlines getting mangled by env var storage.
    """
    raw = _require("FIREBASE_SERVICE_ACCOUNT_JSON")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MissingConfig(f"FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: {exc}") from exc


def serpapi_key() -> str:
    return _require("SERPAPI_KEY")


FLIGHT_PROVIDERS = ("fast_flights", "serpapi")


def flight_provider() -> str:
    """Which flight-price source route_tracking.py uses by default —
    'fast_flights' (scrapes Google Flights directly, no paid quota) or
    'serpapi' (original provider, ~250 free searches/month). See
    flight_provider.py: fast_flights still falls back to serpapi per-search
    on failure or for round-trip (not implemented there yet), regardless of
    this setting.
    """
    # `or` (not `.get(name, default)`) because GitHub Actions injects an
    # empty-string env var for an unset repo `vars.*` reference rather than
    # omitting it — see .github/workflows/price-check.yml.
    value = (os.environ.get("FLIGHT_PROVIDER") or "fast_flights").strip().lower()
    if value not in FLIGHT_PROVIDERS:
        raise MissingConfig(f"FLIGHT_PROVIDER must be one of {FLIGHT_PROVIDERS}, got: {value!r}")
    return value


def gemini_api_key() -> str:
    return _require("GEMINI_API_KEY")


def gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")


def smtp_config() -> dict:
    return {
        "host": _require("SMTP_HOST"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": _require("SMTP_USER"),
        "password": _require("SMTP_PASSWORD"),
        "from_addr": os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_USER"),
        "to_addr": _require("EMAIL_TO"),
    }
