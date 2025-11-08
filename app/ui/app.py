
import sys
from pathlib import Path
from tkinter import TclError

import customtkinter as ctk
from PIL import Image, ImageTk

from .theme import apply_theme
from ..config import load_config, save_config
from ..core.audio import AudioCore
from .pages.latency_page import LatencyPage
from .pages.sweep_fr_page import SweepFRPage
from .pages.experimental_page import ExperimentalPage
from .pages.devices_page import DevicesPage
from .pages.results_page import ResultsPage

APP_TITLE = "PawdioLab"

class MainApp(ctk.CTk):
    def __init__(self):
        self.cfg = load_config()
        apply_theme(self.cfg["ui"])
        super().__init__()
        self._apply_app_icon()
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

    def _apply_app_icon(self):
        icon_path = Path(__file__).resolve().parent / "assets" / "pawdiolab.ico"
        if not icon_path.is_file():
            return

        if sys.platform.startswith("win"):
            try:
                self.iconbitmap(default=str(icon_path))
            except TclError:
                pass

        try:
            with Image.open(icon_path) as ico:
                largest_frame = self._largest_ico_frame(ico)
        except Exception:
            return

        try:
            largest_frame = largest_frame.convert("RGBA")
            self._iconphoto_ref = ImageTk.PhotoImage(largest_frame)
            self.iconphoto(True, self._iconphoto_ref)
        except TclError:
            self._iconphoto_ref = None

    @staticmethod
    def _largest_ico_frame(ico_image):
        try:
            frame_count = ico_image.n_frames
        except AttributeError:
            frame_count = 1

        largest = None
        for frame_index in range(frame_count):
            try:
                ico_image.seek(frame_index)
            except EOFError:
                break
            frame = ico_image.copy()
            if largest is None or frame.size > largest.size:
                largest = frame

        if largest is None:
            largest = ico_image.copy()

        return largest
