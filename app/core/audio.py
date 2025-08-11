
import numpy as np
from scipy import signal
import pyaudio
import sys
from typing import List, Tuple

class AudioCore:
    def __init__(self, sample_rate=44100, chunk_size=1024, duration=0.5,
                 output_device_index=None, input_device_index=None,
                 input_sample_rate=None):
        """Initialize the audio core.

        Parameters
        ----------
        sample_rate : int
            Output sample rate. Historically this was the single sample rate
            used by the application so we keep the attribute name for
            backwards compatibility.
        input_sample_rate : int or None
            Optional input device sample rate. If ``None`` the output sample
            rate is used.
        """
        self.sample_rate = int(sample_rate)
        self.input_sample_rate = int(input_sample_rate) if input_sample_rate is not None else int(sample_rate)
        self.chunk_size = int(chunk_size)
        self.duration = float(duration)
        self.audio = pyaudio.PyAudio()
        self.output_device_index = output_device_index
        self.input_device_index = input_device_index
        self.test_signal = None

    def list_devices(self):
        devs = []
        wasapi_index = None
        if sys.platform.startswith("win"):
            try:
                wasapi_index = self.audio.get_host_api_info_by_type(pyaudio.paWASAPI)["index"]
            except Exception:
                pass
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if wasapi_index is not None:
                if info.get("hostApi") != wasapi_index:
                    continue
                if info.get("isLoopbackDevice", False):
                    continue
            devs.append(info)
        return devs

    def get_default_output_index(self):
        try:
            return self.audio.get_default_output_device_info().get("index")
        except Exception:
            return None

    def get_default_input_index(self):
        try:
            return self.audio.get_default_input_device_info().get("index")
        except Exception:
            return None

    def get_device_capabilities(self, device_index: int, is_input: bool) -> Tuple[List[int], List[int]]:
        """Return supported sample rates and bit depths for a device.

        Parameters
        ----------
        device_index : int
            The PortAudio index of the device to probe.
        is_input : bool
            ``True`` for input device, ``False`` for output device.

        Returns
        -------
        (rates, bit_depths) : tuple(list[int], list[int])
            Lists of supported sample rates and bit depths.
        """
        if device_index is None:
            return [], []

        standard_rates = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000]
        formats = {8: pyaudio.paInt8, 16: pyaudio.paInt16, 24: pyaudio.paInt24, 32: pyaudio.paInt32}
        supported_rates: List[int] = []
        supported_bits: List[int] = []
        for rate in standard_rates:
            try:
                if self.audio.is_format_supported(rate,
                                                 input_device=device_index if is_input else None,
                                                 input_channels=1 if is_input else None,
                                                 input_format=pyaudio.paInt16 if is_input else None,
                                                 output_device=device_index if not is_input else None,
                                                 output_channels=1 if not is_input else None,
                                                 output_format=pyaudio.paInt16 if not is_input else None):
                    supported_rates.append(rate)
            except Exception:
                pass
        for bits, fmt in formats.items():
            try:
                if self.audio.is_format_supported(self.sample_rate,
                                                 input_device=device_index if is_input else None,
                                                 input_channels=1 if is_input else None,
                                                 input_format=fmt if is_input else None,
                                                 output_device=device_index if not is_input else None,
                                                 output_channels=1 if not is_input else None,
                                                 output_format=fmt if not is_input else None):
                    supported_bits.append(bits)
            except Exception:
                pass
        return supported_rates, supported_bits

    def set_devices(self, output_index=None, input_index=None):
        self.output_device_index = output_index
        self.input_device_index = input_index

    def generate_sine(self, freq=1000.0, duration=None, amp=0.8):
        if duration is None: duration = self.duration
        t = np.linspace(0, duration, int(self.sample_rate * duration), endpoint=False)
        fade_samples = int(0.01 * self.sample_rate)
        fade_samples = max(1, min(fade_samples, len(t)//2 - 1))
        env = np.ones_like(t)
        env[:fade_samples] = np.linspace(0,1,fade_samples)
        env[-fade_samples:] = np.linspace(1,0,fade_samples)
        sig = np.sin(2*np.pi*freq*t) * env * float(amp)
        self.test_signal = sig.astype(np.float32)
        return self.test_signal

    def generate_impulse(self, buffer_duration=0.1, impulse_duration_samples=1, amplitude=0.85):
        num_samples = int(self.sample_rate * buffer_duration)
        sig = np.zeros(num_samples, dtype=np.float32)
        start = max(0, num_samples//2 - impulse_duration_samples//2)
        end = min(num_samples, start + impulse_duration_samples)
        sig[start:end] = amplitude
        self.test_signal = sig
        return self.test_signal

    def generate_pink_noise(self, duration=None, amp=0.3):
        if duration is None: duration = self.duration
        n = int(self.sample_rate * duration)
        white = np.random.normal(0, 1, n)
        freqs = np.fft.rfftfreq(n, 1/self.sample_rate)
        mag = 1/np.maximum(freqs, 1e-6)
        spectrum = np.fft.rfft(white) * mag
        pink = np.fft.irfft(spectrum, n)
        pink = pink / (np.max(np.abs(pink)) + 1e-9) * amp
        self.test_signal = pink.astype(np.float32)
        return self.test_signal

    def generate_log_chirp(self, f0=20, f1=20000, duration=6.0, amp=0.5):
        t = np.linspace(0, duration, int(self.sample_rate*duration), endpoint=False)
        sig = signal.chirp(t, f0=f0, t1=duration, f1=f1, method='logarithmic') * amp
        fade = int(0.02*self.sample_rate)
        if fade>0:
            sig[:fade] *= np.linspace(0,1,fade)
            sig[-fade:] *= np.linspace(1,0,fade)
        self.test_signal = sig.astype(np.float32)
        return self.test_signal, t

    def play_mono(self, sig):
        audio_data = (np.asarray(sig)*32767).astype(np.int16).tobytes()
        out = self.audio.open(format=pyaudio.paInt16, channels=1, rate=self.sample_rate, output=True, output_device_index=self.output_device_index)
        out.write(audio_data); out.stop_stream(); out.close()

    def play_stereo(self, left, right):
        left = np.asarray(left, dtype=np.float32); right = np.asarray(right, dtype=np.float32)
        n = min(len(left), len(right))
        interleaved = np.empty(2*n, dtype=np.float32)
        interleaved[0::2] = left[:n]; interleaved[1::2] = right[:n]
        audio_data = (interleaved * 32767).astype(np.int16).tobytes()
        out = self.audio.open(format=pyaudio.paInt16, channels=2, rate=self.sample_rate, output=True, output_device_index=self.output_device_index)
        out.write(audio_data); out.stop_stream(); out.close()

    def record_audio(self, duration):
        inp = self.audio.open(format=pyaudio.paInt16, channels=1, rate=self.input_sample_rate, input=True,
                              frames_per_buffer=self.chunk_size, input_device_index=self.input_device_index)
        frames = []
        num_chunks = int(self.input_sample_rate * duration / self.chunk_size)
        for _ in range(num_chunks):
            data = inp.read(self.chunk_size, exception_on_overflow=False)
            frames.append(data)
        inp.stop_stream(); inp.close()
        audio_data = np.frombuffer(b"".join(frames), dtype=np.int16).astype(np.float32)/32767.0
        return audio_data

    def set_sample_rates(self, output_rate: int = None, input_rate: int = None):
        if output_rate is not None:
            self.sample_rate = int(output_rate)
        if input_rate is not None:
            self.input_sample_rate = int(input_rate)

        if sys.platform.startswith("win"):
            try:
                self._apply_windows_sample_rate(self.output_device_index, self.sample_rate, False)
                self._apply_windows_sample_rate(self.input_device_index, self.input_sample_rate, True)
            except Exception:
                pass

    def _apply_windows_sample_rate(self, device_index: int, rate: int, is_input: bool):
        """Attempt to update the Windows default format for a device.

        This implementation is a stub; actual modification of the Windows
        device format requires additional platform specific code and
        dependencies which may not be available at runtime.
        """
        try:
            import comtypes  # type: ignore  # noqa: F401
            # Placeholder for real implementation using pycaw/IAudioClient.
        except Exception:
            pass

    @staticmethod
    def find_delay_ms(recorded_signal, reference_signal, sample_rate):
        if recorded_signal is None or reference_signal is None: return None, None
        if len(recorded_signal)==0 or len(reference_signal)==0: return None, None
        rs = recorded_signal / (np.max(np.abs(recorded_signal))+1e-9)
        rf = reference_signal / (np.max(np.abs(reference_signal))+1e-9)
        correlation = signal.correlate(rs, rf, mode='full')
        peak_index = int(np.argmax(np.abs(correlation)))
        if 0 < peak_index < len(correlation)-1:
            y1,y2,y3 = correlation[peak_index-1], correlation[peak_index], correlation[peak_index+1]
            denom = (y1 - 2*y2 + y3)
            if abs(denom) > 1e-9:
                frac = (y1 - y3) / (2*denom); peak_index_f = peak_index + float(frac)
            else:
                peak_index_f = float(peak_index)
        else:
            peak_index_f = float(peak_index)
        delay_samples = peak_index_f - (len(reference_signal)-1)
        delay_ms = (delay_samples / sample_rate)*1000.0
        return delay_ms, correlation

    def cleanup(self):
        try:
            self.audio.terminate()
        except Exception:
            pass
