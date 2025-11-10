
import customtkinter as ctk


class ResultsPage(ctk.CTkFrame):
    def __init__(self, master, log_sink):
        super().__init__(master, corner_radius=0)
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self.page_title_font = ctk.CTkFont(size=20, weight="bold")
        self.section_font = ctk.CTkFont(size=14, weight="bold")
        self.button_style = {"height": 36, "corner_radius": 8}

        ctk.CTkLabel(
            self,
            text="Results / Log",
            font=self.page_title_font,
        ).grid(row=0, column=0, padx=24, pady=(24, 12), sticky="w")

        log_frame = ctk.CTkFrame(self, corner_radius=12)
        log_frame.grid(row=1, column=0, sticky="nsew", padx=24, pady=(0, 16))
        log_frame.grid_columnconfigure(0, weight=1)
        log_frame.grid_rowconfigure(1, weight=1)
        ctk.CTkLabel(log_frame, text="Results / Log", font=self.section_font).grid(
            row=0, column=0, sticky="w", padx=18, pady=(16, 10)
        )
        self.log_box = ctk.CTkTextbox(log_frame, wrap="word")
        self.log_box.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 16))
        self._sink = log_sink

        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="e", padx=24, pady=(0, 24))
        ctk.CTkButton(btns, text="Copy Log", command=self.copy_log, **self.button_style).grid(row=0, column=0, padx=(0, 12))
        ctk.CTkButton(btns, text="Clear Log", command=self.clear_log, **self.button_style).grid(row=0, column=1)

    def append(self, msg):
        self.log_box.insert("end", msg + "\n"); self.log_box.see("end")

    def copy_log(self):
        text = self.log_box.get("1.0", "end"); self.clipboard_clear(); self.clipboard_append(text)

    def clear_log(self):
        self.log_box.delete("1.0", "end")
