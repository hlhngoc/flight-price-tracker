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
