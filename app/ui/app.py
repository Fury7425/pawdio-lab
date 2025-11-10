import logging
import sys
from pathlib import Path
from typing import Optional

import tkinter as tk  # for PhotoImage on non-Windows
import customtkinter as ctk

from .theme import apply_theme
from ..config import load_config, save_config
from ..core.audio import AudioCore
from .pages.latency_page import LatencyPage
from .pages.sweep_fr_page import SweepFRPage
from .pages.experimental_page import ExperimentalPage
from .pages.devices_page import DevicesPage
from .pages.results_page import ResultsPage

logger = logging.getLogger(__name__)

APP_TITLE = "PawdioLab"


def _resolve_icon_candidates() -> list[Path]:
    """
    Collect all plausible icon paths (ico/png/icns) from source layout and PyInstaller bundle.
    Returns only ones that actually exist.
    """
    candidates: list[Path] = []

    # normal source layout: app/ui/assets/...
    assets_dir = Path(__file__).with_name("assets")
    candidates.append(assets_dir / "pawdiolab.ico")
    candidates.append(assets_dir / "pawdiolab.png")
    candidates.append(assets_dir / "pawdiolab.icns")

    # PyInstaller bundle
    if hasattr(sys, "_MEIPASS"):
        meipass = Path(sys._MEIPASS)
        candidates.extend(
            [
                meipass / "app" / "ui" / "assets" / "pawdiolab.ico",
                meipass / "app" / "ui" / "assets" / "pawdiolab.png",
                meipass / "app" / "ui" / "assets" / "pawdiolab.icns",
                meipass / "pawdiolab.ico",
                meipass / "pawdiolab.png",
                meipass / "pawdiolab.icns",
            ]
        )

    return [c for c in candidates if c.is_file()]


ICON_CANDIDATES = _resolve_icon_candidates()
if not ICON_CANDIDATES:
    logger.info("Application icon not found; using default window icon")


class MainApp(ctk.CTk):
    def __init__(self):
        self.cfg = load_config()
        apply_theme(self.cfg["ui"])

        super().__init__()

        # set icon cross-platform
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
            self.sidebar,
            text="Devices / Settings",
            command=lambda: self._show("devices"),
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
        )
        self.pages["results"] = ResultsPage(self.main, self._log_sink)

        if self.cfg["ui"].get("labs_enabled", True):
            self._add_experimental_page()

        self._show("latency")

    # ------------------------------------------------------------------
    # icon helper
    # ------------------------------------------------------------------
    def _set_window_icon(self):
        if not ICON_CANDIDATES:
            return

        # Windows prefers .ico
        if sys.platform.startswith("win"):
            ico = next((p for p in ICON_CANDIDATES if p.suffix.lower() == ".ico"), None)
            if ico:
                try:
                    self.iconbitmap(str(ico))
                    return
                except Exception:
                    logger.warning("Failed to set .ico icon on Windows from %s", ico)

        # mac / linux: use iconphoto with png/gif if possible
        png_or_gif = next(
            (p for p in ICON_CANDIDATES if p.suffix.lower() in (".png", ".gif")), None
        )
        icns = next((p for p in ICON_CANDIDATES if p.suffix.lower() == ".icns"), None)

        try:
            if png_or_gif and png_or_gif.is_file():
                img = tk.PhotoImage(file=str(png_or_gif))
                self.iconphoto(True, img)
                # keep reference so it doesn't get GC'd
                self._icon_img = img
            elif icns and icns.is_file():
                # some Tk builds accept icns via iconbitmap
                try:
                    self.iconbitmap(str(icns))
                except Exception:
                    pass
        except Exception as e:
            logger.warning("Failed to set icon via iconphoto/iconbitmap: %s", e)

    # ------------------------------------------------------------------
    # page helpers
    # ------------------------------------------------------------------
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
