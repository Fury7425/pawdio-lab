
import sys
from pathlib import Path
from tkinter import TclError

import customtkinter as ctk

from .theme import apply_theme
from ..config import load_config, save_config
from ..core.audio import AudioCore
from .pages.latency_page import LatencyPage
from .pages.sweep_fr_page import SweepFRPage
from .pages.experimental_page import ExperimentalPage
from .pages.devices_page import DevicesPage
from .pages.results_page import ResultsPage

APP_TITLE = "PawdioLab"


def _candidate_icon_paths():
    base_dir = Path(__file__).resolve().parent
    yield base_dir / "assets" / "pawdiolab.ico"

    if getattr(sys, "frozen", False):
        # When packaged (e.g. via PyInstaller) the assets may live alongside
        # the executable or inside the temporary extraction directory.
        meipass = getattr(sys, "_MEIPASS", None)
        frozen_roots = []
        if meipass:
            frozen_roots.append(Path(meipass))
        frozen_roots.append(Path(sys.executable).resolve().parent)
        for root in frozen_roots:
            if not root:
                continue
            yield root / "pawdiolab.ico"
            yield root / "app" / "ui" / "assets" / "pawdiolab.ico"


def _resolve_icon_path():
    for path in _candidate_icon_paths():
        if path.is_file():
            return path
    return None

class MainApp(ctk.CTk):
    def __init__(self):
        self.cfg = load_config()
        apply_theme(self.cfg["ui"])
        super().__init__()
        if sys.platform.startswith("win"):
            icon_path = _resolve_icon_path()
            if icon_path is not None:
                try:
                    self.iconbitmap(str(icon_path))
                except TclError:
                    pass
        self.title(APP_TITLE); self.geometry("1200x800"); self.minsize(1060, 720)

        self.grid_columnconfigure(1, weight=1); self.grid_rowconfigure(0, weight=1)
        self.sidebar = ctk.CTkFrame(self, corner_radius=0, width=230); self.sidebar.grid(row=0, column=0, sticky="nsw")
        self.sidebar.grid_rowconfigure(10, weight=1)
        ctk.CTkLabel(self.sidebar, text="PawdioLab", font=ctk.CTkFont(size=20, weight="bold")).grid(row=0, column=0, padx=18, pady=(18,8), sticky="w")

        self.btn_latency = ctk.CTkButton(self.sidebar, text="Latency", command=lambda: self._show("latency")); self.btn_latency.grid(row=2, column=0, padx=16, pady=6, sticky="ew")
        self.btn_sweep = ctk.CTkButton(self.sidebar, text="Sweep FR", command=lambda: self._show("sweep_fr")); self.btn_sweep.grid(row=3, column=0, padx=16, pady=6, sticky="ew")
        self.btn_devices = ctk.CTkButton(self.sidebar, text="Devices / Settings", command=lambda: self._show("devices")); self.btn_devices.grid(row=4, column=0, padx=16, pady=6, sticky="ew")
        self.btn_results = ctk.CTkButton(self.sidebar, text="Results / Export", command=lambda: self._show("results")); self.btn_results.grid(row=5, column=0, padx=16, pady=6, sticky="ew")

        self.btn_experimental = None

        self.main = ctk.CTkFrame(self, corner_radius=0); self.main.grid(row=0, column=1, sticky="nsew")
        self.main.grid_rowconfigure(0, weight=1); self.main.grid_columnconfigure(0, weight=1)

        self.core = AudioCore(sample_rate=self.cfg["last_settings"].get("output_sample_rate", self.cfg["last_settings"].get("sample_rate", 44100)),
                              chunk_size=1024, duration=self.cfg["last_settings"]["duration"],
                              output_device_index=self.cfg["last_settings"]["output_device_index"],
                              input_device_index=self.cfg["last_settings"]["input_device_index"],
                              input_sample_rate=self.cfg["last_settings"].get("input_sample_rate", self.cfg["last_settings"].get("sample_rate", 44100)))

        self.pages = {}
        self.pages["latency"] = LatencyPage(self.main, self.core, self.cfg, self._log)
        self.pages["sweep_fr"] = SweepFRPage(self.main, self.core, self.cfg, self._log)
        self.pages["devices"] = DevicesPage(self.main, self.core, self.cfg, self._log, on_toggle_experimental=self._toggle_experimental)
        self.pages["results"] = ResultsPage(self.main, self._log_sink)
        if self.cfg["ui"].get("labs_enabled", True):
            self._add_experimental_page()

        self._show("latency")

    def _add_experimental_page(self):
        self.pages["experimental"] = ExperimentalPage(self.main, self.core, self.cfg, self._log)
        if self.btn_experimental is None:
            self.btn_experimental = ctk.CTkButton(self.sidebar, text="Experimental Tests", command=lambda: self._show("experimental"))
            self.btn_experimental.grid(row=6, column=0, padx=16, pady=6, sticky="ew")

    def _remove_experimental_page(self):
        if "experimental" in self.pages:
            self.pages["experimental"].grid_forget(); del self.pages["experimental"]
        if self.btn_experimental is not None:
            self.btn_experimental.destroy(); self.btn_experimental = None

    def _toggle_experimental(self, enabled: bool):
        if enabled: self._add_experimental_page()
        else: self._remove_experimental_page()

    def _show(self, key):
        for k, p in self.pages.items(): p.grid_remove()
        self.pages[key].grid(row=0, column=0, sticky="nsew")

    def _log(self, msg):
        if "results" in self.pages:
            self.pages["results"].append(msg)

    def _log_sink(self, msg):
        pass
