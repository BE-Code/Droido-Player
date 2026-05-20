import os
import threading
from pathlib import Path

from audio_player import audioPlayer

# Matches setup: APPDIR=~/storage/shared/Droido-Player-Data
_DEFAULT_REL = Path('storage') / 'shared' / 'Droido-Player-Data'
# Long NFC payloads map to a folder name = first N chars (fits typical NAME_MAX).
_TAP_ID_FOLDER_PREFIX_LEN = 255


def data_root() -> Path:
    override = os.environ.get('DROIDO_APPDIR', '').strip()
    if override:
        return Path(override).expanduser().resolve()
    return (Path.home() / _DEFAULT_REL).resolve()


# Characters unsafe or disallowed on many Android/shared FS layouts → single '_'
_UNSAFE_DIR_CHARS = frozenset('\\/:*?"<>|')


def sanitize_tap_id(raw: str) -> str | None:
    s = raw.strip().lstrip('/\\')
    if not s:
        return None
    out: list[str] = []
    for c in s:
        if c == '\x00':
            continue
        if ord(c) < 32:
            continue
        out.append('_' if c in _UNSAFE_DIR_CHARS else c)
    key = ''.join(out).strip().rstrip(' .')
    if not key or key in ('.', '..'):
        return None
    if len(key) > _TAP_ID_FOLDER_PREFIX_LEN:
        key = key[:_TAP_ID_FOLDER_PREFIX_LEN].rstrip(' .')
    if not key or key in ('.', '..'):
        return None
    return key


def card_folder(tap_id: str) -> Path | None:
    key = sanitize_tap_id(tap_id)
    if key is None:
        return None
    root = data_root()
    folder = (root / key).resolve()
    try:
        folder.relative_to(root)
    except ValueError:
        return None
    return folder


def find_m3u_for_tap(tap_id: str) -> Path | None:
    from cards_store import playlist_path_for_tap

    path = playlist_path_for_tap(tap_id)
    if path is not None and path.is_file():
        return path
    folder = card_folder(tap_id)
    if folder is None or not folder.is_dir():
        return None
    for candidate in sorted(folder.iterdir()):
        if candidate.is_file() and candidate.suffix.lower() == '.m3u':
            return candidate
    return None


def play_card_for_tap(tap_id: str) -> bool:
    path = find_m3u_for_tap(tap_id)
    if path is None:
        audioPlayer.stop()
        return False
    return audioPlayer.play(path)


def _play_card_worker(tap_id: str) -> None:
    play_card_for_tap(tap_id)


def schedule_play_card_for_tap(tap_id: str) -> None:
    threading.Thread(target=_play_card_worker, args=(tap_id,), daemon=True).start()
