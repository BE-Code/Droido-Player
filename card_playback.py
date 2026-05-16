import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


# Matches setup: APPDIR=~/storage/shared/Droido-Player-Data
_DEFAULT_REL = Path('storage') / 'shared' / 'Droido-Player-Data'
# Long NFC payloads map to a folder name = first N chars (fits typical NAME_MAX).
_TAP_ID_FOLDER_PREFIX_LEN = 255


def _data_root() -> Path:
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


def _card_folder_for_tap(tap_id: str) -> Path | None:
    key = sanitize_tap_id(tap_id)
    if key is None:
        return None
    root = _data_root()
    folder = (root / key).resolve()
    try:
        folder.relative_to(root)
    except ValueError:
        return None
    return folder


class Card:
    """Resolves a tap id to a data folder, optional info.json, and an ordered playback queue."""

    class _UseFolderScan:
        """Sentinel: build_queue should scan the card folder for audio."""

    _USE_FOLDER_SCAN = _UseFolderScan()
    _INFO_JSON_NAME = 'info.json'
    _AUDIO_EXTENSIONS = frozenset({
        '.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma',
    })

    @staticmethod
    def _path_is_under(parent: Path, candidate: Path) -> bool:
        try:
            candidate.resolve().relative_to(parent.resolve())
        except ValueError:
            return False
        return True

    @staticmethod
    def _scan_folder_audio(folder: Path) -> list[Path]:
        exts = Card._AUDIO_EXTENSIONS
        out = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts]
        out.sort(key=lambda p: p.name)
        return out

    @staticmethod
    def _tracks_override_or_use_scan(info: dict[str, Any], folder: Path) -> list[Path] | _UseFolderScan:
        if 'tracks' not in info:
            return Card._USE_FOLDER_SCAN
        raw = info['tracks']
        if raw is None:
            return Card._USE_FOLDER_SCAN
        if not isinstance(raw, list):
            return Card._USE_FOLDER_SCAN
        root = folder.resolve()
        resolved: list[Path] = []
        for item in raw:
            if not isinstance(item, str):
                continue
            rel = item.strip()
            if not rel:
                continue
            cand = (folder / rel).resolve()
            if not Card._path_is_under(root, cand):
                continue
            if cand.is_file():
                resolved.append(cand)
        return resolved

    def __init__(self, tap_id: str) -> None:
        self._tap_id = tap_id
        self.folder = _card_folder_for_tap(tap_id)
        self._info: dict[str, Any] | None = None

    def _load_info(self) -> dict[str, Any]:
        if self._info is not None:
            return self._info
        if self.folder is None or not self.folder.is_dir():
            self._info = {}
            return self._info
        path = self.folder / self._INFO_JSON_NAME
        if not path.is_file():
            self._info = {}
            return self._info
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            self._info = {}
            return self._info
        if not isinstance(data, dict):
            self._info = {}
            return self._info
        self._info = data
        return self._info

    @property
    def display_name(self) -> str:
        info = self._load_info()
        raw = info.get('name')
        if isinstance(raw, str):
            name = raw.strip()
            if name:
                return name
        if self.folder is not None:
            return self.folder.name
        return self._tap_id

    def build_queue(self) -> list[Path]:
        if self.folder is None or not self.folder.is_dir():
            return []
        info = self._load_info()
        tracks_mode = self._tracks_override_or_use_scan(info, self.folder)
        if tracks_mode is self._USE_FOLDER_SCAN:
            return self._scan_folder_audio(self.folder)
        return tracks_mode


class MpvPlayer:
    """One idle mpv with JSON IPC; `play` / `play_paths` replace the playlist."""

    def __init__(self, ipc_socket: Path | str | None = None) -> None:
        self._ipc_socket = Path(ipc_socket).expanduser().resolve() if ipc_socket else None
        self._lock = threading.Lock()

    def _socket_path(self) -> Path:
        if self._ipc_socket is not None:
            return self._ipc_socket
        override = os.environ.get('DROIDO_MPV_IPC', '').strip()
        if override:
            return Path(override).expanduser().resolve()
        base = os.environ.get('TMPDIR') or os.environ.get('XDG_RUNTIME_DIR') or tempfile.gettempdir()
        return (Path(base) / 'droido-mpv.sock').resolve()

    def _socket_parent(self) -> Path:
        return self._socket_path().parent

    def _unlink_socket(self) -> None:
        path = self._socket_path()
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    @staticmethod
    def _ok(resp: dict | None) -> bool:
        return resp is not None and resp.get('error') == 'success'

    def _ipc(self, command: list, timeout_sec: float = 5.0) -> dict | None:
        sock_path = self._socket_path()
        rid = time.time_ns()
        payload_obj: dict = {'command': command, 'request_id': rid}
        payload = json.dumps(payload_obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8') + b'\n'
        buf = b''
        client: socket.socket | None = None
        try:
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(timeout_sec)
            client.connect(str(sock_path))
            client.sendall(payload)
            while True:
                while b'\n' not in buf:
                    chunk = client.recv(16384)
                    if not chunk:
                        return None
                    buf += chunk
                line, buf = buf.split(b'\n', 1)
                line = line.strip()
                if not line:
                    continue
                msg = json.loads(line.decode('utf-8'))
                if msg.get('request_id') == rid:
                    return msg
        except (FileNotFoundError, OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None
        finally:
            if client is not None:
                try:
                    client.close()
                except OSError:
                    pass

    def _alive(self) -> bool:
        return self._ok(self._ipc(['get_property', 'mpv-version'], timeout_sec=0.5))

    def _wait(self, timeout_sec: float = 8.0) -> bool:
        path = self._socket_path()
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            if path.exists():
                if self._alive():
                    return True
            time.sleep(0.05)
        return False

    def _spawn(self) -> bool:
        sock = self._socket_path()
        try:
            self._socket_parent().mkdir(parents=True, exist_ok=True)
        except OSError:
            return False
        cmd = [
            'mpv',
            '--idle=yes',
            '--keep-open=yes',
            '--no-video',
            '--really-quiet',
            f'--input-ipc-server={sock}',
        ]
        try:
            subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except (FileNotFoundError, OSError):
            return False
        return True

    def _ensure(self) -> bool:
        if self._alive():
            return True
        self._unlink_socket()
        if not self._spawn():
            return False
        return self._wait()

    def play(self, m3u_path: str | Path) -> bool:
        return self.play_paths([Path(m3u_path)])

    def play_paths(self, paths: list[Path]) -> bool:
        if not paths:
            return False
        lines = ['#EXTM3U'] + [str(p.resolve()) for p in paths]
        text = '\n'.join(lines) + '\n'
        fd, tmp = tempfile.mkstemp(prefix='droido-', suffix='.m3u')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                fh.write(text)
        except OSError:
            try:
                Path(tmp).unlink(missing_ok=True)
            except OSError:
                pass
            return False
        tmp_path = Path(tmp)
        try:
            with self._lock:
                if not self._ensure():
                    return False
                return self._ok(self._ipc(['loadfile', str(tmp_path.resolve()), 'replace']))
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    def forward(self) -> bool:
        with self._lock:
            if not self._ensure():
                return False
            return self._ok(self._ipc(['playlist-next', 'weak']))

    def back(self) -> bool:
        with self._lock:
            if not self._ensure():
                return False
            return self._ok(self._ipc(['playlist-prev', 'weak']))


mpv = MpvPlayer()


def _play_card_worker(tap_id: str) -> None:
    card = Card(tap_id)
    paths = card.build_queue()
    if not paths:
        return
    mpv.play_paths(paths)


def schedule_play_card_for_tap(tap_id: str) -> None:
    threading.Thread(target=_play_card_worker, args=(tap_id,), daemon=True).start()
