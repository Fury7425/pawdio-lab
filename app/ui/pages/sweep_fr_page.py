import os, json, customtkinter as ctk, traceback
import threading
import time
import numpy as np
from ...tests import sweep_fr
from ...core.utils import ensure_dir, dbfs
from ...config import save_config


class SweepFRPage(ctk.CTkFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.results = []
        self.monitoring = False
        self.monitor_thread = None
        
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        ctk.CTkLabel(self, text="Sweep Frequency Response", font=ctk.CTkFont(size=18, weight="bold")).grid(
            row=0, column=0, padx=18, pady=(18, 4), sticky="w"
        )

        # Level Checker Card
        level_card = ctk.CTkFrame(self, corner_radius=10)
        level_card.grid(row=1, column=0, padx=18, pady=12, sticky="ew")
        level_card.grid_columnconfigure(1, weight=1)
        
        ctk.CTkLabel(level_card, text="Input Level Monitor", font=ctk.CTkFont(size=14, weight="bold")).grid(
            row=0, column=0, columnspan=3, padx=12, pady=(12, 4), sticky="w"
        )
        
        # Status indicator
        self.status_label = ctk.CTkLabel(level_card, text="Ready to measure...", 
                                         font=ctk.CTkFont(size=12))
        self.status_label.grid(row=1, column=0, columnspan=3, padx=12, pady=4, sticky="w")
        
        # Level meter frame
        meter_frame = ctk.CTkFrame(level_card, height=80)
        meter_frame.grid(row=2, column=0, columnspan=3, padx=12, pady=8, sticky="ew")
        meter_frame.grid_columnconfigure(0, weight=1)
        meter_frame.grid_propagate(False)
        
        # Level bar canvas
        self.level_canvas = ctk.CTkCanvas(meter_frame, height=60, bg="#2b2b2b", highlightthickness=0)
        self.level_canvas.grid(row=0, column=0, sticky="ew", padx=8, pady=8)
        
        # Level readouts
        readout_frame = ctk.CTkFrame(level_card)
        readout_frame.grid(row=3, column=0, columnspan=3, padx=12, pady=(0, 8), sticky="ew")
        readout_frame.grid_columnconfigure((0, 1, 2), weight=1)
        
        ctk.CTkLabel(readout_frame, text="Current Level:").grid(row=0, column=0, padx=8, pady=4, sticky="w")
        self.current_level_label = ctk.CTkLabel(readout_frame, text="-- dBFS", 
                                                font=ctk.CTkFont(size=16, weight="bold"))
        self.current_level_label.grid(row=0, column=1, padx=8, pady=4, sticky="w")
        
        ctk.CTkLabel(readout_frame, text="Peak Level:").grid(row=1, column=0, padx=8, pady=4, sticky="w")
        self.peak_level_label = ctk.CTkLabel(readout_frame, text="-- dBFS", 
                                             font=ctk.CTkFont(size=16, weight="bold"))
        self.peak_level_label.grid(row=1, column=1, padx=8, pady=4, sticky="w")
        
        ctk.CTkLabel(readout_frame, text="SPL Estimate:").grid(row=0, column=2, padx=8, pady=4, sticky="e")
        self.spl_label = ctk.CTkLabel(readout_frame, text="-- dB SPL", 
                                      font=ctk.CTkFont(size=16, weight="bold"))
        self.spl_label.grid(row=1, column=2, padx=8, pady=4, sticky="e")
        
        # Monitor controls
        control_frame = ctk.CTkFrame(level_card)
        control_frame.grid(row=4, column=0, columnspan=3, padx=12, pady=(0, 12), sticky="ew")
        
        self.monitor_button = ctk.CTkButton(control_frame, text="Start Monitoring", 
                                           command=self.toggle_monitoring, width=140)
        self.monitor_button.pack(side="left", padx=6)
        
        ctk.CTkButton(control_frame, text="Reset Peak", command=self.reset_peak, width=100).pack(side="left", padx=6)
        
        self.clip_warning = ctk.CTkLabel(control_frame, text="", text_color="red",
                                        font=ctk.CTkFont(size=12, weight="bold"))
        self.clip_warning.pack(side="right", padx=12)

        # Sweep configuration card
        run_card = ctk.CTkFrame(self)
        run_card.grid(row=2, column=0, padx=18, pady=12, sticky="ew")
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

        ctk.CTkLabel(run_card, text="Output Folder").grid(row=4, column=0, padx=8, pady=(8, 2), sticky="w")
        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        row = ctk.CTkFrame(run_card)
        row.grid(row=4, column=1, columnspan=3, padx=8, pady=(4, 8), sticky="ew")
        row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(row, textvariable=self.output_dir_var)
        self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkButton(row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)

        ctk.CTkButton(run_card, text="Run Sweep", command=self.on_run).grid(row=5, column=0, padx=8, pady=(4, 8), sticky="w")

        # Results area
        res = ctk.CTkFrame(self)
        res.grid(row=3, column=0, padx=18, pady=12, sticky="nsew")
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

        # Initialize level tracking
        self.current_level = -96.0
        self.peak_level = -96.0
        self.clip_count = 0
        
        # Draw initial meter
        self.after(100, self._update_meter_display)

    def toggle_monitoring(self):
        """Toggle input level monitoring"""
        if self.monitoring:
            self.stop_monitoring()
        else:
            self.start_monitoring()
    
    def start_monitoring(self):
        """Start monitoring input levels"""
        if self.monitoring:
            return
        
        self.monitoring = True
        self.monitor_button.configure(text="Stop Monitoring")
        self.status_label.configure(text="Monitoring input levels...")
        self.reset_peak()
        
        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
    
    def stop_monitoring(self):
        """Stop monitoring input levels"""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1.0)
        self.monitor_button.configure(text="Start Monitoring")
        self.status_label.configure(text="Monitoring stopped.")
    
    def reset_peak(self):
        """Reset peak level and clip counter"""
        self.peak_level = -96.0
        self.clip_count = 0
        self.clip_warning.configure(text="")
    
    def _monitor_loop(self):
        """Background thread for monitoring audio levels"""
        try:
            while self.monitoring:
                # Record a short snippet
                audio = self.core.record_audio(duration=0.1, channels=1)
                
                if audio is not None and len(audio) > 0:
                    # Calculate RMS level in dBFS
                    level_dbfs = dbfs(audio)
                    
                    # Update current level
                    self.current_level = level_dbfs
                    
                    # Update peak level
                    if level_dbfs > self.peak_level:
                        self.peak_level = level_dbfs
                    
                    # Check for clipping (assuming -3 dBFS as threshold)
                    if np.max(np.abs(audio)) > 0.9:
                        self.clip_count += 1
                    
                    # Calculate approximate SPL (assuming 94 dB SPL = -20 dBFS calibration)
                    spl_estimate = level_dbfs + 114.0  # Rough calibration
                    
                    # Update UI (must be done in main thread)
                    self.after(0, self._update_ui, level_dbfs, self.peak_level, spl_estimate)
                
                time.sleep(0.05)  # Update ~20 times per second
        except Exception as e:
            self.log(f"[MONITOR] Error: {e}")
            self.monitoring = False
    
    def _update_ui(self, current, peak, spl):
        """Update UI elements with new levels (called from main thread)"""
        # Update labels
        self.current_level_label.configure(text=f"{current:.1f} dBFS")
        self.peak_level_label.configure(text=f"{peak:.1f} dBFS")
        self.spl_label.configure(text=f"{spl:.0f} dB SPL")
        
        # Update status based on level
        if current > -3:
            self.status_label.configure(text="⚠️ CLIPPING - Reduce input level!", text_color="red")
            self.current_level_label.configure(text_color="red")
        elif current > -6:
            self.status_label.configure(text="⚠️ Level too high - Risk of clipping", text_color="orange")
            self.current_level_label.configure(text_color="orange")
        elif current > -20:
            self.status_label.configure(text="✓ Level OK", text_color="green")
            self.current_level_label.configure(text_color="green")
        else:
            self.status_label.configure(text="Level low - increase if needed", text_color="gray")
            self.current_level_label.configure(text_color="gray")
        
        # Update clip warning
        if self.clip_count > 0:
            self.clip_warning.configure(text=f"⚠️ {self.clip_count} clips detected!")
        else:
            self.clip_warning.configure(text="")
        
        # Request meter redraw
        self._update_meter_display()
    
    def _update_meter_display(self):
        """Draw the level meter"""
        canvas = self.level_canvas
        width = canvas.winfo_width()
        height = canvas.winfo_height()
        
        if width < 10:  # Canvas not ready yet
            self.after(100, self._update_meter_display)
            return
        
        canvas.delete("all")
        
        # Draw background grid
        for i in range(-60, 1, 10):
            x = self._db_to_x(i, width)
            color = "#444444" if i % 20 == 0 else "#333333"
            canvas.create_line(x, 0, x, height, fill=color, width=1)
            canvas.create_text(x, height - 5, text=f"{i}", fill="#888888", font=("Arial", 8))
        
        # Draw level bar
        level_x = self._db_to_x(self.current_level, width)
        if self.current_level > -3:
            color = "#ff3333"  # Red for clipping
        elif self.current_level > -6:
            color = "#ffaa00"  # Orange for high
        elif self.current_level > -20:
            color = "#33ff33"  # Green for good
        else:
            color = "#3388ff"  # Blue for low
        
        canvas.create_rectangle(0, 10, level_x, height - 20, fill=color, outline="")
        
        # Draw peak hold line
        peak_x = self._db_to_x(self.peak_level, width)
        canvas.create_line(peak_x, 10, peak_x, height - 20, fill="white", width=2)
        
        # Draw threshold markers
        # -20 dBFS (target level)
        target_x = self._db_to_x(-20, width)
        canvas.create_line(target_x, 0, target_x, height, fill="#33ff33", width=2, dash=(4, 4))
        
        # -6 dBFS (caution)
        caution_x = self._db_to_x(-6, width)
        canvas.create_line(caution_x, 0, caution_x, height, fill="#ffaa00", width=2, dash=(4, 4))
        
        # -3 dBFS (clip warning)
        clip_x = self._db_to_x(-3, width)
        canvas.create_line(clip_x, 0, clip_x, height, fill="#ff3333", width=2, dash=(4, 4))
    
    def _db_to_x(self, db, width):
        """Convert dB value to canvas x coordinate"""
        # Map -60 dB to 0 dB across the canvas width
        db_min = -60
        db_max = 0
        normalized = (db - db_min) / (db_max - db_min)
        return max(0, min(width, normalized * width))

    def _choose_outdir(self):
        from tkinter import filedialog
        d = filedialog.askdirectory()
        if d:
            self.output_dir_var.set(d)
            self.cfg["last_settings"]["output_dir"] = d
            save_config(self.cfg)

    def on_run(self):
        """Runs the frequency sweep test with error handling."""
        # Stop monitoring during sweep
        was_monitoring = self.monitoring
        if was_monitoring:
            self.stop_monitoring()
        
        out_dir = self.output_dir_var.get() or os.getcwd()
        self.log(f"[SWEEP FR] Starting run with f0={self.var_f0.get()}, f1={self.var_f1.get()}, repeats={self.var_rep.get()}")

        try:
            r = sweep_fr.run(
                self.core,
                self.log,
                f0=float(self.var_f0.get()),
                f1=float(self.var_f1.get()),
                duration=float(self.var_dur.get()),
                repeats=int(self.var_rep.get()),
                save_plot_dir=out_dir if self.save_plots_var.get() else None,
                save_squiglink=self.save_squiglink_var.get()
            )
            if r is None:
                self.log("[SWEEP FR] Run aborted due to an audio error.")
                return
                
            self._push(r)
            self.log("[SWEEP FR] Run successful.")
        except Exception as e:
            error_msg = f"[ERROR] Sweep failed: {e}. Check audio devices and macOS Microphone permissions."
            self.log(error_msg)
            self.box.insert("end", f"{error_msg}\n")
            self.box.insert("end", f"--- TRACEBACK ---\n{traceback.format_exc()}\n-----------------\n\n")
            self.box.see("end")
        finally:
            # Resume monitoring if it was active
            if was_monitoring:
                self.after(500, self.start_monitoring)

    def _push(self, res):
        self.results.append(res.to_dict())
        self.box.insert("end", json.dumps(res.to_dict(), indent=2, ensure_ascii=False) + "\n\n")
        self.box.see("end")

    def export_last(self):
        if not self.results:
            self.log("[WARNING] No results to export")
            return
        out_dir = self.output_dir_var.get() or os.getcwd()
        ensure_dir(out_dir)
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"sweep_fr_last_{ts}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.results[-1], f, indent=2, ensure_ascii=False)
        self.log(f"[EXPORT] last -> {path}")

    def export_all(self):
        if not self.results:
            self.log("[WARNING] No results to export")
            return
        out_dir = self.output_dir_var.get() or os.getcwd()
        ensure_dir(out_dir)
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"sweep_fr_all_{ts}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.results, f, indent=2, ensure_ascii=False)
        self.log(f"[EXPORT] all -> {path}")
        
    def export_last_squiglink(self):
        """Export the last sweep result to Squiglink-compatible format"""
        if not self.results:
            self.log("[WARNING] No results to export")
            return
        
        out_dir = self.output_dir_var.get() or os.getcwd()
        ensure_dir(out_dir)
        
        last_result = self.results[-1]
        data = last_result.get("data", {})
        
        freqs = data.get("freqs", [])
        left_db = data.get("left_mag_db_avg", [])
        right_db = data.get("right_mag_db_avg", [])
        avg_db = data.get("mag_db_avg_all", [])
        
        if not freqs or (not left_db and not right_db and not avg_db):
            self.log("[ERROR] No frequency response data in last result")
            return
        
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        exported_files = []
        
        if left_db:
            left_path = os.path.join(out_dir, f"squiglink_left_{ts}.txt")
            with open(left_path, 'w') as f:
                f.write("# PawdioLab Frequency Response - Left Channel\n")
                f.write("# Frequency(Hz)\tAmplitude(dB)\n")
                for freq, amp in zip(freqs, left_db):
                    f.write(f"{freq:.2f}\t{amp:.3f}\n")
            exported_files.append(left_path)
            self.log(f"[EXPORT] Left channel -> {left_path}")
        
        if right_db:
            right_path = os.path.join(out_dir, f"squiglink_right_{ts}.txt")
            with open(right_path, 'w') as f:
                f.write("# PawdioLab Frequency Response - Right Channel\n")
                f.write("# Frequency(Hz)\tAmplitude(dB)\n")
                for freq, amp in zip(freqs, right_db):
                    f.write(f"{freq:.2f}\t{amp:.3f}\n")
            exported_files.append(right_path)
            self.log(f"[EXPORT] Right channel -> {right_path}")
        
        if avg_db and len(avg_db) == len(freqs):
            avg_path = os.path.join(out_dir, f"squiglink_avg_{ts}.txt")
            with open(avg_path, 'w') as f:
                f.write("# PawdioLab Frequency Response - Average (L+R)\n")
                f.write("# Frequency(Hz)\tAmplitude(dB)\n")
                for freq, amp in zip(freqs, avg_db):
                    f.write(f"{freq:.2f}\t{amp:.3f}\n")
            exported_files.append(avg_path)
            self.log(f"[EXPORT] Average -> {avg_path}")
        
        if left_db and right_db:
            both_path = os.path.join(out_dir, f"squiglink_both_{ts}.txt")
            with open(both_path, 'w') as f:
                f.write("# PawdioLab Frequency Response - Both Channels\n")
                f.write("# Frequency(Hz)\tLeft(dB)\tRight(dB)\n")
                for freq, l_amp, r_amp in zip(freqs, left_db, right_db):
                    f.write(f"{freq:.2f}\t{l_amp:.3f}\t{r_amp:.3f}\n")
            exported_files.append(both_path)
            self.log(f"[EXPORT] Both channels -> {both_path}")
        
        if exported_files:
            self.log(f"[SUCCESS] Exported {len(exported_files)} Squiglink files to {out_dir}")
            self.log("[INFO] You can now upload these .txt files to squig.link")
        else:
            self.log("[ERROR] Failed to export Squiglink files")
