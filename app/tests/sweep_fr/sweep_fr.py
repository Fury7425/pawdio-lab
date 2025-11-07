import os, datetime, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import signal
from app.core.audio import AudioCore
from app.core.utils import ensure_dir
from ..base import TestResult

from tkinter import messagebox

def run(core, log, f0=20, f1=20000, duration=6.0, repeats=1, save_plot_dir=None, save_squiglink=False, mono_mode=False):
    log("[SWEEP FR] Keep mic steady near driver.")
    sig, t = core.generate_log_chirp(f0=f0, f1=f1, duration=duration, amp=0.5)

    if core.input_sample_rate != core.sample_rate:
        sig_ref = signal.resample(sig, int(len(sig)*core.input_sample_rate/core.sample_rate))
        t_ref = np.linspace(0, duration, len(sig_ref), endpoint=False)
    else:
        sig_ref = sig
        t_ref = t

    grid = np.logspace(np.log10(max(20, f0)), np.log10(min(f1, 20000)), 200)
    mags_l = []
    mags_r = []
    delays_l = []
    delays_r = []

    if mono_mode:
        # LEFT sweeps
        for i in range(int(repeats)):
            messagebox.showinfo("Mono Sweep", f"Plug mic into LEFT side and click OK for sweep {i+1}/{repeats}.")
            rec = _play_and_record(core, sig, left_only=True, right_only=False, both=False, settle=0.05, rec_dur=duration+0.5)
            if rec is None:
                log("[ERROR] Audio recording failed (LEFT). Check input device selection and ensure microphone permissions are granted in System Settings.")
                if not mags_l:
                    return None
                else:
                    break
            rec_l = rec
            delay_ms_l, _ = AudioCore.find_delay_ms(rec_l, sig_ref, core.input_sample_rate)
            delays_l.append(delay_ms_l)
            delay_s_l = 0.0 if delay_ms_l is None else delay_ms_l/1000.0
            shift_l = int(round(delay_s_l * core.input_sample_rate))
            rec_aligned_l = rec_l[shift_l: shift_l + len(sig_ref)] if shift_l >= 0 else rec_l[:len(sig_ref)]
            if len(rec_aligned_l) < len(sig_ref):
                rec_aligned_l = np.pad(rec_aligned_l, (0, len(sig_ref)-len(rec_aligned_l)))
            env_l = np.abs(signal.hilbert(rec_aligned_l))
            env_l = env_l / (np.max(env_l)+1e-12)
            T = duration
            freqs_inst = f0 * (f1/f0) ** (t_ref / T)
            mag_l = np.zeros_like(grid)
            for j, f in enumerate(grid):
                idx = np.argmin(np.abs(freqs_inst - f))
                mag_l[j] = env_l[idx]
            mags_l.append(mag_l)

        # RIGHT sweeps
        for i in range(int(repeats)):
            messagebox.showinfo("Mono Sweep", f"Plug mic into RIGHT side and click OK for sweep {i+1}/{repeats}.")
            rec = _play_and_record(core, sig, left_only=False, right_only=True, both=False, settle=0.05, rec_dur=duration+0.5)
            if rec is None:
                log("[ERROR] Audio recording failed (RIGHT). Check input device selection and ensure microphone permissions are granted in System Settings.")
                if not mags_r:
                    return None
                else:
                    break
            rec_r = rec
            delay_ms_r, _ = AudioCore.find_delay_ms(rec_r, sig_ref, core.input_sample_rate)
            delays_r.append(delay_ms_r)
            delay_s_r = 0.0 if delay_ms_r is None else delay_ms_r/1000.0
            shift_r = int(round(delay_s_r * core.input_sample_rate))
            rec_aligned_r = rec_r[shift_r: shift_r + len(sig_ref)] if shift_r >= 0 else rec_r[:len(sig_ref)]
            if len(rec_aligned_r) < len(sig_ref):
                rec_aligned_r = np.pad(rec_aligned_r, (0, len(sig_ref)-len(rec_aligned_r)))
            env_r = np.abs(signal.hilbert(rec_aligned_r))
            env_r = env_r / (np.max(env_r)+1e-12)
            T = duration
            freqs_inst = f0 * (f1/f0) ** (t_ref / T)
            mag_r = np.zeros_like(grid)
            for j, f in enumerate(grid):
                idx = np.argmin(np.abs(freqs_inst - f))
                mag_r[j] = env_r[idx]
            mags_r.append(mag_r)

    else:
        for i in range(int(repeats)):
            log(f"[SWEEP FR] Sweep {i+1}/{repeats}")
            rec = _play_and_record(core, sig, both=True, settle=0.05, rec_dur=duration+0.5)

            if rec is None:
                log("[ERROR] Audio recording failed. Check input device selection and ensure microphone permissions are granted in System Settings.")
                if not mags_l and not mags_r:
                    return None
                else:
                    break # Exit the loop and process the sweeps that did succeed

            rec_l = rec[:, 0]
            rec_r = rec[:, 1]

            # Time alignment
            delay_ms_l, _ = AudioCore.find_delay_ms(rec_l, sig_ref, core.input_sample_rate)
            delay_ms_r, _ = AudioCore.find_delay_ms(rec_r, sig_ref, core.input_sample_rate)
            delays_l.append(delay_ms_l)
            delays_r.append(delay_ms_r)

            delay_s_l = 0.0 if delay_ms_l is None else delay_ms_l/1000.0
            delay_s_r = 0.0 if delay_ms_r is None else delay_ms_r/1000.0
            shift_l = int(round(delay_s_l * core.input_sample_rate))
            shift_r = int(round(delay_s_r * core.input_sample_rate))
            
            # Trim/Pad to match reference signal length
            rec_aligned_l = rec_l[shift_l: shift_l + len(sig_ref)] if shift_l >= 0 else rec_l[:len(sig_ref)]
            rec_aligned_r = rec_r[shift_r: shift_r + len(sig_ref)] if shift_r >= 0 else rec_r[:len(sig_ref)]
            if len(rec_aligned_l) < len(sig_ref):
                rec_aligned_l = np.pad(rec_aligned_l, (0, len(sig_ref)-len(rec_aligned_l)))
            if len(rec_aligned_r) < len(sig_ref):
                rec_aligned_r = np.pad(rec_aligned_r, (0, len(sig_ref)-len(rec_aligned_r)))

            # Envelope detection for FR
            env_l = np.abs(signal.hilbert(rec_aligned_l))
            env_r = np.abs(signal.hilbert(rec_aligned_r))
            env_l = env_l / (np.max(env_l)+1e-12)
            env_r = env_r / (np.max(env_r)+1e-12)

            T = duration
            # Instantaneous frequency calculation (linear in log space)
            freqs_inst = f0 * (f1/f0) ** (t_ref / T) 
            mag_l = np.zeros_like(grid)
            mag_r = np.zeros_like(grid)
            for j, f in enumerate(grid):
                # Find the time index closest to this frequency
                idx = np.argmin(np.abs(freqs_inst - f))
                mag_l[j] = env_l[idx]
                mag_r[j] = env_r[idx]
            mags_l.append(mag_l)
            mags_r.append(mag_r)

    # **FIX:** Ensure there's data to process before continuing
    if not mags_l and not mags_r:
        log("[SWEEP FR] No successful sweeps were recorded. Aborting.")
        return None

    mags_l = np.array(mags_l)
    mags_r = np.array(mags_r)
    
    # Calculate averages and convert to dB
    avg_mag_l = np.mean(mags_l, axis=0) if mags_l.size > 0 else np.zeros_like(grid)
    avg_mag_r = np.mean(mags_r, axis=0) if mags_r.size > 0 else np.zeros_like(grid)
    
    # Only concatenate if both have data
    if mags_l.size > 0 and mags_r.size > 0:
        all_mags = np.concatenate([mags_l, mags_r], axis=0)
    elif mags_l.size > 0:
        all_mags = mags_l
    else:
        all_mags = mags_r
    
    avg_mag_all = np.mean(all_mags, axis=0)

    mag_db_left_avg = 20*np.log10(np.maximum(avg_mag_l, 1e-6))
    mag_db_right_avg = 20*np.log10(np.maximum(avg_mag_r, 1e-6))
    mag_db_left_all = 20*np.log10(np.maximum(mags_l, 1e-6)) if mags_l.size > 0 else []
    mag_db_right_all = 20*np.log10(np.maximum(mags_r, 1e-6)) if mags_r.size > 0 else []
    mag_db_all = 20*np.log10(np.maximum(all_mags, 1e-6))
    mag_db_avg_all = 20*np.log10(np.maximum(avg_mag_all, 1e-6))

    files = {}
    if save_plot_dir:
        ensure_dir(save_plot_dir)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        # Save all the plots as before
        out_left_avg = os.path.join(save_plot_dir, f"sweep_fr_left_avg_{ts}.png")
        plt.figure(figsize=(9,5))
        plt.semilogx(grid, mag_db_left_avg)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Left Average Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_left_avg); plt.close()
        files["plot_left_avg"] = out_left_avg

        out_left_all = os.path.join(save_plot_dir, f"sweep_fr_left_all_{ts}.png")
        plt.figure(figsize=(9,5))
        if len(mag_db_left_all) > 0:
            for arr in mag_db_left_all:
                plt.semilogx(grid, arr, alpha=0.4)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Left All Sweeps Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_left_all); plt.close()
        files["plot_left_all"] = out_left_all

        out_right_avg = os.path.join(save_plot_dir, f"sweep_fr_right_avg_{ts}.png")
        plt.figure(figsize=(9,5))
        plt.semilogx(grid, mag_db_right_avg)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Right Average Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_right_avg); plt.close()
        files["plot_right_avg"] = out_right_avg

        out_right_all = os.path.join(save_plot_dir, f"sweep_fr_right_all_{ts}.png")
        plt.figure(figsize=(9,5))
        if len(mag_db_right_all) > 0:
            for arr in mag_db_right_all:
                plt.semilogx(grid, arr, alpha=0.4)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Right All Sweeps Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_right_all); plt.close()
        files["plot_right_all"] = out_right_all

        out_all = os.path.join(save_plot_dir, f"sweep_fr_all_{ts}.png")
        plt.figure(figsize=(9,5))
        for arr in mag_db_all:
            plt.semilogx(grid, arr, alpha=0.4)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("All Sweeps Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_all); plt.close()
        files["plot_all"] = out_all

        out_lr_avg = os.path.join(save_plot_dir, f"sweep_fr_lr_avg_{ts}.png")
        plt.figure(figsize=(9,5))
        plt.semilogx(grid, mag_db_left_avg, label="Left")
        plt.semilogx(grid, mag_db_right_avg, label="Right")
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Left/Right Average Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.legend()
        plt.tight_layout(); plt.savefig(out_lr_avg); plt.close()
        files["plot_lr_avg"] = out_lr_avg

        out_avg_all = os.path.join(save_plot_dir, f"sweep_fr_avg_all_{ts}.png")
        plt.figure(figsize=(9,5))
        plt.semilogx(grid, mag_db_avg_all)
        plt.xlabel("Frequency (Hz)"); plt.ylabel("Relative Level (dB)"); plt.title("Average of All Frequency Response")
        plt.grid(True, which='both', ls=':', alpha=0.6)
        plt.tight_layout(); plt.savefig(out_avg_all); plt.close()
        files["plot_avg_all"] = out_avg_all

        # Save Squiglink format files if requested
        if save_squiglink:
            squiglink_files = save_squiglink_format(
                save_plot_dir, ts, grid, 
                mag_db_left_avg, mag_db_right_avg, mag_db_avg_all
            )
            files.update(squiglink_files)
            log(f"[SAVE] Squiglink files saved")

    avg_delay_l = float(np.mean([d for d in delays_l if d is not None])) if delays_l and any(d is not None for d in delays_l) else None
    avg_delay_r = float(np.mean([d for d in delays_r if d is not None])) if delays_r and any(d is not None for d in delays_r) else None
    
    res = TestResult(
        "sweep_fr",
        params={"f0": f0, "f1": f1, "duration": duration, "repeats": repeats},
        metrics={"delay_ms_left": avg_delay_l, "delay_ms_right": avg_delay_r},
        data={
            "freqs": grid.tolist(),
            "left_mag_db_avg": mag_db_left_avg.tolist(),
            "left_mag_db_all": mag_db_left_all.tolist() if isinstance(mag_db_left_all, np.ndarray) else mag_db_left_all,
            "right_mag_db_avg": mag_db_right_avg.tolist(),
            "right_mag_db_all": mag_db_right_all.tolist() if isinstance(mag_db_right_all, np.ndarray) else mag_db_right_all,
            "mag_db_all": mag_db_all.tolist(),
            "mag_db_avg_all": mag_db_avg_all.tolist(),
        },
        files=files
    )
    if avg_delay_l is not None or avg_delay_r is not None:
        msg = "[SWEEP FR] Done" + (
            f" (avg delay L {avg_delay_l:.1f} ms, R {avg_delay_r:.1f} ms)" if avg_delay_l is not None and avg_delay_r is not None else (
                f" (avg delay L {avg_delay_l:.1f} ms)" if avg_delay_l is not None else f" (avg delay R {avg_delay_r:.1f} ms)"
            )
        )
        log(msg)
    else:
        log("[SWEEP FR] Done")
    return res

def save_squiglink_format(output_dir, timestamp, freqs, left_db, right_db, avg_db):
    """Save frequency response data in Squiglink-compatible text format.
    
    Squiglink format is a simple two-column text file:
    - Column 1: Frequency in Hz
    - Column 2: Amplitude in dB
    """
    files = {}
    
    # Save left channel
    left_path = os.path.join(output_dir, f"squiglink_left_{timestamp}.txt")
    with open(left_path, 'w') as f:
        f.write("# PawdioLab Frequency Response - Left Channel\n")
        f.write("# Frequency(Hz)\tAmplitude(dB)\n")
        for freq, amp in zip(freqs, left_db):
            f.write(f"{freq:.2f}\t{amp:.3f}\n")
    files["squiglink_left"] = left_path
    
    # Save right channel
    right_path = os.path.join(output_dir, f"squiglink_right_{timestamp}.txt")
    with open(right_path, 'w') as f:
        f.write("# PawdioLab Frequency Response - Right Channel\n")
        f.write("# Frequency(Hz)\tAmplitude(dB)\n")
        for freq, amp in zip(freqs, right_db):
            f.write(f"{freq:.2f}\t{amp:.3f}\n")
    files["squiglink_right"] = right_path
    
    # Save average of both channels
    avg_path = os.path.join(output_dir, f"squiglink_avg_{timestamp}.txt")
    with open(avg_path, 'w') as f:
        f.write("# PawdioLab Frequency Response - Average (L+R)\n")
        f.write("# Frequency(Hz)\tAmplitude(dB)\n")
        for freq, amp in zip(freqs, avg_db):
            f.write(f"{freq:.2f}\t{amp:.3f}\n")
    files["squiglink_avg"] = avg_path
    
    # Save both channels in one file for comparison
    both_path = os.path.join(output_dir, f"squiglink_both_{timestamp}.txt")
    with open(both_path, 'w') as f:
        f.write("# PawdioLab Frequency Response - Both Channels\n")
        f.write("# Frequency(Hz)\tLeft(dB)\tRight(dB)\n")
        for freq, l_amp, r_amp in zip(freqs, left_db, right_db):
            f.write(f"{freq:.2f}\t{l_amp:.3f}\t{r_amp:.3f}\n")
    files["squiglink_both"] = both_path
    
    return files

def _play_and_record(core, mono_signal, left_only=False, right_only=False, both=False, settle=0.05, rec_dur=None):
    import threading, time, numpy as np
    if rec_dur is None: rec_dur = float(core.duration) + 0.3
    rec = {"audio": None}
    def worker():
        ch = 2 if both else 1
        rec["audio"] = core.record_audio(rec_dur, channels=ch) 
    t = threading.Thread(target=worker, daemon=True); t.start()
    time.sleep(0.05 + settle)
    if both:
        core.play_stereo(mono_signal, mono_signal)
    elif left_only:
        core.play_stereo(mono_signal, np.zeros_like(mono_signal))
    elif right_only:
        core.play_stereo(np.zeros_like(mono_signal), mono_signal)
    else:
        core.play_mono(mono_signal)
    t.join(); return rec["audio"]
