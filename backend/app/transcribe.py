"""Local speech-to-text. Audio is never stored: it lives in memory, or in a
temp file that is deleted in `finally` as soon as transcription ends.

Engines, in order:
1. whisper.cpp CLI  (WHISPER_CPP_BIN + WHISPER_MODEL)
2. faster-whisper   (if the package is installed)
Neither -> 501, and the extension falls back to on-device Web Speech or buttons.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from functools import lru_cache

from .config import get_settings


class TranscriptionUnavailable(Exception):
    pass


def _whisper_cpp_ready() -> bool:
    s = get_settings()
    if not (s.whisper_cpp_bin and s.whisper_model):
        return False
    bin_ok = os.path.isfile(s.whisper_cpp_bin) or shutil.which(s.whisper_cpp_bin) is not None
    return bin_ok and os.path.isfile(s.whisper_model)


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


@lru_cache(maxsize=1)
def _faster_whisper_model():
    from faster_whisper import WhisperModel  # optional dependency

    return WhisperModel(get_settings().faster_whisper_model, device="cpu", compute_type="int8")


def _faster_whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def available() -> bool:
    return _whisper_cpp_ready() or _faster_whisper_available()


def _run_whisper_cpp(path: str, lang: str) -> str:
    s = get_settings()
    wav = path
    tmp_wav = None
    try:
        # whisper.cpp wants 16 kHz mono WAV; browsers send webm/ogg.
        if not path.endswith(".wav"):
            ff = _ffmpeg()
            if not ff:
                raise TranscriptionUnavailable("ffmpeg is needed to convert browser audio for whisper.cpp")
            fd, tmp_wav = tempfile.mkstemp(suffix=".wav", dir=_tmp_dir())
            os.close(fd)
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-ar", "16000", "-ac", "1", tmp_wav],
                           check=True, timeout=60)
            wav = tmp_wav
        out = subprocess.run(
            [s.whisper_cpp_bin, "-m", s.whisper_model, "-f", wav, "-l", lang, "-nt", "-np"],
            check=True, capture_output=True, text=True, timeout=120,
        )
        return " ".join(line.strip() for line in out.stdout.splitlines() if line.strip())
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.remove(tmp_wav)


def _run_faster_whisper(path: str, lang: str) -> str:
    model = _faster_whisper_model()
    segments, _ = model.transcribe(path, language=lang or None, vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments).strip()


def _tmp_dir() -> str | None:
    # Prefer RAM-backed storage so audio never touches disk where available.
    return "/dev/shm" if os.path.isdir("/dev/shm") and os.access("/dev/shm", os.W_OK) else None


async def transcribe_bytes(data: bytes, suffix: str = ".webm", lang: str = "en") -> str:
    if not available():
        raise TranscriptionUnavailable("no local speech-to-text engine configured")
    fd, path = tempfile.mkstemp(suffix=suffix, dir=_tmp_dir())
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        if _whisper_cpp_ready():
            return await asyncio.to_thread(_run_whisper_cpp, path, lang)
        return await asyncio.to_thread(_run_faster_whisper, path, lang)
    finally:
        if os.path.exists(path):
            os.remove(path)
