"""Android media volume via Termux:API (termux-volume)."""

import re
import shutil
import subprocess

STREAM = 'music'
_LINE_RE = re.compile(
    r'Stream:\s*(\w+)\s*,\s*Volume:\s*(\d+)\s*,\s*Max:\s*(\d+)',
    re.IGNORECASE,
)


class VolumeUnavailable(Exception):
    """termux-volume is missing or failed."""


def _clamp_percent(percent: float) -> float:
    return max(0.0, min(100.0, float(percent)))


def _run(args: list[str], timeout: float = 5.0) -> str:
    if shutil.which('termux-volume') is None:
        raise VolumeUnavailable('termux-volume not found; install termux-api')
    try:
        proc = subprocess.run(
            ['termux-volume', *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VolumeUnavailable(str(exc)) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or '').strip() or 'termux-volume failed'
        raise VolumeUnavailable(err)
    return proc.stdout or ''


def _parse_streams(text: str) -> dict[str, tuple[int, int]]:
    streams: dict[str, tuple[int, int]] = {}
    for line in text.splitlines():
        match = _LINE_RE.search(line)
        if match:
            streams[match.group(1).lower()] = (int(match.group(2)), int(match.group(3)))
    return streams


def _music_levels() -> tuple[int, int]:
    streams = _parse_streams(_run([]))
    if STREAM not in streams:
        raise VolumeUnavailable(f'{STREAM} stream not found')
    return streams[STREAM]


def get_volume() -> float:
    current, max_vol = _music_levels()
    if max_vol <= 0:
        return 0.0
    return round(100.0 * current / max_vol)


def set_volume(percent: float) -> bool:
    try:
        _, max_vol = _music_levels()
        level = round(_clamp_percent(percent) / 100.0 * max_vol)
        _run([STREAM, str(level)])
        return True
    except VolumeUnavailable:
        return False
