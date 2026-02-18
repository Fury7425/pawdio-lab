"""Pink noise generation utilities for sweep frequency response tools."""

from __future__ import annotations

from dataclasses import dataclass, field
import numpy as np


@dataclass
class PinkNoiseGenerator:
    """
    Stateful pink noise generator (Paul Kellet IIR method).

    Produces continuous pink noise suitable for streaming in blocks without
    repeating FFT buffers.
    """

    gain: float = 0.25
    _b: np.ndarray = field(init=False, repr=False)  # filter state b0..b6

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """Reset filter history."""
        self._b = np.zeros(7, dtype=np.float32)

    def generate(self, frames: int, samplerate: int | None = None) -> np.ndarray:
        """
        Generate a block of pink noise samples.

        Parameters
        ----------
        frames:
            Number of samples to produce.
        samplerate:
            Unused (kept for API compatibility).
        """
        _ = samplerate

        if frames <= 0:
            return np.zeros(0, dtype=np.float32)

        # White noise input
        white = np.random.randn(frames).astype(np.float32)

        b0, b1, b2, b3, b4, b5, b6 = [float(x) for x in self._b]
        pink = np.empty(frames, dtype=np.float32)

        # Paul Kellet's pinking filter
        for i in range(frames):
            x = float(white[i])

            b0 = 0.99886 * b0 + x * 0.0555179
            b1 = 0.99332 * b1 + x * 0.0750759
            b2 = 0.96900 * b2 + x * 0.1538520
            b3 = 0.86650 * b3 + x * 0.3104856
            b4 = 0.55000 * b4 + x * 0.5329522
            b5 = -0.7616 * b5 - x * 0.0168980

            y = (b0 + b1 + b2 + b3 + b4 + b5 + b6) + x * 0.5362
            b6 = x * 0.115926

            pink[i] = y

        self._b[:] = (b0, b1, b2, b3, b4, b5, b6)

        # Remove DC (helps if you’re feeding meters/FFT)
        pink -= float(np.mean(pink))

        # Normalize to target RMS ~= gain
        rms = float(np.sqrt(np.mean(pink * pink)))
        if rms > 1e-12:
            pink *= float(self.gain) / rms
        else:
            pink.fill(0.0)

        return pink.astype(np.float32, copy=False)
