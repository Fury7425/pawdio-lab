"""Pink noise generation utilities for sweep frequency response tools."""

from __future__ import annotations

from dataclasses import dataclass, field
import numpy as np


@dataclass
class PinkNoiseGenerator:
    """Stateful pink noise generator using a simple IIR filter."""

    gain: float = 0.25
    _prev_white: np.ndarray = field(init=False, repr=False)
    _prev_pink: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """Reset the filter history."""
        self._prev_white = np.zeros(2, dtype=np.float32)
        self._prev_pink = np.zeros(2, dtype=np.float32)

    def generate(self, frames: int, samplerate: int | None = None) -> np.ndarray:
        """Generate a block of pink noise samples.

        Parameters
        ----------
        frames:
            Number of samples to produce.
        samplerate:
            Unused currently; reserved for future calibration hooks.
        """
        if frames <= 0:
            return np.zeros(0, dtype=np.float32)

        if self._prev_white is None or self._prev_pink is None:
            self.reset()

        white = np.random.randn(frames).astype(np.float32)

        b0, b1, b2 = 0.02109238, 0.07113478, 0.68873558
        a1, a2 = -1.73472577, 0.7660066

        _ = samplerate  # API compatibility for future calibration work.

        w1, w2 = float(self._prev_white[0]), float(self._prev_white[1])
        p1, p2 = float(self._prev_pink[0]), float(self._prev_pink[1])

        pink = np.empty(frames, dtype=np.float32)
        for i in range(frames):
            w0 = float(white[i])
            y = b0 * w0 + b1 * w1 + b2 * w2 - a1 * p1 - a2 * p2
            pink[i] = y
            w2, w1 = w1, w0
            p2, p1 = p1, y

        self._prev_white[...] = (w1, w2)
        self._prev_pink[...] = (p1, p2)

        pink -= np.mean(pink)
        rms = float(np.sqrt(np.mean(pink**2)))
        if rms > 1e-9:
            pink *= float(self.gain) / rms
        else:
            pink.fill(0.0)

        return pink.astype(np.float32, copy=False)
