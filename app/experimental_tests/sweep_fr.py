
import os, datetime, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import signal
from ..core.audio import AudioCore
from ..core.utils import ensure_dir
from .base import TestResult

def run(core, log, f0=20, f1=20000, duration=6.0, repeats=1, save_plot_dir=None):
    log("[SWEEP FR] Keep mic steady near driver.")
    sig, t = core.generate_log_chirp(f0=f0, f1=f1, duration=duration, amp=0.5)

    if core.input_sample_rate != core.sample_rate:
        sig_ref = signal.resample(sig, int(len(sig)*core.input_sample_rate/core.sample_rate))
        t_ref = np.linspace(0, duration, len(sig_ref), endpoint=False)
    else:
        sig_ref = sig
        t_ref = t

    grid = np.logspace(np.log10(max(20, f0)), np.log10(min(f1, 20000)), 200)
    mags = []
    delays = []
    for i in range(int(repeats)):
        log(f"[SWEEP FR] Sweep {i+1}/{repeats}")
        rec = _play_and_record(core, sig, both=True, settle=0.05, rec_dur=duration+0.5)

        delay_ms, _ = AudioCore.find_delay_ms(rec, sig_ref, core.input_sample_rate)
        delays.append(delay_ms)
        delay_s = 0.0 if delay_ms is None else delay_ms/1000.0
        shift = int(round(delay_s * core.input_sample_rate))
        rec_aligned = rec[shift: shift + len(sig_ref)] if shift >= 0 else rec[:len(sig_ref)]
        if len(rec_aligned) < len(sig_ref):
            rec_aligned = np.pad(rec_aligned, (0, len(sig_ref)-len(rec_aligned)))

        env = np.abs(signal.hilbert(rec_aligned))
        env = env / (np.max(env)+1e-12)

        T = duration
        freqs_inst = f0 * (f1/f0) ** (t_ref / T)
        mag = np.zeros_like(grid)
        for j, f in enumerate(grid):
            idx = np.argmin(np.abs(freqs_inst - f)); mag[j] = env[idx]
        mags.append(mag)

    mags = np.array(mags)
    avg_mag = np.mean(mags, axis=0)
    mag_db_avg = 20*np.log10(np.maximum(avg_mag, 1e-6))
    mag_db_all = 20*np.log10(np.maximum(mags, 1e-6))

    files = {}
    if save_plot_dir:
        ensure_dir(save_plot_dir)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        out_avg = os.path.join(save_plot_dir, f"sweep_fr_avg_{ts}.png")
        plt.figure(figsize=(9,5))
        plt.semilogx(grid, mag_db_avg)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Average Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_avg); plt.close()
        files["plot_avg"] = out_avg

        out_all = os.path.join(save_plot_dir, f"sweep_fr_all_{ts}.png")
        plt.figure(figsize=(9,5))
        for arr in mag_db_all:
            plt.semilogx(grid, arr, alpha=0.4)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("All Sweeps Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_all); plt.close()
        files["plot_all"] = out_all

    avg_delay = float(np.mean([d for d in delays if d is not None])) if delays else None
    res = TestResult(
        "sweep_fr",
        params={"f0": f0, "f1": f1, "duration": duration, "repeats": repeats},
        metrics={"delay_ms": avg_delay},
        data={
            "freqs": grid.tolist(),
            "mag_db_avg": mag_db_avg.tolist(),
            "mag_db_all": mag_db_all.tolist(),
        },
        files=files
    )
    if avg_delay is not None:
        log(f"[SWEEP FR] Done (avg delay {avg_delay:.1f} ms)")
    else:
        log("[SWEEP FR] Done")
    return res

def _play_and_record(core, mono_signal, left_only=False, right_only=False, both=False, settle=0.05, rec_dur=None):
    import threading, time, numpy as np
    if rec_dur is None: rec_dur = float(core.duration) + 0.3
    rec = {"audio": None}
    def worker(): rec["audio"] = core.record_audio(rec_dur)
    t = threading.Thread(target=worker, daemon=True); t.start()
    time.sleep(0.05 + settle)
    if both:
        core.play_stereo(mono_signal, mono_signal)
    else:
        core.play_mono(mono_signal)
    t.join(); return rec["audio"]
