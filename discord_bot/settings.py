"""Self-contained settings for discord_bot/, mirroring core_config/settings.py's
_resolve() pattern (env var, then YAML, then default) but deliberately NOT
importing core_config -- this bot is an independently deployable unit that
shouldn't depend on the main backend's package, same reasoning as
rules_mcp/settings.py (see root CLAUDE.md)."""

import os
from pathlib import Path
from typing import Any

import yaml

BOT_ROOT = Path(__file__).resolve().parent
BOT_CONFIG_FILE = Path(os.getenv("BOT_CONFIG_FILE", BOT_ROOT / "bot_config.yml"))


def _load_bot_config() -> dict[str, Any]:
    if not BOT_CONFIG_FILE.exists():
        return {}
    with open(BOT_CONFIG_FILE, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Expected mapping at top level of {BOT_CONFIG_FILE}, got {type(data).__name__}")
    return data


def _parse_int_list(value: Any) -> list[int]:
    if isinstance(value, list):
        return [int(item) for item in value]
    if isinstance(value, str):
        return [int(item.strip()) for item in value.split(",") if item.strip()]
    return []


def _get_nested(data: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = data
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _coerce(value: Any, caster: type | None) -> Any:
    if caster is None:
        return value
    return caster(value)


def _resolve(
    config_data: dict[str, Any],
    env_name: str,
    yaml_path: tuple[str, ...],
    default: Any,
    caster: type | None = None,
) -> Any:
    env_value = os.getenv(env_name)
    if env_value is not None:
        return _coerce(env_value, caster)

    yaml_value = _get_nested(config_data, yaml_path)
    if yaml_value is not None:
        return _coerce(yaml_value, caster)

    return default


_CONFIG = _load_bot_config()


class Settings:
    DISCORD_BOT_TOKEN = _resolve(_CONFIG, "DISCORD_BOT_TOKEN", ("discord", "bot_token"), None)
    API_BASE_URL = _resolve(
        _CONFIG, "API_BASE_URL", ("discord", "api_base_url"), "http://localhost:8000"
    )
    # The backend's dedicated key for this bot -- a real server-side secret,
    # unlike the PWA's keyless anonymous-tier traffic (see root CLAUDE.md /
    # app_api/main.py's _authenticate()).
    API_KEY = _resolve(_CONFIG, "API_KEY", ("discord", "api_key"), None)
    ALLOWED_GUILD_IDS = _resolve(
        _CONFIG, "ALLOWED_GUILD_IDS", ("discord", "allowed_guild_ids"), [], _parse_int_list
    )
    COOLDOWN_SECONDS = _resolve(
        _CONFIG, "COOLDOWN_SECONDS", ("discord", "cooldown_seconds"), 10, float
    )
