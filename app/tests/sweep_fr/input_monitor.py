"""Threaded input level monitoring utilities for the UI."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from app.core.utils import dbfs


@dataclass
class LevelState:
    """Thread-safe container for meter levels."""

    current_level: float = -96.0
    peak_level: float = -96.0
    clip_count: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def record_sample(self, rms_dbfs: float, peak_dbfs: float, clipped: bool = False) -> None:
        """Store a new measurement from the monitor thread."""
        rms_dbfs = float(max(-96.0, min(rms_dbfs, 0.0)))
        peak_dbfs = float(max(-96.0, min(peak_dbfs, 0.0)))
        with self._lock:
            self.current_level = rms_dbfs
            if peak_dbfs > self.peak_level:
                self.peak_level = peak_dbfs
            if clipped:
                self.clip_count += 1

    def assign(self, rms_dbfs: float, peak_dbfs: Optional[float] = None, clip_count: Optional[int] = None) -> None:
        """Assign levels from an external source (e.g. pink noise playback)."""
        rms_dbfs = float(max(-96.0, min(rms_dbfs, 0.0)))
        with self._lock:
            self.current_level = rms_dbfs
            if peak_dbfs is not None:
                peak_dbfs = float(max(-96.0, min(peak_dbfs, 0.0)))
                self.peak_level = peak_dbfs
            if clip_count is not None:
                self.clip_count = clip_count

    def reset_peak(self) -> None:
        with self._lock:
            self.peak_level = -96.0
            self.clip_count = 0

    def snapshot(self) -> tuple[float, float, int]:
        with self._lock:
            return self.current_level, self.peak_level, self.clip_count


class InputMonitorController:
    """Manage the lifetime of the input monitoring thread."""

    def __init__(
        self,
        core,
        level_state: LevelState,
        *,
        ui_dispatch: Callable[[Callable[..., None]], None],
        on_start: Optional[Callable[[], None]] = None,
        on_stop: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
        log_fn: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.core = core
        self.level_state = level_state
        self._ui_dispatch = ui_dispatch
        self._on_start = on_start
        self._on_stop = on_stop
        self._on_error = on_error
        self._log = log_fn or (lambda message: None)

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._stream_lock = threading.Lock()
        self._stream = None

    @property
    def is_running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive()

    def start(self) -> None:
        if self.is_running:
            return
        self._stop_event.clear()
        thread = threading.Thread(target=self._run, daemon=True)
        self._thread = thread
        thread.start()

    def stop(self) -> None:
        thread = self._thread
        if thread is None:
            return

        self._stop_event.set()
        with self._stream_lock:
            stream = self._stream
        if stream is not None:
            try:
                stream.stop_stream()
            except Exception:
                pass
        thread.join(timeout=3.0)

    # Internal helpers -------------------------------------------------
    def _dispatch_ui(self, callback: Optional[Callable[..., None]], *args) -> None:
        if callback is None:
            return

        def runner() -> None:
            callback(*args)

        self._ui_dispatch(runner)

    def _run(self) -> None:
        chunk = int(getattr(self.core, "chunk_size", 1024))
        samplerate = int(getattr(self.core, "input_sample_rate", getattr(self.core, "sample_rate", 44100)))
        fmt = self.core.audio.get_format_from_width(2)
        channels_in_use = 1
        stream = None
        last_exc: Optional[Exception] = None
        try:
            for ch in (1, 2):
                try:
                    stream = self.core.audio.open(
                        format=fmt,
                        channels=ch,
                        rate=samplerate,
                        input=True,
                        frames_per_buffer=chunk,
                        input_device_index=self.core.input_device_index,
                    )
                    channels_in_use = ch
                    break
                except Exception as exc:  # pragma: no cover - hardware dependent
                    stream = None
                    last_exc = exc
                    continue
            if stream is None:
                if last_exc is not None:
                    raise RuntimeError("Unable to open input stream for monitoring") from last_exc
                raise RuntimeError("Unable to open input stream for monitoring")

            with self._stream_lock:
                self._stream = stream
            self._dispatch_ui(self._on_start)

            while not self._stop_event.is_set():
                try:
                    data = stream.read(chunk, exception_on_overflow=False)
                except Exception as exc:
                    if self._stop_event.is_set():
                        break
                    raise exc
                if not data:
                    continue
                audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                if channels_in_use > 1 and audio.size:
                    try:
                        audio = audio.reshape(-1, channels_in_use).mean(axis=1)
                    except ValueError:
                        audio = audio.reshape(-1)
                if audio.size == 0:
                    continue
                rms_level = dbfs(audio)
                peak_level = 20 * np.log10(max(float(np.max(np.abs(audio))), 1e-12))
                clipped = peak_level >= -1.0
                self.level_state.record_sample(rms_level, peak_level, clipped)
        except Exception as exc:  # pragma: no cover - depends on hardware availability
            self._log(f"Input monitor error: {exc}")
            self._dispatch_ui(self._on_error, exc)
        finally:
            with self._stream_lock:
                active_stream = self._stream
                self._stream = None
            if active_stream is not None:
                try:
                    if active_stream.is_active():
                        active_stream.stop_stream()
                except Exception:
                    pass
                try:
                    active_stream.close()
                except Exception:
                    pass
            self._dispatch_ui(self._on_stop)
            self._thread = None
            self._stop_event.clear()
