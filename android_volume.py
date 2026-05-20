"""Android media volume via Termux:API (termux-volume)."""

import json
import shutil
import subprocess

STREAM = 'music'


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


def _list_streams() -> list[dict]:
    text = _run([]).strip()
    if not text:
        raise VolumeUnavailable('empty response from termux-volume')
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise VolumeUnavailable(f'invalid termux-volume output: {exc}') from exc
    if not isinstance(data, list):
        raise VolumeUnavailable('expected JSON array from termux-volume')
    return [item for item in data if isinstance(item, dict)]


def _music_levels() -> tuple[int, int]:
    for item in _list_streams():
        if item.get('stream') != STREAM:
            continue
        try:
            current = int(item['volume'])
            max_vol = int(item['max_volume'])
        except (KeyError, TypeError, ValueError) as exc:
            raise VolumeUnavailable('invalid music stream entry') from exc
        return current, max_vol
    raise VolumeUnavailable(f'{STREAM} stream not found')


def get_volume() -> float:
    current, max_vol = _music_levels()
    if max_vol <= 0:
        return 0.0
    return round(100.0 * current / max_vol)


def set_volume(percent: float) -> None:
    _, max_vol = _music_levels()
    level = round(_clamp_percent(percent) / 100.0 * max_vol)
    _run([STREAM, str(level)])
    current, _ = _music_levels()
    if current != level:
        raise VolumeUnavailable(
            'device did not apply music volume change '
            '(some phones block this stream; use hardware volume keys)'
        )
