import json
import os
import tempfile
from pathlib import Path

from card_playback_service import card_folder, data_root, sanitize_tap_id

PLAYLIST_NAME = 'playlist.m3u'
CARD_META_NAME = 'card.json'

_UNSAFE_FILENAME_CHARS = frozenset('\\/:*?"<>|\x00')


def sanitize_filename(raw: str) -> str | None:
    name = Path(raw).name.strip()
    if not name or name in ('.', '..'):
        return None
    out: list[str] = []
    for c in name:
        if ord(c) < 32:
            continue
        out.append('_' if c in _UNSAFE_FILENAME_CHARS else c)
    key = ''.join(out).strip().rstrip(' .')
    if not key or key in ('.', '..'):
        return None
    return key


def _playlist_path(folder: Path) -> Path:
    return folder / PLAYLIST_NAME


def _meta_path(folder: Path) -> Path:
    return folder / CARD_META_NAME


def read_playlist(folder: Path) -> list[str]:
    path = _playlist_path(folder)
    if not path.is_file():
        return []
    tracks: list[str] = []
    for line in path.read_text(encoding='utf-8').splitlines():
        name = line.strip()
        if not name or name.startswith('#'):
            continue
        safe = sanitize_filename(name)
        if safe is not None:
            tracks.append(safe)
    return tracks


def write_playlist(folder: Path, tracks: list[str]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    cleaned: list[str] = []
    for t in tracks:
        safe = sanitize_filename(t)
        if safe is not None:
            cleaned.append(safe)
    body = '\n'.join(cleaned)
    if cleaned:
        body += '\n'
    dest = _playlist_path(folder)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix='.playlist-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(body)
        os.replace(tmp, dest)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_card_title(folder: Path) -> str:
    path = _meta_path(folder)
    if not path.is_file():
        return ''
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return ''
    title = data.get('title', '')
    return title if isinstance(title, str) else ''


def write_card_title(folder: Path, title: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    path = _meta_path(folder)
    data = {'title': title.strip()}
    path.write_text(json.dumps(data, ensure_ascii=False) + '\n', encoding='utf-8')


def playlist_path_for_tap(tap_id: str) -> Path | None:
    folder = card_folder(tap_id)
    if folder is None:
        return None
    return _playlist_path(folder)


def ensure_card_folder(tap_id: str) -> Path | None:
    folder = card_folder(tap_id)
    if folder is None:
        return None
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _track_exists(folder: Path, name: str) -> bool:
    return (folder / name).is_file()


def get_card(tap_id: str) -> dict | None:
    key = sanitize_tap_id(tap_id)
    if key is None:
        return None
    folder = card_folder(key)
    if folder is None:
        return None
    if not folder.is_dir():
        folder.mkdir(parents=True, exist_ok=True)
    tracks = read_playlist(folder)
    missing = [t for t in tracks if not _track_exists(folder, t)]
    return {
        'id': key,
        'title': read_card_title(folder),
        'tracks': tracks,
        'missing': missing,
    }


def save_card(tap_id: str, *, title: str | None = None, tracks: list[str]) -> dict | None:
    folder = ensure_card_folder(tap_id)
    if folder is None:
        return None
    write_playlist(folder, tracks)
    if title is not None:
        write_card_title(folder, title)
    return get_card(tap_id)


def list_cards() -> list[dict]:
    root = data_root()
    if not root.is_dir():
        return []
    out: list[dict] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir():
            continue
        card_id = entry.name
        if sanitize_tap_id(card_id) != card_id:
            continue
        tracks = read_playlist(entry)
        out.append({
            'id': card_id,
            'title': read_card_title(entry),
            'trackCount': len(tracks),
        })
    return out


def save_uploaded_file(tap_id: str, original_name: str, data: bytes) -> str | None:
    folder = ensure_card_folder(tap_id)
    if folder is None:
        return None
    safe = sanitize_filename(original_name)
    if safe is None:
        return None
    dest = folder / safe
    dest.write_bytes(data)
    return safe
