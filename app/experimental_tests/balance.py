
from tkinter import messagebox
from ..core.utils import dbfs
from ..tests.base import TestResult

def run(core, log, freq=1000.0, tone_dur=1.0, settle=0.2):
    log("[BALANCE] Place mic on LEFT earcup, then click OK")
    messagebox.showinfo("Balance", "Place mic on LEFT earcup, then click OK")
    sig = core.generate_sine(freq=freq, duration=tone_dur)
    recL = _play_and_record(core, sig, settle=settle)

    log("[BALANCE] Move mic to RIGHT earcup, then click OK")
    messagebox.showinfo("Balance", "Move mic to RIGHT earcup, then click OK")
    core.generate_sine(freq=freq, duration=tone_dur)
    recR = _play_and_record(core, core.test_signal, settle=settle)
    levelL = dbfs(recL[:,0] if recL is not None and recL.ndim==2 else recL)
    levelR = dbfs(recR[:,0] if recR is not None and recR.ndim==2 else recR)
    diff = levelL - levelR
    res = TestResult("balance",
        params={"freq": freq, "duration": tone_dur},
        metrics={"left_dBFS": levelL, "right_dBFS": levelR, "L_minus_R_dB": diff}
    )
    log(f"[BALANCE] L {levelL:.2f} dBFS, R {levelR:.2f} dBFS, Δ {diff:.2f} dB")
    return res

def _play_and_record(core, mono_signal, both=False, settle=0.05, rec_dur=None):
    import threading, time
    if rec_dur is None: rec_dur = float(core.duration) + 0.3
    rec = {"audio": None}
    def worker():
        ch = 2 if both else 1
        rec["audio"] = core.record_audio(rec_dur, channels=ch)
    t = threading.Thread(target=worker, daemon=True); t.start()
    time.sleep(0.05 + settle)
    if both:
        core.play_stereo(mono_signal, mono_signal)
    else:
        core.play_mono(mono_signal)
    t.join(); return rec["audio"]
