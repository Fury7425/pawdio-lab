import os, json, customtkinter as ctk
from ...experimental_tests import balance, crosstalk, thd, isolation
from ...core.utils import ensure_dir


class ExperimentalPage(ctk.CTkFrame):
    def __init__(self, master, core, cfg, log_fn):
        super().__init__(master, corner_radius=0)
        self.core = core
        self.cfg = cfg
        self.log = log_fn
        self.results = []

        self.page_title_font = ctk.CTkFont(size=20, weight="bold")
        self.section_font = ctk.CTkFont(size=14, weight="bold")
        self.button_style = {"height": 36, "corner_radius": 8}

        self.grid_columnconfigure((0, 1), weight=1)

        ctk.CTkLabel(
            self,
            text="Experimental Tests",
            font=self.page_title_font,
        ).grid(row=0, column=0, columnspan=2, padx=24, pady=(24, 12), sticky="w")

        cards_container = ctk.CTkFrame(self, fg_color="transparent")
        cards_container.grid(row=1, column=0, columnspan=2, sticky="nsew", padx=24, pady=(12, 16))
        cards_container.grid_columnconfigure((0, 1), weight=1)
        cards_container.grid_rowconfigure((0, 1), weight=1)

        balance_card = ctk.CTkFrame(cards_container, corner_radius=12)
        balance_card.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)
        balance_card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(balance_card, text="Channel Balance", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        ctk.CTkLabel(balance_card, text="Frequency (Hz)").grid(row=1, column=0, sticky="w", padx=18, pady=(0, 6))
        self.var_bal = ctk.StringVar(value="1000")
        ctk.CTkEntry(balance_card, textvariable=self.var_bal).grid(row=2, column=0, sticky="ew", padx=18, pady=(0, 12))
        ctk.CTkButton(balance_card, text="Run", command=self.on_balance, **self.button_style).grid(
            row=3, column=0, sticky="e", padx=18, pady=(0, 18)
        )

        crosstalk_card = ctk.CTkFrame(cards_container, corner_radius=12)
        crosstalk_card.grid(row=0, column=1, sticky="nsew", padx=12, pady=12)
        crosstalk_card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(crosstalk_card, text="Crosstalk", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        fields_row = ctk.CTkFrame(crosstalk_card, fg_color="transparent")
        fields_row.grid(row=1, column=0, sticky="ew", padx=18, pady=(0, 12))
        fields_row.grid_columnconfigure(0, weight=1)
        fields_row.grid_columnconfigure(1, weight=0)
        ctk.CTkLabel(fields_row, text="Frequency (Hz)").grid(row=0, column=0, sticky="w", pady=(0, 6))
        self.var_xt = ctk.StringVar(value="1000")
        ctk.CTkEntry(fields_row, textvariable=self.var_xt).grid(row=1, column=0, sticky="ew", pady=(0, 6))
        self.var_dir = ctk.StringVar(value="LtoR")
        ctk.CTkOptionMenu(fields_row, values=["LtoR", "RtoL"], variable=self.var_dir).grid(row=1, column=1, padx=(12, 0), sticky="e")
        ctk.CTkButton(crosstalk_card, text="Run", command=self.on_crosstalk, **self.button_style).grid(
            row=2, column=0, sticky="e", padx=18, pady=(0, 18)
        )

        thd_card = ctk.CTkFrame(cards_container, corner_radius=12)
        thd_card.grid(row=1, column=0, sticky="nsew", padx=12, pady=12)
        thd_card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(thd_card, text="THD", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        ctk.CTkLabel(
            thd_card,
            text="Runs 100 / 1k / 6k Hz distortion measurements.",
            wraplength=260,
        ).grid(row=1, column=0, sticky="w", padx=18, pady=(0, 12))
        ctk.CTkButton(thd_card, text="Run", command=self.on_thd, **self.button_style).grid(
            row=2, column=0, sticky="e", padx=18, pady=(0, 18)
        )

        iso_card = ctk.CTkFrame(cards_container, corner_radius=12)
        iso_card.grid(row=1, column=1, sticky="nsew", padx=12, pady=12)
        iso_card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(iso_card, text="Isolation", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        ctk.CTkLabel(
            iso_card,
            text="Measures inside → outside isolation.",
            wraplength=260,
        ).grid(row=1, column=0, sticky="w", padx=18, pady=(0, 12))
        ctk.CTkButton(iso_card, text="Run", command=self.on_isolation, **self.button_style).grid(
            row=2, column=0, sticky="e", padx=18, pady=(0, 18)
        )

        results_frame = ctk.CTkFrame(self, corner_radius=12)
        results_frame.grid(row=2, column=0, columnspan=2, sticky="nsew", padx=24, pady=(0, 16))
        results_frame.grid_columnconfigure(0, weight=1)
        results_frame.grid_rowconfigure(1, weight=1)
        ctk.CTkLabel(results_frame, text="Experimental Results", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        self.box = ctk.CTkTextbox(results_frame)
        self.box.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 16))

        export_frame = ctk.CTkFrame(self, fg_color="transparent")
        export_frame.grid(row=3, column=0, columnspan=2, sticky="e", padx=24, pady=(0, 24))
        ctk.CTkButton(export_frame, text="Export LAST (JSON)", command=self.export_last, **self.button_style).grid(
            row=0, column=0, padx=(0, 12)
        )
        ctk.CTkButton(export_frame, text="Export ALL (JSON)", command=self.export_all, **self.button_style).grid(row=0, column=1)
    def on_balance(self):
        r = balance.run(self.core, self.log, freq=float(self.var_bal.get()))
        self._push(r)

    def on_crosstalk(self):
        r = crosstalk.run(self.core, self.log, freq=float(self.var_xt.get()), direction=self.var_dir.get())
        self._push(r)

    def on_thd(self):
        r = thd.run(self.core, self.log)
        self._push(r)

    def on_isolation(self):
        r = isolation.run(self.core, self.log)
        self._push(r)

    def _push(self, res):
        self.results.append(res.to_dict())
        self.box.insert("end", json.dumps(res.to_dict(), indent=2, ensure_ascii=False) + "\n\n")
        self.box.see("end")

    def export_last(self):
        if not self.results: return
        out_dir = self.cfg["last_settings"].get("output_dir", os.getcwd()); ensure_dir(out_dir)
        last = self.results[-1]
        import json, datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"experimental_last_{ts}.json")
        with open(path, "w", encoding="utf-8") as f: json.dump(last, f, indent=2, ensure_ascii=False)
        self.log(f"[EXPORT] last -> {path}")

    def export_all(self):
        if not self.results: return
        out_dir = self.cfg["last_settings"].get("output_dir", os.getcwd()); ensure_dir(out_dir)
        import json, datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(out_dir, f"experimental_all_{ts}.json")
        with open(path, "w", encoding="utf-8") as f: json.dump(self.results, f, indent=2, ensure_ascii=False)
        self.log(f"[EXPORT] all -> {path}")
