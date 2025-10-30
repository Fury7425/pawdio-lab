import os, json, customtkinter as ctk, traceback
import threading
import numpy as np
from ...tests import sweep_fr
from ...core.utils import ensure_dir, dbfs

class SweepFRPage(ctk.CTkFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.results = []
        self.monitoring = False
        self.monitor_thread = None
        self.monitor_stream = None
        self.monitor_stop_event = threading.Event()

        self.pink_noise_playing = False
        self.pink_noise_thread = None
        self.pink_noise_stream = None
        self.pink_noise_stop_event = threading.Event()

        self.grid_columnconfigure((0,1), weight=1)
        self.grid_rowconfigure(2, weight=1)

        # Title
        ctk.CTkLabel(
            self, text="Sweep Frequency Response",
            font=ctk.CTkFont(size=18, weight="bold")
        ).grid(row=0, column=0, columnspan=2, padx=18, pady=(18, 4), sticky="w")

        # Sweep configuration card (unchanged)
        run_card = ctk.CTkFrame(self)
        run_card.grid(row=1, column=0, columnspan=2, padx=18, pady=12, sticky="ew")
        run_card.grid_columnconfigure(3, weight=1)

        self.var_f0 = ctk.StringVar(value="20")
        self.var_f1 = ctk.StringVar(value="20000")
        self.var_dur = ctk.StringVar(value="6.0")
        self.var_rep = ctk.IntVar(value=1)

        ctk.CTkLabel(run_card, text="Start Freq (Hz)").grid(row=0, column=0, sticky="w", padx=8, pady=(8, 4))
        ctk.CTkEntry(run_card, textvariable=self.var_f0, width=90).grid(row=0, column=1, sticky="w", padx=8, pady=(8, 4))
        ctk.CTkLabel(run_card, text="End Freq (Hz)").grid(row=0, column=2, sticky="w", padx=8, pady=(8, 4))
        ctk.CTkEntry(run_card, textvariable=self.var_f1, width=90).grid(row=0, column=3, sticky="w", padx=8, pady=(8, 4))

        ctk.CTkLabel(run_card, text="Duration (s)").grid(row=1, column=0, sticky="w", padx=8)
        ctk.CTkEntry(run_card, textvariable=self.var_dur, width=90).grid(row=1, column=1, sticky="w", padx=8)

        ctk.CTkLabel(run_card, text="Repeats").grid(row=2, column=0, sticky="w", padx=8)
        rep_slider = ctk.CTkSlider(run_card, from_=1, to=20, number_of_steps=19)
        rep_slider.set(self.var_rep.get())
        rep_slider.grid(row=2, column=1, sticky="ew", padx=8)
        rep_lab = ctk.CTkLabel(run_card, text=str(self.var_rep.get()))
        rep_lab.grid(row=2, column=2, padx=8, sticky="w")
        rep_slider.configure(command=lambda v: (self.var_rep.set(int(v)), rep_lab.configure(text=str(int(v)))))

        self.save_plots_var = ctk.BooleanVar(value=True)
        ctk.CTkSwitch(run_card, text="Save plots", variable=self.save_plots_var).grid(
            row=3, column=0, padx=8, pady=(8, 4), sticky="w"
        )

        self.save_squiglink_var = ctk.BooleanVar(value=True)
        ctk.CTkSwitch(run_card, text="Save Squiglink format (.txt)", variable=self.save_squiglink_var).grid(
            row=3, column=1, columnspan=2, padx=8, pady=(8, 4), sticky="w"
        )

        # Mono mode switch (only affects sweep_fr)
        self.mono_mode_var = ctk.BooleanVar(value=False)
        ctk.CTkSwitch(run_card, text="Mono Test (one side at a time)", variable=self.mono_mode_var).grid(
            row=3, column=3, padx=8, pady=(8, 4), sticky="w"
        )

        ctk.CTkLabel(run_card, text="Output Folder").grid(row=4, column=0, padx=8, pady=(8, 2), sticky="w")
        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        row = ctk.CTkFrame(run_card)
        row.grid(row=4, column=1, columnspan=3, padx=8, pady=(4, 8), sticky="ew")
        row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(row, textvariable=self.output_dir_var)
        self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkButton(row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)

        # Run Sweep button inside config card
        ctk.CTkButton(run_card, text="Run Sweep", command=self.on_run).grid(row=5, column=0, padx=8, pady=(4, 8), sticky="w")

        # Bottom area split into 2 columns
        self._build_level_monitor().grid(row=2, column=0, padx=18, pady=12, sticky="nsew")
        self._build_results().grid(row=2, column=1, padx=18, pady=12, sticky="nsew")

        # Initialize level tracking (no recorder used!)
        self.current_level = -96.0
        self.peak_level = -96.0
        self.clip_count = 0
        self.after(100, self._update_meter_display)

    def _choose_outdir(self):
        from tkinter import filedialog
        d = filedialog.askdirectory(initialdir=self.output_dir_var.get())
        if d:
            self.output_dir_var.set(d)

    def _build_level_monitor(self):
        level_card = ctk.CTkFrame(self, corner_radius=10)
        level_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(level_card, text="Input Level Monitor", font=ctk.CTkFont(size=14, weight="bold")).grid(
            row=0, column=0, columnspan=3, padx=12, pady=(12, 4), sticky="w"
        )
        self.status_label = ctk.CTkLabel(level_card, text="Ready to measure...", font=ctk.CTkFont(size=12))
        self.status_label.grid(row=1, column=0, columnspan=3, padx=12, pady=4, sticky="w")

        meter_frame = ctk.CTkFrame(level_card, height=80)
        meter_frame.grid(row=2, column=0, columnspan=3, padx=12, pady=8, sticky="ew")
        meter_frame.grid_columnconfigure(0, weight=1)
        meter_frame.grid_propagate(False)
        self.level_canvas = ctk.CTkCanvas(meter_frame, height=60, bg="#2b2b2b", highlightthickness=0)
        self.level_canvas.grid(row=0, column=0, sticky="ew", padx=8, pady=8)

        readout_frame = ctk.CTkFrame(level_card)
        readout_frame.grid(row=3, column=0, columnspan=3, padx=12, pady=(0, 8), sticky="ew")
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

        control_frame = ctk.CTkFrame(level_card)
        control_frame.grid(row=4, column=0, columnspan=3, padx=12, pady=(0, 12), sticky="ew")
        self.monitor_button = ctk.CTkButton(control_frame, text="Start Monitoring", command=self.toggle_monitoring, width=140)
        self.monitor_button.pack(side="left", padx=6)
        self.pink_noise_button = ctk.CTkButton(control_frame, text="Play Pink Noise", command=self.toggle_pink_noise, width=140)
        self.pink_noise_button.pack(side="left", padx=6)
        self.reset_peak_button = ctk.CTkButton(control_frame, text="Reset Peak", command=self.reset_peak, width=100)
        self.reset_peak_button.pack(side="left", padx=6)
        self.clip_warning = ctk.CTkLabel(control_frame, text="", text_color="red", font=ctk.CTkFont(size=12, weight="bold"))
        self.clip_warning.pack(side="right", padx=12)

        return level_card

    def _build_results(self):
        res = ctk.CTkFrame(self)
        res.grid_rowconfigure(1, weight=1)
        res.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(res, text="Sweep FR Results").grid(row=0, column=0, sticky="w", padx=8, pady=(8, 4))
        self.box = ctk.CTkTextbox(res)
        self.box.grid(row=1, column=0, sticky="nsew", padx=8, pady=8)
        row2 = ctk.CTkFrame(res)
        row2.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))
        ctk.CTkButton(row2, text="Export LAST (JSON)", command=self.export_last).pack(side="left", padx=4)
        ctk.CTkButton(row2, text="Export ALL (JSON)", command=self.export_all).pack(side="left", padx=4)
        ctk.CTkButton(row2, text="Export LAST to Squiglink", command=self.export_last_squiglink).pack(side="left", padx=4)
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
        if self.monitoring:
            self.monitor_stop_event.set()
            self.monitor_button.configure(text="Stopping...", state="disabled")
            self.status_label.configure(text="Stopping monitor...")
            if not (self.monitor_thread and self.monitor_thread.is_alive()):
                # Nothing to wait for, reset UI immediately
                self._on_monitor_stopped(False, True)
        else:
            if self.monitor_thread and self.monitor_thread.is_alive():
                self.log("Waiting for previous monitor thread to close before restarting.")
                return
            if self.monitoring:
                # Guard against any inconsistent state
                self.log("Monitor already active; ignoring start request.")
                return
            self.monitor_stop_event.clear()
            self.monitoring = True
            self.monitor_button.configure(text="Stop Monitoring", state="normal")
            self.status_label.configure(text="Monitoring input...")
            self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
            self.monitor_thread.start()

    def _monitor_loop(self):
        chunk = int(getattr(self.core, "chunk_size", 1024))
        samplerate = int(getattr(self.core, "input_sample_rate", getattr(self.core, "sample_rate", 44100)))
        fmt = self.core.audio.get_format_from_width(2)
        stream = None
        channels_in_use = 1
        error = False
        try:
            for ch in (1, 2):
                try:
                    stream = self.core.audio.open(
                        format=fmt,
                        channels=ch,
                        rate=samplerate,
                        input=True,
                        frames_per_buffer=chunk,
                        input_device_index=self.core.input_device_index,
                    )
                    channels_in_use = ch
                    break
                except Exception:
                    stream = None
                    continue
            if stream is None:
                raise RuntimeError("Unable to open input stream for monitoring")
            self.monitor_stream = stream
            while not self.monitor_stop_event.is_set():
                data = stream.read(chunk, exception_on_overflow=False)
                if not data:
                    continue
                audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                if channels_in_use > 1:
                    try:
                        audio = audio.reshape(-1, channels_in_use).mean(axis=1)
                    except ValueError:
                        audio = audio.reshape(-1)
                if audio.size == 0:
                    continue
                rms_level = dbfs(audio)
                peak_level = 20 * np.log10(max(np.max(np.abs(audio)), 1e-12))
                rms_level = max(-96.0, min(rms_level, 0.0))
                peak_level = max(-96.0, min(peak_level, 0.0))
                self.current_level = rms_level
                if peak_level > self.peak_level:
                    self.peak_level = peak_level
                if peak_level >= -1.0:
                    self.clip_count += 1
        except Exception as e:
            if not self.monitor_stop_event.is_set():
                error = True
                self.after(0, lambda err=e: self._handle_monitor_error(err))
        finally:
            if stream is not None:
                try:
                    stream.stop_stream()
                except Exception:
                    pass
                try:
                    stream.close()
                except Exception:
                    pass
            self.monitor_stream = None
            stop_requested = self.monitor_stop_event.is_set()
            self.after(0, lambda err=error, requested=stop_requested: self._on_monitor_stopped(err, requested))

    def _handle_monitor_error(self, err):
        self.log(f"Error in monitoring: {err}")
        traceback.print_exc()
        self.status_label.configure(text="Monitor error. Check input device.")

    def _on_monitor_stopped(self, had_error, stop_requested):
        # Ensure the thread reference is cleared only after it has finished.
        self.monitor_thread = None
        self.monitoring = False
        # Reset the stop event for the next run.
        self.monitor_stop_event.clear()
        self.monitor_button.configure(text="Start Monitoring", state="normal")
        if not had_error:
            message = "Monitoring stopped." if stop_requested else "Ready to measure..."
            self.status_label.configure(text=message)

    def _update_meter_display(self):
        self.level_canvas.delete("all")
        bar_w = max(0, (self.current_level + 96) / 96 * self.level_canvas.winfo_width())
        color = "green" if self.current_level < -3 else "red"
        self.level_canvas.create_rectangle(0, 0, bar_w, 60, fill=color, width=0)
        self.current_level_label.configure(text=f"{self.current_level:.1f} dBFS")
        self.peak_level_label.configure(text=f"{self.peak_level:.1f} dBFS")
        self.spl_label.configure(text=f"{self.current_level+94:.1f} dB SPL")
        if self.clip_count > 0:
            self.clip_warning.configure(text=f"Clipping! ({self.clip_count})")
        else:
            self.clip_warning.configure(text="")
        self.after(100, self._update_meter_display)

    def reset_peak(self):
        self.peak_level = -96.0
        self.clip_count = 0

    # ===== Pink Noise Playback/Monitoring =====
    def toggle_pink_noise(self):
        if self.pink_noise_playing:
            self.pink_noise_stop_event.set()
            self.pink_noise_button.configure(text="Stopping...", state="disabled")
            self.status_label.configure(text="Stopping pink noise...")
        else:
            self.pink_noise_playing = True
            self.pink_noise_stop_event.clear()
            self.pink_noise_button.configure(text="Stop Pink Noise", state="normal")
            self.status_label.configure(text="Starting pink noise...")
            self.start_pink_noise_thread()

    def start_pink_noise_thread(self):
        if self.pink_noise_thread and self.pink_noise_thread.is_alive():
            return
        self.pink_noise_thread = threading.Thread(target=self.pink_noise_loop, daemon=True)
        self.pink_noise_thread.start()

    def pink_noise_loop(self):
        samplerate = int(getattr(self.core, "sample_rate", 44100))
        chunk = int(getattr(self.core, "chunk_size", 1024))
        fmt = self.core.audio.get_format_from_width(2)
        stream = None
        error = False
        try:
            stream_kwargs = dict(
                format=fmt,
                channels=1,
                rate=samplerate,
                output=True,
                frames_per_buffer=chunk,
            )
            output_idx = getattr(self.core, "output_device_index", None)
            if output_idx is not None:
                stream_kwargs["output_device_index"] = output_idx
            stream = self.core.audio.open(**stream_kwargs)
            self.pink_noise_stream = stream
            self.after(0, lambda: self.status_label.configure(text="Playing pink noise..."))
            while not self.pink_noise_stop_event.is_set():
                pink = self.generate_pink_noise(chunk / samplerate, samplerate)
                rms = np.sqrt(np.mean(pink ** 2))
                db = 20 * np.log10(max(rms, 1e-12))
                scaled = np.clip(pink * 0.5, -1.0, 1.0)
                data = (scaled * 32767).astype(np.int16).tobytes()
                stream.write(data)
                if not self.monitoring:
                    self.current_level = max(-96.0, min(db, 0.0))
                    if db > self.peak_level:
                        self.peak_level = db
                    if db >= -3.0:
                        self.clip_count += 1
        except Exception as e:
            error = True
            self.after(0, lambda err=e: self._handle_pink_noise_error(err))
        finally:
            if stream is not None:
                try:
                    stream.stop_stream()
                except Exception:
                    pass
                try:
                    stream.close()
                except Exception:
                    pass
            self.pink_noise_stream = None
            self.after(0, lambda err=error: self._on_pink_noise_stopped(err))

    def generate_pink_noise(self, duration, samplerate):
        n = int(duration * samplerate)
        white = np.random.randn(n)
        b = [0.02109238, 0.07113478, 0.68873558]
        a = [1, -1.73472577, 0.7660066]
        pink = np.zeros(n)
        for i in range(3, n):
            pink[i] = b[0] * white[i] + b[1] * white[i - 1] + b[2] * white[i - 2] - a[1] * pink[i - 1] - a[2] * pink[i - 2]
        pink /= np.max(np.abs(pink)) + 1e-12
        return pink.astype(np.float32)

    def _handle_pink_noise_error(self, err):
        self.log(f"Pink noise playback error: {err}")
        traceback.print_exc()
        self.status_label.configure(text="Pink noise error. Check output device.")

    def _on_pink_noise_stopped(self, had_error):
        self.pink_noise_playing = False
        self.pink_noise_stop_event.set()
        self.pink_noise_thread = None
        self.pink_noise_button.configure(text="Play Pink Noise", state="normal")
        if not had_error:
            self.status_label.configure(text="Pink noise stopped.")
