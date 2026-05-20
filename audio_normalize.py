import shutil
import subprocess
from pathlib import Path

_MP3_LIKE = frozenset({'.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac'})


def ffmpeg_available() -> bool:
    return shutil.which('ffmpeg') is not None


def normalized_output_path(src: Path) -> Path:
    return src.with_name(f'{src.stem}.norm{src.suffix}')


def _output_path(src: Path, dest: Path) -> Path:
    if dest.suffix.lower() in _MP3_LIKE:
        return dest
    return dest.with_suffix('.mp3')


def normalize_audio(src: Path, dest: Path) -> bool:
    """Loudness-normalize src into dest (~-16 LUFS). Returns True on success."""
    if not ffmpeg_available():
        return False
    if not src.is_file():
        return False
    out = _output_path(src, dest)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg',
        '-y',
        '-i',
        str(src),
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar',
        '44100',
        str(out),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if proc.returncode != 0:
        return False
    if out != dest and out.is_file():
        out.replace(dest)
    return dest.is_file()
