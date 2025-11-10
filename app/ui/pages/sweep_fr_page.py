import os, json, customtkinter as ctk, traceback
import threading
import time
import importlib
import numpy as np
from ...tests import sweep_fr
from ...core.utils import ensure_dir
from ...tests.sweep_fr import InputMonitorController, LevelState, PinkNoiseGenerator

_sounddevice_spec = importlib.util.find_spec("sounddevice")
sounddevice = importlib.import_module("sounddevice") if _sounddevice_spec else None


class SweepFRPage(ctk.CTkFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.results = []
        self.level_state = LevelState()
        self.monitor_controller = InputMonitorController(
            self.core,
            self.level_state,
            ui_dispatch=self._dispatch_to_ui,
            on_start=self._on_monitor_started,
            on_stop=self._on_monitor_stopped,
            on_error=self._handle_monitor_error,
            log_fn=self.log,
        )
        self._monitor_error = False

        self.pink_noise_playing = False
        self.pink_noise_thread = None
        self.pink_noise_stream = None
        self.pink_noise_generator = PinkNoiseGenerator(gain=0.25)

        self.page_title_font = ctk.CTkFont(size=20, weight="bold")
        self.section_font = ctk.CTkFont(size=14, weight="bold")
        self.button_style = {"height": 36, "corner_radius": 8}

        self.grid_columnconfigure((0, 1), weight=1)
        self.grid_rowconfigure(2, weight=1)

        ctk.CTkLabel(
            self,
            text="Sweep Frequency Response",
            font=self.page_title_font,
        ).grid(row=0, column=0, columnspan=2, padx=24, pady=(24, 12), sticky="w")

        settings = ctk.CTkFrame(self)
        settings.grid(row=1, column=0, columnspan=2, sticky="ew", padx=24, pady=(12, 16))
        settings.grid_columnconfigure((1, 3, 5, 7), weight=1)
        ctk.CTkLabel(settings, text="Sweep Settings", font=self.section_font).grid(
            row=0, column=0, columnspan=8, sticky="w", padx=18, pady=(16, 10)
        )

        self.var_f0 = ctk.StringVar(value="20")
        self.var_f1 = ctk.StringVar(value="20000")
        self.var_dur = ctk.StringVar(value="6.0")
        self.var_rep = ctk.IntVar(value=1)

        ctk.CTkLabel(settings, text="Start Freq (Hz)").grid(
            row=1, column=0, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        ctk.CTkEntry(settings, textvariable=self.var_f0).grid(
            row=1, column=1, sticky="ew", padx=(0, 18), pady=(0, 6)
        )

        ctk.CTkLabel(settings, text="End Freq (Hz)").grid(
            row=1, column=2, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        ctk.CTkEntry(settings, textvariable=self.var_f1).grid(
            row=1, column=3, sticky="ew", padx=(0, 18), pady=(0, 6)
        )

        ctk.CTkLabel(settings, text="Duration (s)").grid(
            row=1, column=4, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        ctk.CTkEntry(settings, textvariable=self.var_dur).grid(
            row=1, column=5, sticky="ew", padx=(0, 18), pady=(0, 6)
        )

        ctk.CTkLabel(settings, text="Repeats").grid(
            row=1, column=6, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        repeats_cell = ctk.CTkFrame(settings, fg_color="transparent")
        repeats_cell.grid(row=1, column=7, sticky="ew", padx=(0, 18), pady=(0, 6))
        repeats_cell.grid_columnconfigure(0, weight=1)
        self.rep_slider = ctk.CTkSlider(repeats_cell, from_=1, to=20, number_of_steps=19)
        self.rep_slider.set(self.var_rep.get())
        self.rep_slider.grid(row=0, column=0, sticky="ew")
        self.rep_label = ctk.CTkLabel(repeats_cell, text=str(self.var_rep.get()))
        self.rep_label.grid(row=0, column=1, sticky="e", padx=(8, 0))
        self.rep_slider.configure(command=self._on_repeat_slider)

        options_row = ctk.CTkFrame(settings, fg_color="transparent")
        options_row.grid(row=2, column=0, columnspan=8, sticky="ew", padx=18, pady=(6, 12))
        options_row.grid_columnconfigure((0, 1, 2), weight=1)
        self.save_plots_var = ctk.BooleanVar(value=True)
        self.save_squiglink_var = ctk.BooleanVar(value=True)
        self.mono_mode_var = ctk.BooleanVar(value=False)
        ctk.CTkSwitch(options_row, text="Save plots", variable=self.save_plots_var).grid(
            row=0, column=0, sticky="w", pady=4
        )
        ctk.CTkSwitch(
            options_row,
            text="Save Squiglink format (.txt)",
            variable=self.save_squiglink_var,
        ).grid(row=0, column=1, sticky="w", pady=4)
        ctk.CTkSwitch(
            options_row,
            text="Mono Test (one side at a time)",
            variable=self.mono_mode_var,
        ).grid(row=0, column=2, sticky="w", pady=4)

        ctk.CTkLabel(settings, text="Output Folder").grid(
            row=3, column=0, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        output_row = ctk.CTkFrame(settings, fg_color="transparent")
        output_row.grid(row=3, column=1, columnspan=6, sticky="ew", padx=(0, 18), pady=(0, 12))
        output_row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(output_row, textvariable=self.output_dir_var)
        self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkButton(output_row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)
        ctk.CTkButton(settings, text="Run Sweep", command=self.on_run, **self.button_style).grid(
            row=3, column=7, sticky="e", padx=(0, 18), pady=(0, 12)
        )

        self.monitor_card = self._build_level_monitor()
        self.monitor_card.grid(row=2, column=0, sticky="nsew", padx=24, pady=(0, 16))
        self.results_card = self._build_results()
        self.results_card.grid(row=2, column=1, sticky="nsew", padx=24, pady=(0, 24))

        self.after(100, self._update_meter_display)

    def _on_repeat_slider(self, value: float) -> None:
        count = int(value)
        self.var_rep.set(count)
        self.rep_label.configure(text=str(count))

    def _choose_outdir(self):
        from tkinter import filedialog
        d = filedialog.askdirectory(initialdir=self.output_dir_var.get())
        if d:
            self.output_dir_var.set(d)

    def _build_level_monitor(self):
        level_card = ctk.CTkFrame(self, corner_radius=12)
        level_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(level_card, text="Input Level Monitor", font=self.section_font).grid(
            row=0, column=0, columnspan=4, sticky="w", padx=18, pady=(16, 10)
        )
        self.status_label = ctk.CTkLabel(level_card, text="Ready to measure...", font=ctk.CTkFont(size=12))
        self.status_label.grid(row=1, column=0, columnspan=4, sticky="w", padx=18, pady=(0, 8))

        meter_frame = ctk.CTkFrame(level_card, corner_radius=12, height=110)
        meter_frame.grid(row=2, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 12))
        meter_frame.grid_columnconfigure(0, weight=1)
        meter_frame.grid_propagate(False)
        self.level_canvas = ctk.CTkCanvas(meter_frame, height=70, bg="#1f1f22", highlightthickness=0)
        self.level_canvas.grid(row=0, column=0, sticky="ew", padx=12, pady=12)

        readout_frame = ctk.CTkFrame(level_card, fg_color="transparent")
        readout_frame.grid(row=3, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 12))
        readout_frame.grid_columnconfigure((0, 1, 2), weight=1)
        ctk.CTkLabel(readout_frame, text="Current Level:").grid(row=0, column=0, padx=8, pady=4, sticky="w")
        self.current_level_label = ctk.CTkLabel(readout_frame, text="-- dBFS", font=ctk.CTkFont(size=16, weight="bold"))
        self.current_level_label.grid(row=0, column=1, padx=8, pady=4, sticky="w")
        ctk.CTkLabel(readout_frame, text="Peak Level:").grid(row=1, column=0, padx=8, pady=4, sticky="w")
        self.peak_level_label = ctk.CTkLabel(readout_frame, text="-- dBFS", font=ctk.CTkFont(size=16, weight="bold"))
        self.peak_level_label.grid(row=1, column=1, padx=8, pady=4, sticky="w")
        ctk.CTkLabel(readout_frame, text="SPL Estimate:").grid(row=0, column=2, padx=8, pady=4, sticky="e")
        self.spl_label = ctk.CTkLabel(readout_frame, text="-- dB SPL", font=ctk.CTkFont(size=16, weight="bold"))
        self.spl_label.grid(row=1, column=2, padx=8, pady=4, sticky="e")

        control_frame = ctk.CTkFrame(level_card, fg_color="transparent")
        control_frame.grid(row=4, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 18))
        control_frame.grid_columnconfigure((0, 1, 2), weight=0)
        control_frame.grid_columnconfigure(3, weight=1)
        self.monitor_button = ctk.CTkButton(
            control_frame,
            text="Start Monitoring",
            command=self.toggle_monitoring,
            **self.button_style,
        )
        self.monitor_button.grid(row=0, column=0, padx=(0, 12))
        self.pink_noise_button = ctk.CTkButton(
            control_frame,
            text="Play Pink Noise",
            command=self.toggle_pink_noise,
            **self.button_style,
        )
        self.pink_noise_button.grid(row=0, column=1, padx=12)
        if sounddevice is None:
            self.pink_noise_button.configure(state="disabled")
        self.reset_peak_button = ctk.CTkButton(
            control_frame,
            text="Reset Peak",
            command=self.reset_peak,
            **self.button_style,
        )
        self.reset_peak_button.grid(row=0, column=2, padx=12)
        self.clip_warning = ctk.CTkLabel(
            control_frame,
            text="",
            text_color="red",
            font=ctk.CTkFont(size=12, weight="bold"),
        )
        self.clip_warning.grid(row=0, column=3, sticky="e")

        return level_card

    def _build_results(self):
        res = ctk.CTkFrame(self, corner_radius=12)
        res.grid_rowconfigure(1, weight=1)
        res.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(res, text="Sweep FR Results", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        self.box = ctk.CTkTextbox(res)
        self.box.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 12))

        button_row = ctk.CTkFrame(res, fg_color="transparent")
        button_row.grid(row=2, column=0, sticky="ew", padx=18, pady=(0, 18))
        button_row.grid_columnconfigure(0, weight=1)
        ctk.CTkButton(
            button_row,
            text="Export LAST (JSON)",
            command=self.export_last,
            **self.button_style,
        ).grid(row=0, column=1, padx=(0, 12))
        ctk.CTkButton(
            button_row,
            text="Export ALL (JSON)",
            command=self.export_all,
            **self.button_style,
        ).grid(row=0, column=2, padx=12)
        ctk.CTkButton(
            button_row,
            text="Export LAST to Squiglink",
            command=self.export_last_squiglink,
            **self.button_style,
        ).grid(row=0, column=3)
        return res

    def on_run(self):
        try:
            f0 = float(self.var_f0.get())
            f1 = float(self.var_f1.get())
            dur = float(self.var_dur.get())
            reps = int(self.var_rep.get())
            outdir = self.output_dir_var.get()
            ensure_dir(outdir)

            mono_mode = self.mono_mode_var.get()  # <-- passes mono mode to sweep_fr

            self.log("Running sweep...")
            res = sweep_fr.run(
                self.core, self.log, f0, f1, dur, reps,
                save_plot_dir=outdir,
                save_squiglink=self.save_squiglink_var.get(),
                mono_mode=mono_mode
            )
            self.results.append(res)
            self.box.insert("end", f"{res}\n")
            self.box.see("end")
            self.log("Sweep finished.")
        except Exception as e:
            self.log("Error running sweep: " + str(e))
            traceback.print_exc()

    def export_last(self):
        if self.results:
            with open("last_sweep.json", "w") as f:
                json.dump(self.results[-1], f, indent=2)
            self.log("Exported last sweep to last_sweep.json")

    def export_all(self):
        with open("all_sweeps.json", "w") as f:
            json.dump(self.results, f, indent=2)
        self.log("Exported all sweeps to all_sweeps.json")

    def export_last_squiglink(self):
        if self.results:
            res = self.results[-1]
            with open("last_sweep_squiglink.txt", "w") as f:
                if "data" in res and "freqs" in res["data"] and "mag_db_avg_all" in res["data"]:
                    for freq, val in zip(res["data"]["freqs"], res["data"]["mag_db_avg_all"]):
                        f.write(f"{freq}\t{val}\n")
                else:
                    f.write(str(res))
            self.log("Exported last sweep to Squiglink format")

    # ===== Monitoring System =====
    def toggle_monitoring(self):
        if self.monitor_controller.is_running:
            self._stop_monitoring()
        else:
            self._start_monitoring()

    def _start_monitoring(self):
        if self.monitor_controller.is_running:
            return
        self.monitor_button.configure(state="disabled")
        self.status_label.configure(text="Starting monitor...")
        self._monitor_error = False
        try:
            self.monitor_controller.start()
        except Exception as err:  # pragma: no cover - defensive
            self._handle_monitor_error(err)
            self.monitor_button.configure(state="normal")

    def _stop_monitoring(self):
        if not self.monitor_controller.is_running:
            self._on_monitor_stopped()
            return
        self.monitor_button.configure(state="disabled")
        self.status_label.configure(text="Stopping monitor...")

        def _stop() -> None:
            self.monitor_controller.stop()

        threading.Thread(target=_stop, daemon=True).start()

    def _on_monitor_started(self):
        self._monitor_error = False
        self.monitor_button.configure(text="Stop Monitoring", state="normal")
        self.status_label.configure(text="Monitoring input...")

    def _on_monitor_stopped(self):
        self.monitor_button.configure(text="Start Monitoring", state="normal")
        if not self._monitor_error:
            self.status_label.configure(text="Monitoring stopped.")

    def _handle_monitor_error(self, err):
        self._monitor_error = True
        self.log(f"Error in monitoring: {err}")
        traceback.print_exc()
        self.status_label.configure(text="Monitor error. Check input device.")
        self.monitor_button.configure(text="Start Monitoring", state="normal")

    def _dispatch_to_ui(self, callback):
        if callback is None:
            return
        self.after(0, callback)

    def _update_meter_display(self):
        self.level_canvas.delete("all")
        current_level, peak_level, clip_count = self.level_state.snapshot()
        bar_w = max(0, (current_level + 96) / 96 * self.level_canvas.winfo_width())
        color = "green" if current_level < -3 else "red"
        self.level_canvas.create_rectangle(0, 0, bar_w, 60, fill=color, width=0)
        self.current_level_label.configure(text=f"{current_level:.1f} dBFS")
        self.peak_level_label.configure(text=f"{peak_level:.1f} dBFS")
        self.spl_label.configure(text=f"{current_level+94:.1f} dB SPL")
        if clip_count > 0:
            self.clip_warning.configure(text=f"Clipping! ({clip_count})")
        else:
            self.clip_warning.configure(text="")
        self.after(100, self._update_meter_display)

    def reset_peak(self):
        self.level_state.reset_peak()

    # ===== Pink Noise Playback/Monitoring =====
    def toggle_pink_noise(self):
        if sounddevice is None:
            self.status_label.configure(text="Pink noise unavailable (sounddevice missing).")
            self.log("Pink noise playback requires the optional sounddevice module.")
            return

        if self.pink_noise_playing:
            self.pink_noise_playing = False
            self.pink_noise_button.configure(text="Play Pink Noise")
            if self.pink_noise_stream:
                self.pink_noise_stream.stop()
                self.pink_noise_stream.close()
                self.pink_noise_stream = None
            self.pink_noise_generator.reset()
            self.status_label.configure(text="Pink noise stopped.")
        else:
            self.pink_noise_playing = True
            self.pink_noise_button.configure(text="Stop Pink Noise")
            self.status_label.configure(text="Playing pink noise...")
            self.pink_noise_generator.reset()
            self.start_pink_noise_thread()

    def start_pink_noise_thread(self):
        if self.pink_noise_thread and self.pink_noise_thread.is_alive():
            return
        self.pink_noise_thread = threading.Thread(target=self.pink_noise_loop, daemon=True)
        self.pink_noise_thread.start()

    def pink_noise_loop(self):
        samplerate = getattr(self.core, "sample_rate", 44100)
        blocksize = 1024
        # Create a stream that calls a callback to continuously fill with pink noise
        def callback(outdata, frames, time_info, status):
            pink = self.pink_noise_generator.generate(frames, samplerate)
            outdata[:] = pink.reshape(-1, 1)
            # Real-time measurement (simulate level from pink noise itself)
            rms = np.sqrt(np.mean(pink ** 2))
            dbfs = 20 * np.log10(rms + 1e-12)
            if not self.monitor_controller.is_running:
                peak = 20 * np.log10(np.max(np.abs(pink)) + 1e-12)
                clip = peak >= -3.0
                self.level_state.record_sample(dbfs, peak, clip)

        if sounddevice is None:
            return

        self.pink_noise_stream = sounddevice.OutputStream(
            samplerate=samplerate,
            channels=1,
            blocksize=blocksize,
            callback=callback
        )
        self.pink_noise_stream.start()
        # Run until stopped
        while self.pink_noise_playing:
            time.sleep(0.1)
        # Stream will be stopped/closed by toggle_pink_noise
