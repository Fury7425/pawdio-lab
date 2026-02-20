from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict

import tkinter as tk

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


def apply_theme(theme: ThemeConfig, root: tk.Misc | None = None) -> None:
    """Apply theme values to CustomTkinter."""

    appearance = _normalise_appearance(theme.appearance_mode)
    accent = _normalise_accent(theme.accent)

    accent_file = ACCENT_FILES.get(accent)
    if accent_file and accent_file.exists():
        ctk.set_default_color_theme(str(accent_file))
    else:
        ctk.set_default_color_theme("dark-blue")

    ctk.set_appearance_mode(appearance)

    if root is not None:
        _refresh_widget_tree(root)


def _refresh_widget_tree(widget: tk.Misc) -> None:
    """Recursively refresh widget colors from the active theme."""

    if not hasattr(widget, "configure"):
        return

    supported_options = _configurable_options(widget)

    theme_values: dict[str, object] = {}
    for cls in widget.__class__.__mro__:
        name = getattr(cls, "__name__", None)
        if not name:
            continue
        if name in ctk.ThemeManager.theme:
            theme_values = ctk.ThemeManager.theme.get(name, {})
            break
    for option, value in theme_values.items():
        if option in {"macOS", "Windows", "Linux"}:
            continue
        if "color" not in option:
            continue
        if option not in supported_options:
            continue
        try:
            widget.configure(**{option: value})
        except (tk.TclError, AttributeError, TypeError):
            continue

    # CTkScrollableFrame nests content inside ``scrollable_frame``
    child_containers = list(widget.winfo_children())
    if hasattr(widget, "scrollable_frame"):
        child_containers.append(widget.scrollable_frame)

    for child in child_containers:
        if isinstance(child, tk.Misc):
            _refresh_widget_tree(child)


def _configurable_options(widget: tk.Misc) -> set[str]:
    """Return the configuration option names accepted by the widget."""

    try:
        config = widget.configure()
    except Exception:  # pragma: no cover - defensive guard
        return set()

    if isinstance(config, dict):
        return set(config.keys())

    options: set[str] = set()
    if isinstance(config, (tuple, list)):
        for item in config:
            if isinstance(item, (tuple, list)) and item:
                key = item[0]
                if isinstance(key, str):
                    options.add(key)
    return options


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
