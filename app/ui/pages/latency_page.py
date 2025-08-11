
import os, datetime, numpy as np, customtkinter as ctk
from ...tests.latency import DelayRunner, SOUND_PRESETS
from ...core.utils import ensure_dir
from ...config import save_config

class LatencyPage(ctk.CTkScrollableFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core; self.cfg = cfg; self.log = log_fn
        self.runner = DelayRunner(self.cfg, self.log, stereo=True)

        self.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(self, text="Latency", font=ctk.CTkFont(size=18, weight="bold")).grid(row=0, column=0, columnspan=2, padx=18, pady=(18,4), sticky="w")

        run_card = ctk.CTkFrame(self, corner_radius=10)
        run_card.grid(row=1, column=0, columnspan=2, padx=18, pady=12, sticky="ew")
        run_card.grid_columnconfigure(3, weight=1)

        ctk.CTkLabel(run_card, text="Run Delay Tests").grid(row=0, column=0, padx=12, pady=(12,6), sticky="w")
        self.preset_vars = {}
        for i, p in enumerate(SOUND_PRESETS):
            var = ctk.BooleanVar(value=(p["key"]!="impulse"))
            self.preset_vars[p["key"]] = var
            ctk.CTkSwitch(run_card, text=p["name"], variable=var).grid(row=1+i//3, column=i%3, padx=12, pady=6, sticky="w")

        self.repeats_var = ctk.IntVar(value=self.cfg["last_settings"]["repeats"])
        ctk.CTkLabel(run_card, text="Repeats").grid(row=3, column=0, padx=12, pady=(8,2), sticky="w")
        self.repeats_slider = ctk.CTkSlider(run_card, from_=1, to=20, number_of_steps=19)
        self.repeats_slider.set(self.repeats_var.get()); self.repeats_slider.grid(row=3, column=1, padx=12, pady=(8,2), sticky="ew")
        self.repeats_label = ctk.CTkLabel(run_card, text=str(self.repeats_var.get())); self.repeats_label.grid(row=3, column=2, padx=12, pady=(8,2), sticky="w")
        self.repeats_slider.configure(command=lambda v: self.repeats_label.configure(text=str(int(v))))

        self.save_plots_var = ctk.BooleanVar(value=True); self.save_bar_var = ctk.BooleanVar(value=True)
        ctk.CTkSwitch(run_card, text="Save per-sound plot", variable=self.save_plots_var).grid(row=4, column=0, padx=12, pady=4, sticky="w")
        ctk.CTkSwitch(run_card, text="Save overall bar chart", variable=self.save_bar_var).grid(row=4, column=1, padx=12, pady=4, sticky="w")

        ctk.CTkLabel(run_card, text="Output Folder").grid(row=5, column=0, padx=12, pady=(8,2), sticky="w")
        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        row = ctk.CTkFrame(run_card); row.grid(row=5, column=1, columnspan=2, padx=12, pady=(4,8), sticky="ew"); row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(row, textvariable=self.output_dir_var); self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0,8))
        ctk.CTkButton(row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)

        btns = ctk.CTkFrame(run_card); btns.grid(row=6, column=0, columnspan=3, padx=12, pady=(0,10), sticky="ew")
        ctk.CTkButton(btns, text="Run Selected", command=self.on_run_selected).pack(side="left", padx=6)
        ctk.CTkButton(btns, text="Run ALL", command=self.on_run_all).pack(side="left", padx=6)
        ctk.CTkButton(btns, text="Save Text Report", command=self.on_save_report).pack(side="right", padx=6)

        kpis = ctk.CTkFrame(self); kpis.grid(row=2, column=0, columnspan=2, padx=18, pady=(0,12), sticky="ew")
        for i in range(3): kpis.grid_columnconfigure(i, weight=1)
        self.kpi_avg = self._kpi(kpis, "Average (ms)", "--", 0)
        self.kpi_std = self._kpi(kpis, "Std Dev (ms)", "--", 1)
        self.kpi_last = self._kpi(kpis, "Last (ms)", "--", 2)

        self.summary_box = ctk.CTkTextbox(self, wrap="word", height=160)
        self.summary_box.grid(row=3, column=0, columnspan=2, padx=18, pady=(0,12), sticky="nsew")

        cal_card = ctk.CTkFrame(self, corner_radius=10)
        cal_card.grid(row=4, column=0, columnspan=2, padx=18, pady=12, sticky="ew")
        ctk.CTkLabel(cal_card, text="Calibration", font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, columnspan=2, padx=12, pady=(12,4), sticky="w")

        self.cal_vars = {}
        for i, p in enumerate(SOUND_PRESETS):
            var = ctk.BooleanVar(value=True); self.cal_vars[p["key"]] = var
            ctk.CTkSwitch(cal_card, text=p["name"], variable=var).grid(row=1+i//3, column=i%3, padx=12, pady=6, sticky="w")

        self.cal_repeats_var = ctk.IntVar(value=5)
        ctk.CTkLabel(cal_card, text="Repeats").grid(row=3, column=0, padx=12, pady=(8,2), sticky="w")
        slider = ctk.CTkSlider(cal_card, from_=1, to=20, number_of_steps=19)
        slider.set(self.cal_repeats_var.get()); slider.grid(row=3, column=1, padx=12, pady=(8,2), sticky="ew")
        reps_lab = ctk.CTkLabel(cal_card, text=str(self.cal_repeats_var.get())); reps_lab.grid(row=3, column=2, padx=12, pady=(8,2), sticky="w")
        slider.configure(command=lambda v: reps_lab.configure(text=str(int(v))))

        btns2 = ctk.CTkFrame(cal_card); btns2.grid(row=4, column=0, columnspan=3, padx=12, pady=(0,10), sticky="ew")
        ctk.CTkButton(btns2, text="Calibrate Selected Presets", command=self.on_cal_selected).pack(side="left", padx=6)
        ctk.CTkButton(btns2, text="Calibrate ALL Presets", command=self.on_cal_all).pack(side="left", padx=6)
        ctk.CTkButton(btns2, text="Calibrate GLOBAL (Impulse)", command=self.on_cal_global).pack(side="left", padx=6)

        self.baseline_box = ctk.CTkTextbox(self, wrap="word", height=140)
        self.baseline_box.grid(row=5, column=0, columnspan=2, padx=18, pady=(0,18), sticky="ew")
        self._refresh_baseline_box()

        self.worker = None

    def _kpi(self, parent, title, value, col):
        card = ctk.CTkFrame(parent, corner_radius=10); card.grid(row=0, column=col, padx=6, sticky="ew")
        ctk.CTkLabel(card, text=title).pack(anchor="w", padx=12, pady=(10,0))
        val = ctk.CTkLabel(card, text=value, font=ctk.CTkFont(size=22, weight="bold"))
        val.pack(anchor="w", padx=12, pady=(4,12)); return val

    def on_run_selected(self):
        presets = [p for p in SOUND_PRESETS if self.preset_vars[p["key"]].get()]
        if not presets: return
        self._start(self._run_tests, presets)

    def on_run_all(self):
        self._start(self._run_tests, SOUND_PRESETS[:])

    def on_save_report(self):
        if not hasattr(self, "last_all_results"): return
        out_dir = self.output_dir_var.get() or os.getcwd()
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"latency_report_{ts}.txt")
        report = self._build_text_report()
        with open(path, "w", encoding="utf-8") as f:
            f.write(report)
        self.log(f"[SAVE] report -> {path}")

    def on_cal_selected(self):
        presets = [p for p in SOUND_PRESETS if self.cal_vars[p["key"]].get()]
        if not presets: return
        self._start(self._cal_presets, presets)

    def on_cal_all(self):
        self._start(self._cal_presets, SOUND_PRESETS[:])

    def on_cal_global(self):
        self._start(self._cal_global)

    def _start(self, fn, *args):
        import threading
        if hasattr(self, "worker") and self.worker and self.worker.is_alive():
            self.log("[BUSY] another task running."); return
        self.worker = threading.Thread(target=self._guard, args=(fn, *args), daemon=True); self.worker.start()

    def _guard(self, fn, *args):
        try: fn(*args)
        except Exception as e: self.log(f"[ERROR] {e}")

    def _run_tests(self, presets):
        repeats = int(self.repeats_slider.get())
        self.last_repeats = repeats
        out_dir = self.output_dir_var.get() or os.getcwd(); ensure_dir(out_dir)

        all_results = {}; overall = []; last = None; bars = {}
        for p in presets:
            results = self.runner.run_test(self.core, p, repeats=repeats, save_plot_dir=out_dir if self.save_plots_var.get() else None)
            l = results["left_ms"]
            r = results["right_ms"]
            avg = results["avg_ms"]
            diff = results["diff_ms"]
            all_results[p["name"]] = {
                "per_sound_baseline_ms": self.cfg["per_sound_offsets_ms"].get(p["key"], 0.0),
                "left_ms": l,
                "right_ms": r,
                "avg_ms": avg,
                "diff_ms": diff,
            }
            bars[p["name"]] = avg
            if avg:
                overall.extend(avg)
                last = avg[-1]

        self.last_all_results = all_results
        self._refresh_summary(all_results)

        if overall:
            self.kpi_avg.configure(text=f"{np.mean(overall):.1f}")
            self.kpi_std.configure(text=f"{np.std(overall):.1f}")
            self.kpi_last.configure(text=f"{last:.1f}")
        else:
            self.kpi_avg.configure(text="--"); self.kpi_std.configure(text="--"); self.kpi_last.configure(text="--")

        if self.save_bar_var.get():
            try:
                from ...tests.latency import DelayRunner
                ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                bar_path = os.path.join(out_dir, f"overall_bar_{ts}.png")
                ok = DelayRunner.save_bar(bars, bar_path)
                if ok: self.log(f"[SAVE] bar chart -> {bar_path}")
            except Exception as e:
                self.log(f"[WARN] bar chart failed: {e}")
        self.log("[DONE] tests complete.")

    def _build_text_report(self):
        all_results = getattr(self, "last_all_results", {})
        repeats = getattr(self, "last_repeats", 0)
        sr_out = self.core.sample_rate
        sr_in = self.core.input_sample_rate
        dur = self.core.duration
        global_off = float(self.cfg.get("global_system_offset_ms", 0.0))
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        overall_left = [d for v in all_results.values() for d in v["left_ms"]]
        overall_right = [d for v in all_results.values() for d in v["right_ms"]]
        overall_diff = [d for v in all_results.values() for d in v["diff_ms"]]
        overall_avg_list = [d for v in all_results.values() for d in v["avg_ms"]]
        overall_avg_L = float(np.mean(overall_left)) if overall_left else 0.0
        overall_avg_R = float(np.mean(overall_right)) if overall_right else 0.0
        overall_avg_diff = float(np.mean(overall_diff)) if overall_diff else 0.0
        overall_std_diff = float(np.std(overall_diff)) if overall_diff else 0.0
        overall_avg = float(np.mean(overall_avg_list)) if overall_avg_list else 0.0
        overall_std = float(np.std(overall_avg_list)) if overall_avg_list else 0.0
        total_success = len(overall_avg_list)

        lines = [
            "="*60,
            "HEADPHONE DELAY TEST REPORT",
            "="*60,
            f"Test Date: {now}",
            f"Overall Tests Per Sound Type: {repeats}",
            f"Output Sample Rate: {sr_out} Hz",
            f"Input Sample Rate: {sr_in} Hz",
            f"Default Test Signal Buffer Duration: {dur} seconds (Sine waves use this primarily)",
            f"Calibration Offset Applied: {global_off:.4f} ms",
            "",
            "",
            "==================== OVERALL AVERAGE CALIBRATED DELAY (ALL SOUND TYPES) ====================",
            f"Overall Average Calibrated Delay: L {overall_avg_L:.4f} ms | R {overall_avg_R:.4f} ms",
            f"Overall Average Difference (L-R): {overall_avg_diff:.4f} ms",
            f"Std Dev of Difference: {overall_std_diff:.4f} ms",
            f"Overall Average (L&R): {overall_avg:.4f} ms",
            f"Overall Standard Deviation (avg): {overall_std:.4f} ms",
            f"Total Successful Tests: {total_success}",
            "="*60,
            "",
        ]

        for p in SOUND_PRESETS:
            name = p["name"]
            if name not in all_results:
                continue
            data = all_results[name]
            l = data["left_ms"]
            r = data["right_ms"]
            diff = data["diff_ms"]
            lines.append(f"==================== Results for '{name}' ====================")
            lines.append("Individual test results (Calibrated):")
            lines.append("------------------------------")
            for i in range(len(l)):
                lines.append(f"Test {i+1}: L {l[i]:.4f} ms | R {r[i]:.4f} ms | Δ {diff[i]:.4f} ms")
            lines.append("")
            lines.append(f"STATISTICAL ANALYSIS for '{name}' (Calibrated):")
            lines.append("------------------------------")
            if l and r:
                avg_l = float(np.mean(l)); std_l = float(np.std(l))
                avg_r = float(np.mean(r)); std_r = float(np.std(r))
                avg_diff = float(np.mean(diff)); std_diff = float(np.std(diff))
                lines.extend([
                    f"Average L delay: {avg_l:.4f} ms",
                    f"Std Dev L: {std_l:.4f} ms",
                    f"Average R delay: {avg_r:.4f} ms",
                    f"Std Dev R: {std_r:.4f} ms",
                    f"Average difference (L-R): {avg_diff:.4f} ms",
                    f"Std Dev difference: {std_diff:.4f} ms",
                ])
            else:
                avg_l = avg_r = None
                lines.append("No successful runs")
            lines.append("")
            lines.append(f"PERFORMANCE ASSESSMENT for '{name}' (Calibrated):")
            lines.append("------------------------------")
            if avg_l is not None and avg_r is not None:
                avg = float(np.mean([avg_l, avg_r]))
                perf_label, perf_desc = self._performance_label(avg)
                lines.append(f"Performance: {perf_label}")
                lines.append(perf_desc)
            else:
                lines.append("Performance: N/A")
            lines.append("")
            lines.append(f"CONSISTENCY ANALYSIS for '{name}':")
            lines.append("------------------------------")
            if avg_l is not None and avg_r is not None:
                std_avg = float(np.mean([std_l, std_r]))
                cons_label = self._consistency_label(std_avg)
                lines.append(f"Consistency: {cons_label}")
            else:
                lines.append("Consistency: N/A")
            lines.append("")
            lines.append(f"RAW DATA (Calibrated Delays for '{name}'):")
            lines.append("------------------------------")
            if l and r:
                lines.append("L (ms): " + ", ".join(f"{x:.4f}" for x in l))
                lines.append("R (ms): " + ", ".join(f"{x:.4f}" for x in r))
                lines.append("Δ (ms): " + ", ".join(f"{x:.4f}" for x in diff))
            else:
                lines.append("No data")
            lines.append("")

        lines.append("="*60)
        lines.append("REPORT END")
        lines.append("="*60)
        return "\n".join(lines)

    @staticmethod
    def _performance_label(avg):
        if avg <= 40:
            return "Good (< 40ms)", "Your headphones have low latency - suitable for most tasks."
        if avg <= 80:
            return "Moderate (40-80ms)", "Your headphones have moderate latency - may be noticeable."
        return "Poor (> 80ms)", "Your headphones have high latency - may cause audio sync issues."

    @staticmethod
    def _consistency_label(std):
        if std <= 10:
            return "Good (low variation)"
        if std <= 30:
            return "Moderate (some variation)"
        return "Poor (high variation - check audio setup)"

    def _cal_presets(self, presets):
        reps = int(self.cal_repeats_var.get())
        for p in presets: self.runner.calibrate_preset(self.core, p, repeats=reps)
        save_config(self.cfg); self._refresh_baseline_box(); self.log("[DONE] per-sound calibration complete.")

    def _cal_global(self):
        reps = int(self.cal_repeats_var.get())
        val, _ = self.runner.calibrate_global(self.core, repeats=reps)
        if val is not None: self.log(f"[CAL] GLOBAL set to {val:.2f} ms")
        save_config(self.cfg); self._refresh_baseline_box(); self.log("[DONE] global calibration complete.")

    def _refresh_summary(self, all_results):
        lines = ["=== SUMMARY (Calibrated) ==="]
        for name, data in all_results.items():
            l = data["left_ms"]
            r = data["right_ms"]
            diff = data["diff_ms"]
            if l and r:
                lines.append(f"{name}: L {np.mean(l):.2f} ms | R {np.mean(r):.2f} ms | Δ {np.mean(diff):.2f} ms")
            else:
                lines.append(f"{name}: no successful runs")
        self.summary_box.delete("1.0", "end"); self.summary_box.insert("1.0", "\n".join(lines))

    def _refresh_baseline_box(self):
        from ...tests.latency import SOUND_PRESETS
        lines = ["Per-sound baselines (ms):"]
        for p in SOUND_PRESETS:
            val = self.cfg["per_sound_offsets_ms"].get(p["key"], 0.0)
            lines.append(f"• {p['name']}: {val:.2f}")
        lines.append(f"\nGLOBAL offset: {self.cfg.get('global_system_offset_ms', 0.0):.2f} ms")
        self.baseline_box.delete("1.0", "end"); self.baseline_box.insert("1.0", "\n".join(lines))

    def _choose_outdir(self):
        from tkinter import filedialog
        d = filedialog.askdirectory()
        if d:
            self.output_dir_var.set(d); self.cfg["last_settings"]["output_dir"] = d; save_config(self.cfg)
