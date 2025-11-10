import customtkinter as ctk

from ...config import save_config
from ..theme import ThemeConfig, available_accents


class DevicesPage(ctk.CTkFrame):
    def __init__(
        self,
        master,
        core,
        cfg,
        log_fn,
        on_toggle_experimental,
        *,
        theme_config: ThemeConfig,
        on_theme_change,
    ):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.on_toggle_experimental = on_toggle_experimental
        self.theme_config = theme_config
        self.theme_callback = on_theme_change

        self.section_font = ctk.CTkFont(size=14, weight="bold")
        self.page_title_font = ctk.CTkFont(size=20, weight="bold")
        self.button_style = {"height": 36, "corner_radius": 8}

        self.accent_options = available_accents()
        self.accent_display_to_key = {v: k for k, v in self.accent_options.items()}

        self.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            self,
            text="Devices / Settings",
            font=self.page_title_font,
        ).grid(row=0, column=0, padx=24, pady=(24, 12), sticky="w")

        self._build_signal_settings(row=1)
        self._build_device_selection(row=2)
        self._build_appearance_settings(row=3)

        self._refresh_devices()

    def _build_signal_settings(self, row: int) -> None:
        frame = ctk.CTkFrame(self)
        frame.grid(row=row, column=0, sticky="ew", padx=24, pady=(12, 16))
        frame.grid_columnconfigure((1, 3), weight=1)

        ctk.CTkLabel(frame, text="Signal Settings", font=self.section_font).grid(
            row=0, column=0, columnspan=4, sticky="w", padx=18, pady=(16, 10)
        )

        self.out_sr_var = ctk.StringVar(
            value=str(self.cfg["last_settings"].get("output_sample_rate", 44100))
        )
        ctk.CTkLabel(frame, text="Output Sample Rate").grid(
            row=1, column=0, sticky="w", padx=(18, 8), pady=(0, 8)
        )
        self.out_sr_menu = ctk.CTkOptionMenu(frame, values=[], variable=self.out_sr_var, width=150)
        self.out_sr_menu.grid(row=1, column=1, sticky="ew", padx=(0, 18), pady=(0, 8))

        self.in_sr_var = ctk.StringVar(
            value=str(self.cfg["last_settings"].get("input_sample_rate", 44100))
        )
        ctk.CTkLabel(frame, text="Input Sample Rate").grid(
            row=1, column=2, sticky="w", padx=(18, 8), pady=(0, 8)
        )
        self.in_sr_menu = ctk.CTkOptionMenu(frame, values=[], variable=self.in_sr_var, width=150)
        self.in_sr_menu.grid(row=1, column=3, sticky="ew", padx=(0, 18), pady=(0, 8))

        self.dur_var = ctk.DoubleVar(value=self.cfg["last_settings"]["duration"])
        ctk.CTkLabel(frame, text="Signal Duration (s)").grid(
            row=2, column=0, sticky="w", padx=(18, 8), pady=(0, 12)
        )
        ctk.CTkEntry(frame, textvariable=self.dur_var).grid(
            row=2, column=1, sticky="ew", padx=(0, 18), pady=(0, 12)
        )

        self.out_bits_label = ctk.CTkLabel(frame, text="Output Bit Depth")
        self.out_bits_var = ctk.StringVar(value=str(self.cfg["last_settings"].get("output_bit_depth", "")))
        self.out_bits_menu = ctk.CTkOptionMenu(frame, values=[], variable=self.out_bits_var, width=150)

        self.in_bits_label = ctk.CTkLabel(frame, text="Input Bit Depth")
        self.in_bits_var = ctk.StringVar(value=str(self.cfg["last_settings"].get("input_bit_depth", "")))
        self.in_bits_menu = ctk.CTkOptionMenu(frame, values=[], variable=self.in_bits_var, width=150)

        self.out_bits_label.grid(row=3, column=0, sticky="w", padx=(18, 8), pady=(0, 12))
        self.out_bits_menu.grid(row=3, column=1, sticky="ew", padx=(0, 18), pady=(0, 12))
        self.in_bits_label.grid(row=3, column=2, sticky="w", padx=(18, 8), pady=(0, 12))
        self.in_bits_menu.grid(row=3, column=3, sticky="ew", padx=(0, 18), pady=(0, 12))
        self.out_bits_label.grid_remove()
        self.out_bits_menu.grid_remove()
        self.in_bits_label.grid_remove()
        self.in_bits_menu.grid_remove()

        ctk.CTkButton(frame, text="Apply", command=self._apply, **self.button_style).grid(
            row=2, column=3, sticky="e", padx=(0, 18), pady=(0, 12)
        )

    def _build_device_selection(self, row: int) -> None:
        frame = ctk.CTkFrame(self)
        frame.grid(row=row, column=0, sticky="ew", padx=24, pady=(0, 16))
        frame.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(frame, text="Audio Devices", font=self.section_font).grid(
            row=0, column=0, columnspan=3, sticky="w", padx=18, pady=(16, 10)
        )

        ctk.CTkLabel(frame, text="Output Device").grid(
            row=1, column=0, sticky="w", padx=(18, 8), pady=(0, 8)
        )
        self.out_menu = ctk.CTkOptionMenu(
            frame,
            values=["<refresh>"],
            command=lambda _: self._update_sr_menus(),
        )
        self.out_menu.grid(row=1, column=1, sticky="ew", padx=(0, 12), pady=(0, 8))

        ctk.CTkLabel(frame, text="Input Device").grid(
            row=2, column=0, sticky="w", padx=(18, 8), pady=(0, 12)
        )
        self.in_menu = ctk.CTkOptionMenu(
            frame,
            values=["<refresh>"],
            command=lambda _: self._update_sr_menus(),
        )
        self.in_menu.grid(row=2, column=1, sticky="ew", padx=(0, 12), pady=(0, 12))

        ctk.CTkButton(
            frame,
            text="Refresh Devices",
            command=self._refresh_devices,
            **self.button_style,
        ).grid(row=1, column=2, rowspan=2, sticky="e", padx=(0, 18), pady=(0, 12))

    def _build_appearance_settings(self, row: int) -> None:
        frame = ctk.CTkFrame(self)
        frame.grid(row=row, column=0, sticky="ew", padx=24, pady=(0, 24))
        frame.grid_columnconfigure((1, 3), weight=1)

        ctk.CTkLabel(frame, text="Appearance", font=self.section_font).grid(
            row=0, column=0, columnspan=4, sticky="w", padx=18, pady=(16, 10)
        )

        ctk.CTkLabel(frame, text="Appearance Mode").grid(
            row=1, column=0, sticky="w", padx=(18, 8), pady=(0, 8)
        )
        self.appearance_menu = ctk.CTkOptionMenu(
            frame,
            values=["System", "Light", "Dark"],
            command=self._on_appearance_changed,
        )
        self.appearance_menu.set(self.theme_config.appearance_mode)
        self.appearance_menu.grid(row=1, column=1, sticky="w", padx=(0, 18), pady=(0, 8))

        ctk.CTkLabel(frame, text="Accent Color").grid(
            row=1, column=2, sticky="w", padx=(18, 8), pady=(0, 8)
        )
        accent_display = self.accent_options.get(
            self.theme_config.accent,
            self.accent_options[ThemeConfig().accent],
        )
        self.accent_menu = ctk.CTkOptionMenu(
            frame,
            values=list(self.accent_options.values()),
            command=self._on_accent_changed,
        )
        self.accent_menu.set(accent_display)
        self.accent_menu.grid(row=1, column=3, sticky="w", padx=(0, 18), pady=(0, 8))

        self.experimental_var = ctk.BooleanVar(
            value=bool(self.cfg["ui"].get("labs_enabled", True))
        )
        ctk.CTkSwitch(
            frame,
            text="Enable Experimental Tests",
            variable=self.experimental_var,
            command=self._toggle_experimental,
        ).grid(row=2, column=0, columnspan=4, sticky="w", padx=18, pady=(8, 18))

    def _apply(self):
        try:
            self.core.set_sample_rates(
                output_rate=int(self.out_sr_menu.get()),
                input_rate=int(self.in_sr_menu.get()),
            )
            self.core.duration = float(self.dur_var.get())
            self.cfg["last_settings"]["output_sample_rate"] = self.core.sample_rate
            self.cfg["last_settings"]["input_sample_rate"] = self.core.input_sample_rate
            self.cfg["last_settings"]["sample_rate"] = self.core.sample_rate
            if self.out_bits_var.get():
                self.cfg["last_settings"]["output_bit_depth"] = int(self.out_bits_var.get())
            if self.in_bits_var.get():
                self.cfg["last_settings"]["input_bit_depth"] = int(self.in_bits_var.get())
            self.cfg["last_settings"]["duration"] = self.core.duration
            save_config(self.cfg)
            self.log(
                f"[SET] sr_out={self.core.sample_rate}, sr_in={self.core.input_sample_rate}, dur={self.core.duration}s"
            )
        except Exception as exc:
            self.log(f"[ERROR] settings: {exc}")

    def _refresh_devices(self):
        devs = self.core.list_devices()
        out_values, in_values = [], []
        self._out_idx, self._in_idx = {}, {}
        for i, info in enumerate(devs):
            name = info.get("name", "?")
            m_in = int(info.get("maxInputChannels", 0))
            m_out = int(info.get("maxOutputChannels", 0))
            rate = int(info.get("defaultSampleRate", 0))
            label = f"[{i}] {name} (in:{m_in}, out:{m_out}, rate:{rate})"
            if m_out > 0:
                out_values.append(label)
                self._out_idx[label] = i
            if m_in > 0:
                in_values.append(label)
                self._in_idx[label] = i
        self.out_menu.configure(values=out_values or ["<no outputs>"])
        self.in_menu.configure(values=in_values or ["<no inputs>"])

        out_stored = self.cfg["last_settings"].get("output_device_index")
        in_stored = self.cfg["last_settings"].get("input_device_index")
        out_default = self.core.get_default_output_index()
        in_default = self.core.get_default_input_index()

        if out_values:
            target_idx = out_stored if out_stored is not None else out_default
            target = next(
                (lbl for lbl, idx in self._out_idx.items() if idx == target_idx),
                out_values[0],
            )
            self.out_menu.set(target)
        if in_values:
            target_idx = in_stored if in_stored is not None else in_default
            target = next(
                (lbl for lbl, idx in self._in_idx.items() if idx == target_idx),
                in_values[0],
            )
            self.in_menu.set(target)
        self._update_sr_menus()

    def use_selected_devices(self):
        out_idx = self._out_idx.get(self.out_menu.get())
        in_idx = self._in_idx.get(self.in_menu.get())
        if out_idx is None or in_idx is None:
            return
        self.core.set_devices(output_index=out_idx, input_index=in_idx)
        self.core.set_sample_rates(
            output_rate=int(self.out_sr_menu.get()),
            input_rate=int(self.in_sr_menu.get()),
        )
        self.cfg["last_settings"]["output_device_index"] = out_idx
        self.cfg["last_settings"]["input_device_index"] = in_idx
        self.cfg["last_settings"]["output_sample_rate"] = self.core.sample_rate
        self.cfg["last_settings"]["input_sample_rate"] = self.core.input_sample_rate
        if self.out_bits_var.get():
            self.cfg["last_settings"]["output_bit_depth"] = int(self.out_bits_var.get())
        if self.in_bits_var.get():
            self.cfg["last_settings"]["input_bit_depth"] = int(self.in_bits_var.get())
        save_config(self.cfg)
        self.log(
            f"[SET] devices out={out_idx}, in={in_idx}, sr_out={self.core.sample_rate}, sr_in={self.core.input_sample_rate}"
        )

    def _toggle_experimental(self):
        self.cfg["ui"]["labs_enabled"] = bool(self.experimental_var.get())
        save_config(self.cfg)
        self.on_toggle_experimental(bool(self.experimental_var.get()))

    def _update_sr_menus(self):
        out_idx = self._out_idx.get(self.out_menu.get())
        in_idx = self._in_idx.get(self.in_menu.get())

        out_rates, out_bits = self.core.get_device_capabilities(out_idx, False)
        in_rates, in_bits = self.core.get_device_capabilities(in_idx, True)

        out_rate_vals = [str(r) for r in out_rates]
        in_rate_vals = [str(r) for r in in_rates]
        self.out_sr_menu.configure(values=out_rate_vals)
        self.in_sr_menu.configure(values=in_rate_vals)

        stored_out = str(self.cfg["last_settings"].get("output_sample_rate", 44100))
        stored_in = str(self.cfg["last_settings"].get("input_sample_rate", 44100))

        def _pick_rate(stored, vals, default_info_idx):
            if stored in vals:
                return stored
            if default_info_idx is not None:
                info = self.core.audio.get_device_info_by_index(default_info_idx)
                default_rate = str(int(info.get("defaultSampleRate", 0)))
                if default_rate in vals:
                    return default_rate
            return vals[0] if vals else stored

        self.out_sr_menu.set(_pick_rate(stored_out, out_rate_vals, out_idx))
        self.in_sr_menu.set(_pick_rate(stored_in, in_rate_vals, in_idx))

        out_bit_vals = [str(b) for b in out_bits]
        in_bit_vals = [str(b) for b in in_bits]
        self.out_bits_menu.configure(values=out_bit_vals)
        self.in_bits_menu.configure(values=in_bit_vals)

        if len(out_bit_vals) > 1:
            self.out_bits_label.grid()
            self.out_bits_menu.grid()
            stored = str(self.cfg["last_settings"].get("output_bit_depth", out_bit_vals[0]))
            self.out_bits_menu.set(stored if stored in out_bit_vals else out_bit_vals[0])
        else:
            self.out_bits_label.grid_remove()
            self.out_bits_menu.grid_remove()
            if out_bit_vals:
                self.out_bits_var.set(out_bit_vals[0])

        if len(in_bit_vals) > 1:
            self.in_bits_label.grid()
            self.in_bits_menu.grid()
            stored = str(self.cfg["last_settings"].get("input_bit_depth", in_bit_vals[0]))
            self.in_bits_menu.set(stored if stored in in_bit_vals else in_bit_vals[0])
        else:
            self.in_bits_label.grid_remove()
            self.in_bits_menu.grid_remove()
            if in_bit_vals:
                self.in_bits_var.set(in_bit_vals[0])

    def _on_appearance_changed(self, value: str) -> None:
        self._update_theme(appearance=value)

    def _on_accent_changed(self, value: str) -> None:
        accent_key = self.accent_display_to_key.get(value, self.theme_config.accent)
        self._update_theme(accent=accent_key)

    def _update_theme(self, *, appearance: str | None = None, accent: str | None = None) -> None:
        new_theme = ThemeConfig(
            appearance_mode=appearance or self.theme_config.appearance_mode,
            accent=accent or self.theme_config.accent,
        )
        if new_theme == self.theme_config:
            return
        self.theme_config = new_theme
        self.cfg.setdefault("ui", {})
        self.cfg["ui"]["appearance_mode"] = new_theme.appearance_mode
        self.cfg["ui"]["accent"] = new_theme.accent
        self.cfg["ui"]["color_theme"] = new_theme.accent
        save_config(self.cfg)
        self.theme_callback(new_theme)
        self.log(f"[UI] theme -> {new_theme.appearance_mode}/{new_theme.accent}")
