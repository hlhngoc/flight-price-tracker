"""Environment configuration. Values are read lazily so that commands which
don't need a given credential (e.g. `add-route` doesn't need SMTP) don't
fail just because that credential isn't set.
"""
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


def db_path() -> str:
    return os.environ.get("DB_PATH", str(REPO_ROOT / "flight_tracker.db"))


def serpapi_key() -> str:
    return _require("SERPAPI_KEY")


def deepseek_key() -> str:
    return _require("DEEPSEEK_API_KEY")


def deepseek_model() -> str:
    return os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")


def deepseek_base_url() -> str:
    return os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def smtp_config() -> dict:
    return {
        "host": _require("SMTP_HOST"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": _require("SMTP_USER"),
        "password": _require("SMTP_PASSWORD"),
        "from_addr": os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_USER"),
        "to_addr": _require("EMAIL_TO"),
    }
