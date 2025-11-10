import datetime
import os

import customtkinter as ctk
import numpy as np

from ...tests.latency import DelayRunner, SOUND_PRESETS
from ...core.utils import ensure_dir
from ...config import save_config


class LatencyPage(ctk.CTkScrollableFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.runner = DelayRunner(self.cfg, self.log)

        self.page_title_font = ctk.CTkFont(size=20, weight="bold")
        self.section_font = ctk.CTkFont(size=14, weight="bold")
        self.metric_font = ctk.CTkFont(size=24, weight="bold")
        self.button_style = {"height": 36, "corner_radius": 8}

        self.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            self,
            text="Latency",
            font=self.page_title_font,
        ).grid(row=0, column=0, padx=24, pady=(24, 12), sticky="w")

        run_frame = self._section(row=1, title="Run Delay Tests")
        run_frame.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self.preset_vars = {}
        preset_container = ctk.CTkFrame(run_frame, fg_color="transparent")
        preset_container.grid(row=1, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 12))
        preset_container.grid_columnconfigure((0, 1, 2), weight=1)
        for i, preset in enumerate(SOUND_PRESETS):
            var = ctk.BooleanVar(value=(preset["key"] != "impulse"))
            self.preset_vars[preset["key"]] = var
            ctk.CTkSwitch(
                preset_container,
                text=preset["name"],
                variable=var,
            ).grid(row=i // 3, column=i % 3, padx=8, pady=6, sticky="w")

        slider_row = ctk.CTkFrame(run_frame, fg_color="transparent")
        slider_row.grid(row=2, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 12))
        slider_row.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(slider_row, text="Repeats").grid(row=0, column=0, sticky="w", padx=(0, 12))
        self.repeats_var = ctk.IntVar(value=self.cfg["last_settings"]["repeats"])
        self.repeats_slider = ctk.CTkSlider(slider_row, from_=1, to=20, number_of_steps=19)
        self.repeats_slider.set(self.repeats_var.get())
        self.repeats_slider.grid(row=0, column=1, sticky="ew")
        self.repeats_label = ctk.CTkLabel(slider_row, text=str(self.repeats_var.get()))
        self.repeats_label.grid(row=0, column=2, sticky="e")
        self.repeats_slider.configure(command=self._on_repeats_change)

        options_row = ctk.CTkFrame(run_frame, fg_color="transparent")
        options_row.grid(row=3, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 12))
        options_row.grid_columnconfigure((0, 1), weight=1)
        self.save_plots_var = ctk.BooleanVar(value=True)
        self.save_bar_var = ctk.BooleanVar(value=True)
        ctk.CTkSwitch(
            options_row,
            text="Save per-sound plot",
            variable=self.save_plots_var,
        ).grid(row=0, column=0, sticky="w", pady=4)
        ctk.CTkSwitch(
            options_row,
            text="Save overall bar chart",
            variable=self.save_bar_var,
        ).grid(row=0, column=1, sticky="w", pady=4)

        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        ctk.CTkLabel(run_frame, text="Output Folder").grid(
            row=4, column=0, sticky="w", padx=(18, 8), pady=(0, 6)
        )
        output_row = ctk.CTkFrame(run_frame, fg_color="transparent")
        output_row.grid(row=4, column=1, columnspan=3, sticky="ew", padx=(0, 18), pady=(0, 12))
        output_row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(output_row, textvariable=self.output_dir_var)
        self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkButton(output_row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)

        button_row = ctk.CTkFrame(run_frame, fg_color="transparent")
        button_row.grid(row=5, column=0, columnspan=4, sticky="ew", padx=18, pady=(0, 16))
        button_row.grid_columnconfigure((0, 1), weight=0)
        button_row.grid_columnconfigure(2, weight=1)
        ctk.CTkButton(
            button_row,
            text="Run Selected",
            command=self.on_run_selected,
            **self.button_style,
        ).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(
            button_row,
            text="Run ALL",
            command=self.on_run_all,
            **self.button_style,
        ).grid(row=0, column=1, sticky="w", padx=12)
        ctk.CTkButton(
            button_row,
            text="Save Text Report",
            command=self.on_save_report,
            **self.button_style,
        ).grid(row=0, column=2, sticky="e")

        summary_frame = self._section(row=2, title="Results Summary")
        summary_frame.grid_columnconfigure((0, 1, 2), weight=1)
        summary_frame.grid_rowconfigure(3, weight=1)
        metrics_row = ctk.CTkFrame(summary_frame, fg_color="transparent")
        metrics_row.grid(row=1, column=0, columnspan=3, sticky="ew", padx=18, pady=(0, 12))
        metrics_row.grid_columnconfigure((0, 1, 2), weight=1)
        self.kpi_avg = self._kpi(metrics_row, "Average (ms)", "--", 0)
        self.kpi_std = self._kpi(metrics_row, "Std Dev (ms)", "--", 1)
        self.kpi_last = self._kpi(metrics_row, "Last (ms)", "--", 2)

        ctk.CTkLabel(
            summary_frame,
            text="Detailed Breakdown",
            font=ctk.CTkFont(size=12, weight="bold"),
        ).grid(row=2, column=0, columnspan=3, sticky="w", padx=18, pady=(0, 6))
        self.summary_box = ctk.CTkTextbox(summary_frame, wrap="word", height=160)
        self.summary_box.grid(row=3, column=0, columnspan=3, sticky="nsew", padx=18, pady=(0, 16))

        plot_frame = self._section(row=3, title="Latency Plot")
        plot_frame.grid_columnconfigure(0, weight=1)
        self.plot_holder = ctk.CTkFrame(plot_frame, corner_radius=12, border_width=1, height=240)
        self.plot_holder.grid(row=1, column=0, sticky="ew", padx=18, pady=(0, 16))
        self.plot_holder.grid_propagate(False)
        ctk.CTkLabel(
            self.plot_holder,
            text="Plots will open in a separate Matplotlib window when available.",
            justify="left",
            wraplength=520,
        ).pack(fill="both", expand=True, padx=16, pady=16)

        cal_frame = self._section(row=4, title="Calibration")
        cal_frame.grid_columnconfigure((0, 1, 2), weight=1)

        self.cal_vars = {}
        cal_container = ctk.CTkFrame(cal_frame, fg_color="transparent")
        cal_container.grid(row=1, column=0, columnspan=3, sticky="ew", padx=18, pady=(0, 12))
        cal_container.grid_columnconfigure((0, 1, 2), weight=1)
        for i, preset in enumerate(SOUND_PRESETS):
            var = ctk.BooleanVar(value=True)
            self.cal_vars[preset["key"]] = var
            ctk.CTkSwitch(
                cal_container,
                text=preset["name"],
                variable=var,
            ).grid(row=i // 3, column=i % 3, padx=8, pady=6, sticky="w")

        cal_slider_row = ctk.CTkFrame(cal_frame, fg_color="transparent")
        cal_slider_row.grid(row=2, column=0, columnspan=3, sticky="ew", padx=18, pady=(0, 12))
        cal_slider_row.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(cal_slider_row, text="Repeats").grid(row=0, column=0, sticky="w", padx=(0, 12))
        self.cal_repeats_var = ctk.IntVar(value=5)
        cal_slider = ctk.CTkSlider(cal_slider_row, from_=1, to=20, number_of_steps=19)
        cal_slider.set(self.cal_repeats_var.get())
        cal_slider.grid(row=0, column=1, sticky="ew")
        self.cal_repeats_label = ctk.CTkLabel(cal_slider_row, text=str(self.cal_repeats_var.get()))
        self.cal_repeats_label.grid(row=0, column=2, sticky="e")
        cal_slider.configure(command=self._on_cal_repeats_change)

        cal_button_row = ctk.CTkFrame(cal_frame, fg_color="transparent")
        cal_button_row.grid(row=3, column=0, columnspan=3, sticky="ew", padx=18, pady=(0, 12))
        cal_button_row.grid_columnconfigure((0, 1, 2), weight=1)
        ctk.CTkButton(
            cal_button_row,
            text="Calibrate Selected Presets",
            command=self.on_cal_selected,
            **self.button_style,
        ).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(
            cal_button_row,
            text="Calibrate ALL Presets",
            command=self.on_cal_all,
            **self.button_style,
        ).grid(row=0, column=1, sticky="w", padx=12)
        ctk.CTkButton(
            cal_button_row,
            text="Calibrate GLOBAL (Impulse)",
            command=self.on_cal_global,
            **self.button_style,
        ).grid(row=0, column=2, sticky="e")

        ctk.CTkLabel(
            cal_frame,
            text="Calibration Offsets",
            font=ctk.CTkFont(size=12, weight="bold"),
        ).grid(row=4, column=0, columnspan=3, sticky="w", padx=18, pady=(4, 6))
        self.baseline_box = ctk.CTkTextbox(cal_frame, wrap="word", height=140)
        self.baseline_box.grid(row=5, column=0, columnspan=3, sticky="ew", padx=18, pady=(0, 16))
        self._refresh_baseline_box()

        self.worker = None

    def _section(self, row: int, title: str) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(self)
        frame.grid(row=row, column=0, sticky="nsew", padx=24, pady=(0, 16))
        frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(frame, text=title, font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        return frame

    def _on_repeats_change(self, value: float) -> None:
        count = int(value)
        self.repeats_var.set(count)
        self.repeats_label.configure(text=str(count))

    def _on_cal_repeats_change(self, value: float) -> None:
        count = int(value)
        self.cal_repeats_var.set(count)
        self.cal_repeats_label.configure(text=str(count))

    def _kpi(self, parent, title, value, col):
        card = ctk.CTkFrame(parent, corner_radius=12)
        card.grid(row=0, column=col, padx=8, sticky="ew")
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(card, text=title).grid(row=0, column=0, sticky="w", padx=12, pady=(12, 4))
        val = ctk.CTkLabel(card, text=value, font=self.metric_font)
        val.grid(row=1, column=0, sticky="w", padx=12, pady=(0, 12))
        return val
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
            delays = [r for r in results if r is not None]
            all_results[p["name"]] = {"per_sound_baseline_ms": self.cfg["per_sound_offsets_ms"].get(p["key"], 0.0), "delays_ms": delays}
            bars[p["name"]] = delays
            if delays: overall.extend(delays); last = delays[-1]

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

        overall_delays = [d for v in all_results.values() for d in v["delays_ms"]]
        overall_avg = np.mean(overall_delays) if overall_delays else 0.0
        overall_std = np.std(overall_delays) if overall_delays else 0.0
        total_success = len(overall_delays)

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
            f"Overall Average Calibrated Delay: {overall_avg:.4f} ms",
            f"Overall Standard Deviation: {overall_std:.4f} ms",
            f"Total Successful Tests: {total_success}",
            "="*60,
            "",
        ]

        for p in SOUND_PRESETS:
            name = p["name"]
            if name not in all_results:
                continue
            data = all_results[name]
            delays = data["delays_ms"]
            lines.append(f"==================== Results for '{name}' ====================")
            lines.append("Individual test results (Calibrated):")
            lines.append("------------------------------")
            for i, d in enumerate(delays, 1):
                lines.append(f"Test {i}: {d:.4f} ms")
            lines.append("")
            lines.append(f"STATISTICAL ANALYSIS for '{name}' (Calibrated):")
            lines.append("------------------------------")
            if delays:
                avg = float(np.mean(delays))
                std = float(np.std(delays))
                mn = float(np.min(delays))
                mx = float(np.max(delays))
                rng = mx - mn
                lines.extend([
                    f"Average calibrated delay: {avg:.4f} ms",
                    f"Standard deviation: {std:.4f} ms",
                    f"Minimum calibrated delay: {mn:.4f} ms",
                    f"Maximum calibrated delay: {mx:.4f} ms",
                    f"Range: {rng:.4f} ms",
                ])
            else:
                avg = std = None
                lines.append("No successful runs")
            lines.append("")
            lines.append(f"PERFORMANCE ASSESSMENT for '{name}' (Calibrated):")
            lines.append("------------------------------")
            if avg is not None:
                perf_label, perf_desc = self._performance_label(avg)
                lines.append(f"Performance: {perf_label}")
                lines.append(perf_desc)
            else:
                lines.append("Performance: N/A")
            lines.append("")
            lines.append(f"CONSISTENCY ANALYSIS for '{name}':")
            lines.append("------------------------------")
            if std is not None:
                cons_label = self._consistency_label(std)
                lines.append(f"Consistency: {cons_label}")
            else:
                lines.append("Consistency: N/A")
            lines.append("")
            lines.append(f"RAW DATA (Calibrated Delays for '{name}'):")
            lines.append("------------------------------")
            if delays:
                lines.append("Delays (ms): " + ", ".join(f"{d:.4f}" for d in delays))
            else:
                lines.append("Delays (ms): none")
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
            dd = data["delays_ms"]
            if dd: lines.append(f"{name}: avg {np.mean(dd):.2f} ms | std {np.std(dd):.2f} | n {len(dd)}")
            else: lines.append(f"{name}: no successful runs")
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
