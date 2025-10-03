import sys
import numpy as np
from scipy import signal
import pyaudio
from typing import List, Tuple

# Add a conditional import for macOS mic permission
if sys.platform == "darwin":
    try:
        import AVFoundation
    except ImportError:
        AVFoundation = None

class AudioCore:
    def __init__(self, sample_rate=44100, chunk_size=1024, duration=0.5,
                 output_device_index=None, input_device_index=None,
                 input_sample_rate=None):
        # ... existing code ...
        self.sample_rate = int(sample_rate)
        self.input_sample_rate = int(input_sample_rate) if input_sample_rate is not None else int(sample_rate)
        self.chunk_size = int(chunk_size)
        self.duration = float(duration)
        self.audio = pyaudio.PyAudio()
        self.output_device_index = output_device_index
        self.input_device_index = input_device_index
        self.test_signal = None

        # ---- ADD THIS BLOCK ----
        if sys.platform == "darwin" and AVFoundation is not None:
            # This will trigger the macOS mic permission dialog
            def _mic_handler(granted):
                print("MacOS microphone permission granted:", granted)
            AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_("audio", _mic_handler)
        # ---- END BLOCK ----
