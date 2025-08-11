import os, json, customtkinter as ctk
from ...tests import sweep_fr
from ...core.utils import ensure_dir
from ...config import save_config


class SweepFRPage(ctk.CTkFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.results = []
        self.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(self, text="Sweep Frequency Response", font=ctk.CTkFont(size=18, weight="bold")).grid(
            row=0, column=0, padx=18, pady=(18, 4), sticky="w"
        )

        run_card = ctk.CTkFrame(self)
        run_card.grid(row=1, column=0, padx=18, pady=12, sticky="ew")
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

        ctk.CTkLabel(run_card, text="Output Folder").grid(row=4, column=0, padx=8, pady=(8, 2), sticky="w")
        self.output_dir_var = ctk.StringVar(value=self.cfg["last_settings"].get("output_dir", os.getcwd()))
        row = ctk.CTkFrame(run_card)
        row.grid(row=4, column=1, columnspan=3, padx=8, pady=(4, 8), sticky="ew")
        row.grid_columnconfigure(0, weight=1)
        self.output_entry = ctk.CTkEntry(row, textvariable=self.output_dir_var)
        self.output_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ctk.CTkButton(row, text="Browse", command=self._choose_outdir, width=90).grid(row=0, column=1)

        ctk.CTkButton(run_card, text="Run Sweep", command=self.on_run).grid(row=5, column=0, padx=8, pady=(4, 8), sticky="w")

        res = ctk.CTkFrame(self)
        res.grid(row=2, column=0, padx=18, pady=12, sticky="nsew")
        res.grid_rowconfigure(1, weight=1)
        res.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(res, text="Sweep FR Results").grid(row=0, column=0, sticky="w", padx=8, pady=(8, 4))
        self.box = ctk.CTkTextbox(res)
        self.box.grid(row=1, column=0, sticky="nsew", padx=8, pady=8)
        row2 = ctk.CTkFrame(res)
        row2.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))
        ctk.CTkButton(row2, text="Export LAST (JSON)", command=self.export_last).pack(side="left", padx=4)
        ctk.CTkButton(row2, text="Export ALL (JSON)", command=self.export_all).pack(side="left", padx=4)

    def _choose_outdir(self):
        from tkinter import filedialog

        d = filedialog.askdirectory()
        if d:
            self.output_dir_var.set(d)
            self.cfg["last_settings"]["output_dir"] = d
            save_config(self.cfg)

    def on_run(self):
        out_dir = self.output_dir_var.get() or os.getcwd()
        r = sweep_fr.run(
            self.core,
            self.log,
            f0=float(self.var_f0.get()),
            f1=float(self.var_f1.get()),
            duration=float(self.var_dur.get()),
            repeats=int(self.var_rep.get()),
            save_plot_dir=out_dir if self.save_plots_var.get() else None,
        )
        self._push(r)

    def _push(self, res):
        self.results.append(res.to_dict())
        self.box.insert("end", json.dumps(res.to_dict(), indent=2, ensure_ascii=False) + "\n\n")
        self.box.see("end")

    def export_last(self):
        if not self.results:
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
            return
        out_dir = self.output_dir_var.get() or os.getcwd()
        ensure_dir(out_dir)
        import datetime

        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"sweep_fr_all_{ts}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.results, f, indent=2, ensure_ascii=False)
        self.log(f"[EXPORT] all -> {path}")

