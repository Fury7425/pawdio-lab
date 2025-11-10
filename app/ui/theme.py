from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict

import customtkinter as ctk

THEME_DIR = Path(__file__).resolve().parent / "themes"
CONFIG_PATH = Path.home() / ".pawdiolab" / "theme.json"

ACCENT_FILES: Dict[str, Path] = {
    "greyscale": THEME_DIR / "greyscale.json",
    "blue": THEME_DIR / "blue.json",
    "teal": THEME_DIR / "teal.json",
    "purple": THEME_DIR / "purple.json",
}


@dataclass
class ThemeConfig:
    appearance_mode: str = "Dark"
    accent: str = "greyscale"


DEFAULT_THEME = ThemeConfig()


def _normalise_appearance(value: str | None) -> str:
    if not value:
        return DEFAULT_THEME.appearance_mode
    value = value.strip().lower()
    if value == "light":
        return "Light"
    if value == "system":
        return "System"
    return "Dark"


def _normalise_accent(value: str | None) -> str:
    if not value:
        return DEFAULT_THEME.accent
    key = value.strip().lower()
    return key if key in ACCENT_FILES else DEFAULT_THEME.accent


def load_theme_config(path: Path | None = None) -> ThemeConfig:
    """Load the persisted theme configuration."""

    cfg_path = Path(path) if path else CONFIG_PATH
    try:
        with cfg_path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return ThemeConfig()
    except Exception:
        return ThemeConfig()

    appearance = _normalise_appearance(data.get("appearance_mode"))
    accent = _normalise_accent(data.get("accent") or data.get("color_theme"))
    return ThemeConfig(appearance_mode=appearance, accent=accent)


def save_theme_config(theme: ThemeConfig, path: Path | None = None) -> None:
    cfg_path = Path(path) if path else CONFIG_PATH
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with cfg_path.open("w", encoding="utf-8") as fh:
        json.dump(asdict(theme), fh, indent=2)


def apply_theme(theme: ThemeConfig) -> None:
    """Apply theme values to CustomTkinter."""

    appearance = _normalise_appearance(theme.appearance_mode)
    accent = _normalise_accent(theme.accent)

    accent_file = ACCENT_FILES.get(accent)
    if accent_file and accent_file.exists():
        ctk.set_default_color_theme(str(accent_file))
    else:
        ctk.set_default_color_theme("dark-blue")

    ctk.set_appearance_mode(appearance)


def available_accents() -> Dict[str, str]:
    """Return machine -> human readable accent names."""

    return {
        "greyscale": "Greyscale (default)",
        "blue": "Blue",
        "teal": "Teal",
        "purple": "Purple",
    }


def theme_from_legacy(ui_config: dict | None) -> ThemeConfig:
    """Translate older config dictionaries into ThemeConfig."""

    ui_config = ui_config or {}
    appearance = _normalise_appearance(ui_config.get("appearance_mode"))
    accent = _normalise_accent(ui_config.get("accent") or ui_config.get("color_theme"))
    return ThemeConfig(appearance_mode=appearance, accent=accent)
