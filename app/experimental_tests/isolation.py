from tkinter import messagebox
from ..core.utils import dbfs
from ..tests.base import TestResult


def run(core, log, noise_dur=2.0, amp=0.4):
    log("[ISOLATION] Inside: mic near earcup seal. OK to measure.")
    messagebox.showinfo("Isolation", "Place mic near earcup seal (inside). Click OK.")
    sig = core.generate_pink_noise(duration=noise_dur, amp=amp)
    rec_in = _play_and_record(core, sig, both=True, settle=0.05)

    log("[ISOLATION] Outside: mic ~5-10 cm outside the cup. OK to measure.")
    messagebox.showinfo("Isolation", "Move mic 5-10 cm outside the cup. Click OK.")
    core.generate_pink_noise(duration=noise_dur, amp=amp)
    rec_out = _play_and_record(core, core.test_signal, both=True, settle=0.05)

    inL = dbfs(rec_in[:, 0]) if rec_in is not None and rec_in.ndim == 2 else dbfs(rec_in)
    inR = dbfs(rec_in[:, 1]) if rec_in is not None and rec_in.ndim == 2 else inL
    outL = dbfs(rec_out[:, 0]) if rec_out is not None and rec_out.ndim == 2 else dbfs(rec_out)
    outR = dbfs(rec_out[:, 1]) if rec_out is not None and rec_out.ndim == 2 else outL
    deltaL = inL - outL
    deltaR = inR - outR

    res = TestResult(
        "isolation_inside_out",
        params={"noise_dur": noise_dur},
        metrics={
            "left_inside_dBFS": inL,
            "left_outside_dBFS": outL,
            "left_delta_dB": deltaL,
            "right_inside_dBFS": inR,
            "right_outside_dBFS": outR,
            "right_delta_dB": deltaR,
        },
    )
    log(f"[ISOLATION] L Δ {deltaL:.2f} dB | R Δ {deltaR:.2f} dB")
    return res


def _play_and_record(core, mono_signal, both=False, settle=0.05, rec_dur=None):
    import threading, time

    if rec_dur is None:
        rec_dur = float(core.duration) + 0.3
    rec = {"audio": None}

    def worker():
        ch = 2 if both else 1
        rec["audio"] = core.record_audio(rec_dur, channels=ch)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    time.sleep(0.05 + settle)
    if both:
        core.play_stereo(mono_signal, mono_signal)
    else:
        core.play_mono(mono_signal)
    t.join()
    return rec["audio"]

