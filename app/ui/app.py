import logging
import sys
from pathlib import Path

import tkinter as tk  # for PhotoImage on mac/linux
import customtkinter as ctk

from .theme import (
    ThemeConfig,
    apply_theme,
    load_theme_config,
    save_theme_config,
    theme_from_legacy,
)
from ..config import load_config, save_config
from ..core.audio import AudioCore
from .pages.latency_page import LatencyPage
from .pages.sweep_fr_page import SweepFRPage
from .pages.experimental_page import ExperimentalPage
from .pages.devices_page import DevicesPage
from .pages.results_page import ResultsPage

logger = logging.getLogger(__name__)

APP_TITLE = "PawdioLab"


def _icon_search_paths() -> list[Path]:
    """Return all paths where an icon might live, in order."""
    paths: list[Path] = []

    this_file = Path(__file__).resolve()
    ui_dir = this_file.parent               # app/ui
    assets_dir = ui_dir / "assets"          # app/ui/assets

    # source layout
    paths.append(assets_dir / "pawdiolab.ico")
    paths.append(assets_dir / "pawdiolab.png")
    paths.append(assets_dir / "pawdiolab.icns")

    # project root relative guesses (if someone runs from repo root)
    root_guess = ui_dir.parent.parent       # repo root (app/.. -> repo)
    paths.append(root_guess / "app" / "ui" / "assets" / "pawdiolab.ico")
    paths.append(root_guess / "app" / "ui" / "assets" / "pawdiolab.png")

    # PyInstaller bundle
    if hasattr(sys, "_MEIPASS"):
        base = Path(sys._MEIPASS)
        # try to mimic the source layout inside bundle
        paths.append(base / "app" / "ui" / "assets" / "pawdiolab.ico")
        paths.append(base / "app" / "ui" / "assets" / "pawdiolab.png")
        # or directly in the bundle root
        paths.append(base / "pawdiolab.ico")
        paths.append(base / "pawdiolab.png")

    # keep only existing
    return [p for p in paths if p.is_file()]


ICON_PATHS = _icon_search_paths()
if not ICON_PATHS:
    logger.info("Application icon not found; using default window icon")


class MainApp(ctk.CTk):
    def __init__(self):
        self.theme = load_theme_config()
        self.cfg = load_config()

        legacy_theme = theme_from_legacy(self.cfg.get("ui"))
        if self.theme == ThemeConfig() and legacy_theme != ThemeConfig():
            self.theme = legacy_theme
            save_theme_config(self.theme)

        apply_theme(self.theme)
        self.cfg.setdefault("ui", {})
        self.cfg["ui"]["appearance_mode"] = self.theme.appearance_mode
        self.cfg["ui"]["accent"] = self.theme.accent
        self.cfg["ui"]["color_theme"] = self.theme.accent

        super().__init__()

        # set icon (cross-platform)
        self._set_window_icon()

        self.title(APP_TITLE)
        self.geometry("1200x800")
        self.minsize(1060, 720)

        # layout
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.sidebar = ctk.CTkFrame(self, corner_radius=0, width=230)
        self.sidebar.grid(row=0, column=0, sticky="nsw")
        self.sidebar.grid_rowconfigure(10, weight=1)

        ctk.CTkLabel(
            self.sidebar,
            text="PawdioLab",
            font=ctk.CTkFont(size=20, weight="bold"),
        ).grid(row=0, column=0, padx=18, pady=(18, 8), sticky="w")

        self.btn_latency = ctk.CTkButton(
            self.sidebar, text="Latency", command=lambda: self._show("latency")
        )
        self.btn_latency.grid(row=2, column=0, padx=16, pady=6, sticky="ew")

        self.btn_sweep = ctk.CTkButton(
            self.sidebar, text="Sweep FR", command=lambda: self._show("sweep_fr")
        )
        self.btn_sweep.grid(row=3, column=0, padx=16, pady=6, sticky="ew")

        self.btn_devices = ctk.CTkButton(
            self.sidebar, text="Devices / Settings", command=lambda: self._show("devices")
        )
        self.btn_devices.grid(row=4, column=0, padx=16, pady=6, sticky="ew")

        self.btn_results = ctk.CTkButton(
            self.sidebar, text="Results / Export", command=lambda: self._show("results")
        )
        self.btn_results.grid(row=5, column=0, padx=16, pady=6, sticky="ew")

        self.btn_experimental = None

        self.main = ctk.CTkFrame(self, corner_radius=0)
        self.main.grid(row=0, column=1, sticky="nsew")
        self.main.grid_rowconfigure(0, weight=1)
        self.main.grid_columnconfigure(0, weight=1)

        # audio core
        self.core = AudioCore(
            sample_rate=self.cfg["last_settings"].get(
                "output_sample_rate",
                self.cfg["last_settings"].get("sample_rate", 44100),
            ),
            chunk_size=1024,
            duration=self.cfg["last_settings"]["duration"],
            output_device_index=self.cfg["last_settings"]["output_device_index"],
            input_device_index=self.cfg["last_settings"]["input_device_index"],
            input_sample_rate=self.cfg["last_settings"].get(
                "input_sample_rate",
                self.cfg["last_settings"].get("sample_rate", 44100),
            ),
        )

        # pages
        self.pages = {}
        self.pages["latency"] = LatencyPage(self.main, self.core, self.cfg, self._log)
        self.pages["sweep_fr"] = SweepFRPage(self.main, self.core, self.cfg, self._log)
        self.pages["devices"] = DevicesPage(
            self.main,
            self.core,
            self.cfg,
            self._log,
            on_toggle_experimental=self._toggle_experimental,
            theme_config=self.theme,
            on_theme_change=self._apply_new_theme,
        )
        self.pages["results"] = ResultsPage(self.main, self._log_sink)

        if self.cfg["ui"].get("labs_enabled", True):
            self._add_experimental_page()

        self._show("latency")

    def _apply_new_theme(self, theme: ThemeConfig) -> None:
        if theme == self.theme:
            return

        self.theme = theme
        apply_theme(theme)
        save_theme_config(theme)
        self.cfg.setdefault("ui", {})
        self.cfg["ui"]["appearance_mode"] = theme.appearance_mode
        self.cfg["ui"]["accent"] = theme.accent
        self.cfg["ui"]["color_theme"] = theme.accent
        save_config(self.cfg)

    def _set_window_icon(self):
        if not ICON_PATHS:
            return

        # Windows: try .ico first
        if sys.platform.startswith("win"):
            ico = next((p for p in ICON_PATHS if p.suffix.lower() == ".ico"), None)
            if ico:
                try:
                    self.iconbitmap(str(ico))
                    return
                except Exception:
                    logger.warning("Failed to set Windows icon from %s", ico)

        # Others: try png/gif
        img_path = next(
            (p for p in ICON_PATHS if p.suffix.lower() in (".png", ".gif")), None
        )
        if img_path:
            try:
                img = tk.PhotoImage(file=str(img_path))
                self.iconphoto(True, img)
                self._icon_img = img  # keep reference
            except Exception as e:
                logger.warning("Failed to set icon via PhotoImage: %s", e)

    # rest of your original methods ------------------------
    def _add_experimental_page(self):
        self.pages["experimental"] = ExperimentalPage(
            self.main, self.core, self.cfg, self._log
        )
        if self.btn_experimental is None:
            self.btn_experimental = ctk.CTkButton(
                self.sidebar,
                text="Experimental Tests",
                command=lambda: self._show("experimental"),
            )
            self.btn_experimental.grid(row=6, column=0, padx=16, pady=6, sticky="ew")

    def _remove_experimental_page(self):
        if "experimental" in self.pages:
            self.pages["experimental"].grid_forget()
            del self.pages["experimental"]
        if self.btn_experimental is not None:
            self.btn_experimental.destroy()
            self.btn_experimental = None

    def _toggle_experimental(self, enabled: bool):
        if enabled:
            self._add_experimental_page()
        else:
            self._remove_experimental_page()

    def _show(self, key):
        for k, p in self.pages.items():
            p.grid_remove()
        self.pages[key].grid(row=0, column=0, sticky="nsew")

    def _log(self, msg):
        if "results" in self.pages:
            self.pages["results"].append(msg)

    def _log_sink(self, msg):
        pass
