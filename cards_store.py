import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from audio_normalize import normalize_audio, normalized_output_path
from card_playback_service import card_folder, data_root, sanitize_tap_id

PLAYLIST_NAME = 'playlist.m3u'
CARD_META_NAME = 'card.json'
STAGING_DIR_NAME = '.staging'
ORIGINAL_STAGING_NAME = 'original'

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


def _staging_root(folder: Path) -> Path:
    return folder / STAGING_DIR_NAME


def _staging_dir(folder: Path, staging_id: str) -> Path | None:
    if not staging_id or '/' in staging_id or '\\' in staging_id or staging_id in ('.', '..'):
        return None
    return _staging_root(folder) / staging_id


def audio_url_for_path(card_id: str, relative_path: str) -> str:
    parts = relative_path.split('/')
    encoded = '/'.join(parts)
    return f'/api/cards/{card_id}/audio/{encoded}'


def resolve_audio_path(tap_id: str, relative_path: str) -> Path | None:
    folder = card_folder(tap_id)
    if folder is None or not relative_path:
        return None
    rel = relative_path.replace('\\', '/').lstrip('/')
    if '..' in rel.split('/'):
        return None
    target = (folder / rel).resolve()
    try:
        target.relative_to(folder.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None
    return target


def _original_staging_file(staging_dir: Path, original_name: str) -> Path:
    ext = Path(original_name).suffix
    return staging_dir / f'{ORIGINAL_STAGING_NAME}{ext}'


def normalized_path_for_staging(staging_dir: Path, original_name: str) -> Path:
    original = _original_staging_file(staging_dir, original_name)
    return normalized_output_path(original)


def normalized_commit_name(original_name: str) -> str:
    """Final on-disk name for a normalized track (e.g. voice.m4a → voice.norm.m4a)."""
    safe = sanitize_filename(original_name) or 'audio'
    p = Path(safe)
    return f'{p.stem}.norm{p.suffix}'


def create_staging_upload(tap_id: str, original_name: str, data: bytes) -> dict | None:
    folder = ensure_card_folder(tap_id)
    if folder is None:
        return None
    safe_name = sanitize_filename(original_name)
    if safe_name is None:
        return None
    staging_id = uuid.uuid4().hex
    staging_dir = _staging_dir(folder, staging_id)
    if staging_dir is None:
        return None
    staging_dir.mkdir(parents=True, exist_ok=True)
    original_path = _original_staging_file(staging_dir, safe_name)
    original_path.write_bytes(data)
    rel = f'{STAGING_DIR_NAME}/{staging_id}/{original_path.name}'
    return {
        'stagingId': staging_id,
        'originalName': safe_name,
        'originalUrl': audio_url_for_path(tap_id, rel),
        'normalizedUrl': None,
    }


def normalize_staging(tap_id: str, staging_id: str, original_name: str) -> dict | None:
    folder = card_folder(tap_id)
    if folder is None:
        return None
    staging_dir = _staging_dir(folder, staging_id)
    if staging_dir is None or not staging_dir.is_dir():
        return None
    src = _original_staging_file(staging_dir, original_name)
    if not src.is_file():
        return None
    dest = normalized_path_for_staging(staging_dir, original_name)
    if dest.is_file():
        rel = f'{STAGING_DIR_NAME}/{staging_id}/{dest.name}'
        return {'normalizedUrl': audio_url_for_path(tap_id, rel)}
    if not normalize_audio(src, dest):
        return None
    rel = f'{STAGING_DIR_NAME}/{staging_id}/{dest.name}'
    return {'normalizedUrl': audio_url_for_path(tap_id, rel)}


def _unique_final_name(folder: Path, basename: str) -> str:
    safe = sanitize_filename(basename)
    if safe is None:
        safe = 'audio'
    candidate = safe
    stem = Path(safe).stem
    suffix = Path(safe).suffix
    n = 2
    while (folder / candidate).exists():
        candidate = f'{stem} ({n}){suffix}'
        n += 1
    return candidate


def _discard_staging_dir(staging_dir: Path) -> None:
    if staging_dir.is_dir():
        shutil.rmtree(staging_dir, ignore_errors=True)


def discard_staging(tap_id: str, staging_id: str) -> bool:
    folder = card_folder(tap_id)
    if folder is None:
        return False
    staging_dir = _staging_dir(folder, staging_id)
    if staging_dir is None:
        return False
    _discard_staging_dir(staging_dir)
    return True


def commit_staging(tap_id: str, staging_id: str, original_name: str, choice: str) -> str | None:
    if choice not in ('original', 'normalized'):
        return None
    folder = card_folder(tap_id)
    if folder is None:
        return None
    staging_dir = _staging_dir(folder, staging_id)
    if staging_dir is None or not staging_dir.is_dir():
        return None
    original_path = _original_staging_file(staging_dir, original_name)
    if not original_path.is_file():
        return None
    if choice == 'original':
        source = original_path
        final_basename = sanitize_filename(original_name) or 'audio'
    else:
        norm_path = normalized_path_for_staging(staging_dir, original_name)
        if not norm_path.is_file():
            return None
        source = norm_path
        final_basename = normalized_commit_name(original_name)
    final_name = _unique_final_name(folder, final_basename)
    dest = folder / final_name
    shutil.copy2(source, dest)
    _discard_staging_dir(staging_dir)
    return final_name
