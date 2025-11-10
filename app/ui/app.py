
import logging
import sys
from pathlib import Path
from typing import Optional

import customtkinter as ctk

try:
    from PIL import Image, ImageTk
except Exception:  # noqa: BLE001
    Image = None
    ImageTk = None

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


def _resolve_icon() -> Optional[Path]:
    """Return the path to the application icon, if available."""

    candidates = [Path(__file__).with_name("assets") / "pawdiolab.ico"]

    if hasattr(sys, "_MEIPASS"):
        meipass = Path(sys._MEIPASS)
        candidates.extend(
            [
                meipass / "app" / "ui" / "assets" / "pawdiolab.ico",
                meipass / "pawdiolab.ico",
            ]
        )

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    return None


APP_ICON = _resolve_icon()
if APP_ICON is None:
    logger.info("Application icon not found; using default window icon")

class MainApp(ctk.CTk):
    def __init__(self):
        self.cfg = load_config()
        apply_theme(self.cfg["ui"])
        super().__init__()
        self._icon_image = None
        self._icon_handles = ()
        self._apply_window_icon()
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

    def _apply_window_icon(self) -> None:
        if APP_ICON is None:
            return

        if sys.platform.startswith("win"):
            if self._apply_windows_icon(APP_ICON):
                return

        if Image is None or ImageTk is None:
            logger.info("Pillow is not available; cannot apply application icon image")
            return

        try:
            with Image.open(APP_ICON) as icon_image:
                self._icon_image = ImageTk.PhotoImage(icon_image)
            self.iconphoto(True, self._icon_image)
        except Exception:  # noqa: BLE001
            logger.warning("Failed to load application icon via iconphoto from %s", APP_ICON)

    def _apply_windows_icon(self, icon_path: Path) -> bool:
        """Apply the window icon using Win32 APIs for reliable display on Windows."""

        try:
            import ctypes
            from ctypes import wintypes
        except Exception:  # noqa: BLE001
            logger.warning("ctypes is not available; cannot load Windows icon")
            return False

        load_image = ctypes.windll.user32.LoadImageW
        send_message = ctypes.windll.user32.SendMessageW

        # Constants sourced from WinUser.h
        image_icon = 1
        lr_loadfromfile = 0x0010
        lr_defaultsize = 0x0040
        wm_seticon = 0x0080

        icon_path_str = str(icon_path.resolve())
        try:
            hicon_big = load_image(None, icon_path_str, image_icon, 0, 0, lr_loadfromfile | lr_defaultsize)
            hicon_small = load_image(None, icon_path_str, image_icon, 16, 16, lr_loadfromfile)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to load Windows icon image from %s", icon_path)
            return False

        if not hicon_big and not hicon_small:
            logger.warning("Win32 LoadImageW returned no icon handles for %s", icon_path)
            return False

        hwnd = self.winfo_id()
        if hicon_big:
            send_message(hwnd, wm_seticon, wintypes.WPARAM(1), wintypes.LPARAM(hicon_big))
        if hicon_small:
            send_message(hwnd, wm_seticon, wintypes.WPARAM(0), wintypes.LPARAM(hicon_small))

        self._icon_handles = tuple(h for h in (hicon_big, hicon_small) if h)
        return True
