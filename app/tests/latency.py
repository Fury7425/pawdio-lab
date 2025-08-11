
import os, time, threading, datetime, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import signal
from ..core.utils import safe_mean, safe_std
from ..core.utils import ensure_dir
from ..core.audio import AudioCore
from .base import TestResult

SOUND_PRESETS = [
    {"key": "beep_1k", "name": "1 kHz Beep", "type": "sine", "freq": 1000},
    {"key": "beep_2k", "name": "2 kHz Beep", "type": "sine", "freq": 2000},
    {"key": "beep_5k", "name": "5 kHz Beep", "type": "sine", "freq": 5000},
    {"key": "beep_200", "name": "200 Hz Beep", "type": "sine", "freq": 200},
    {"key": "impulse", "name": "Click (Impulse)", "type": "impulse", "freq": None},
]

class DelayRunner:
    def __init__(self, cfg, log_fn, stereo=False):
        self.cfg = cfg
        self.log = log_fn
        self.stereo = stereo

    def _gen(self, core, preset):
        if preset["type"]=="sine":
            return core.generate_sine(preset["freq"], duration=core.duration)
        return core.generate_impulse()

    def _record_and_play(self, core: AudioCore, preset, record_margin_s=1.0):
        rec_dur = float(core.duration) + float(record_margin_s)
        rec_data = {"audio": None}
        channels = 2 if self.stereo else 1
        def record_worker():
            rec_data["audio"] = core.record_audio(rec_dur, channels=channels)
        t = threading.Thread(target=record_worker, daemon=True); t.start()
        time.sleep(0.08)
        if self.stereo:
            core.play_stereo(core.test_signal, core.test_signal)
        else:
            core.play_mono(core.test_signal)
        t.join()
        ref = core.test_signal
        if core.input_sample_rate != core.sample_rate and ref is not None:
            # Resample reference to match recording rate
            ref_len = int(len(ref) * core.input_sample_rate / core.sample_rate)
            ref = signal.resample(ref, ref_len)
        if self.stereo and rec_data["audio"] is not None and rec_data["audio"].ndim == 2:
            delay_l, _ = AudioCore.find_delay_ms(rec_data["audio"][:,0], ref, core.input_sample_rate)
            delay_r, _ = AudioCore.find_delay_ms(rec_data["audio"][:,1], ref, core.input_sample_rate)
            return (delay_l, delay_r), rec_data["audio"], ref
        delay_ms, _ = AudioCore.find_delay_ms(rec_data["audio"], ref, core.input_sample_rate)
        return delay_ms, rec_data["audio"], ref

    # Calibration
    def calibrate_preset(self, core, preset, repeats=5):
        delays = []
        self.log(f"[CAL] {preset['name']} x{repeats}")
        for i in range(repeats):
            self._gen(core, preset)
            d, _, _ = self._record_and_play(core, preset)
            if isinstance(d, tuple):
                d = safe_mean([x for x in d if x is not None])
            if d is None: self.log(f"  ✗ {i+1}/{repeats}")
            else: self.log(f"  ✓ {i+1}/{repeats}: {d:.2f} ms")
            delays.append(d); time.sleep(0.15)
        avg, std = safe_mean(delays), safe_std(delays)
        if avg is not None:
            self.cfg["per_sound_offsets_ms"].setdefault(preset["key"], 0.0)
            self.cfg["per_sound_offsets_ms"][preset["key"]] = float(avg)
            self.log(f"  -> baseline {avg:.2f} ± {std:.2f} ms saved")
        return avg, std

    def calibrate_global(self, core, repeats=10):
        pseudo = {"key":"impulse","name":"System (Impulse)","type":"impulse","freq":None}
        self.log(f"[CAL] GLOBAL via Impulse x{repeats}")
        delays=[]
        for i in range(repeats):
            self._gen(core, pseudo)
            d, _, _ = self._record_and_play(core, pseudo)
            if isinstance(d, tuple):
                d = safe_mean([x for x in d if x is not None])
            if d is None: self.log(f"  ✗ {i+1}/{repeats}")
            else: self.log(f"  ✓ {i+1}/{repeats}: {d:.2f} ms")
            delays.append(d); time.sleep(0.15)
        avg, std = safe_mean(delays), safe_std(delays)
        if avg is not None:
            self.cfg["global_system_offset_ms"] = float(avg)
            self.log(f"  -> GLOBAL {avg:.2f} ± {std:.2f} ms saved")
        return avg, std

    # Testing
    def run_test(self, core, preset, repeats=5, save_plot_dir=None):
        per_sound = self.cfg["per_sound_offsets_ms"].get(preset["key"], 0.0)
        global_off = float(self.cfg.get("global_system_offset_ms", 0.0))
        calib = per_sound + global_off
        self.log(f"[TEST] {preset['name']} x{repeats}  (calib={calib:.2f} ms)")
        results_l, results_r, results_avg, diffs = [], [], [], []
        first_good = None
        for i in range(repeats):
            self._gen(core, preset)
            d_raw, rec, ref = self._record_and_play(core, preset)
            if isinstance(d_raw, tuple):
                d_l, d_r = d_raw
            else:
                d_l = d_r = d_raw
            if d_l is None or d_r is None:
                self.log(f"  ✗ {i+1}/{repeats}")
            else:
                d_l_cal = d_l - calib
                d_r_cal = d_r - calib
                avg = safe_mean([d_l_cal, d_r_cal])
                diff = d_l_cal - d_r_cal
                self.log(f"  ✓ {i+1}/{repeats}: L {d_l_cal:.2f} ms | R {d_r_cal:.2f} ms | Δ {diff:.2f} ms")
                results_l.append(d_l_cal)
                results_r.append(d_r_cal)
                results_avg.append(avg)
                diffs.append(diff)
                if first_good is None and rec is not None and ref is not None:
                    first_good = (rec, ref)
            time.sleep(0.12)
        avg_l, std_l = safe_mean(results_l), safe_std(results_l)
        avg_r, std_r = safe_mean(results_r), safe_std(results_r)
        avg_diff, std_diff = safe_mean(diffs), safe_std(diffs)
        if avg_l is not None and avg_r is not None:
            self.log(f"  -> L {avg_l:.2f} ± {std_l:.2f} ms | R {avg_r:.2f} ± {std_r:.2f} ms | Δ {avg_diff:.2f} ± {std_diff:.2f} ms")
        if save_plot_dir and first_good and results_l and results_r:
            rec, ref = first_good
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            out_l = os.path.join(save_plot_dir, f"{preset['key']}_left_plot_{ts}.png")
            out_r = os.path.join(save_plot_dir, f"{preset['key']}_right_plot_{ts}.png")
            out_avg = os.path.join(save_plot_dir, f"{preset['key']}_avg_plot_{ts}.png")
            self._save_plot(rec[:,0], ref, avg_l, core.input_sample_rate, out_l, f"{preset['name']} L avg {avg_l:.1f} ms")
            self._save_plot(rec[:,1], ref, avg_r, core.input_sample_rate, out_r, f"{preset['name']} R avg {avg_r:.1f} ms")
            avg_all = safe_mean([avg_l, avg_r])
            self._save_plot(rec.mean(axis=1), ref, avg_all, core.input_sample_rate, out_avg, f"{preset['name']} avg {avg_all:.1f} ms")
            self.log(f"  saved plots -> {out_l}, {out_r}, {out_avg}")
        return {"left_ms": results_l, "right_ms": results_r, "avg_ms": results_avg, "diff_ms": diffs}

    @staticmethod
    def _save_plot(recorded_audio, test_signal, avg_delay_ms, sample_rate, filepath, title):
        plt.figure(figsize=(11,7))
        plt.suptitle(title)
        plt.subplot(3,1,1)
        t_ref = np.linspace(0, len(test_signal)/sample_rate, len(test_signal), endpoint=False)
        plt.plot(t_ref*1000.0, test_signal); plt.title("Reference"); plt.xlabel("ms"); plt.ylabel("amp")
        plt.subplot(3,1,2)
        t_rec = np.linspace(0, len(recorded_audio)/sample_rate, len(recorded_audio), endpoint=False)
        plt.plot(t_rec*1000.0, recorded_audio); plt.title("Recorded"); plt.xlabel("ms"); plt.ylabel("amp")
        plt.subplot(3,1,3)
        correlation = signal.correlate(recorded_audio, test_signal, mode="full")
        lags = np.arange(-len(test_signal)+1, len(recorded_audio))
        corr_time = lags / sample_rate * 1000.0
        plt.plot(corr_time, correlation); plt.axvline(x=avg_delay_ms, linestyle="--", label=f"Avg: {avg_delay_ms:.1f} ms"); plt.legend()
        plt.xlabel("Delay (ms)"); plt.ylabel("corr")
        plt.tight_layout(); plt.savefig(filepath); plt.close()

    @staticmethod
    def save_bar(data, filepath):
        labels = list(data.keys())
        avgs = [np.mean(v) if v else 0.0 for v in data.values()]
        plt.figure(figsize=(10,5))
        plt.bar(labels, avgs)
        plt.ylabel("Delay (ms)")
        plt.tight_layout()
        plt.savefig(filepath)
        plt.close()
        return True
