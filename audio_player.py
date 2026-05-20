import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path


class AudioPlayer:
    """Interface for audio players."""

    def play(self, path: str) -> bool:
        """Play the audio file at the given path."""
        return False

    def stop(self) -> bool:
        """Stop the audio player."""
        return False

    def get_pause(self) -> bool | None:
        """Return pause state, or None if player is not active."""
        return None

    def get_playback_state(self) -> dict:
        """Return active, paused, and stopped flags for the UI."""
        return {'active': False, 'paused': False, 'stopped': True}

    def set_pause(self, paused: bool) -> bool:
        """Set pause on/off."""
        return False

    def toggle_pause(self) -> bool:
        """Toggle pause when playback is active."""
        state = self.get_playback_state()
        if not state.get('active') or state.get('stopped'):
            return False
        return self.set_pause(not state.get('paused'))

    def forward(self) -> bool:
        """Skip forward one track."""
        return False

    def back(self) -> bool:
        """Skip back one track."""
        return False


class MpvPlayer(AudioPlayer):
    """One idle mpv with JSON IPC; `play` replaces the playlist."""

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
        path = Path(m3u_path).resolve()
        with self._lock:
            if not self._ensure():
                return False
            # --keep-open=yes pauses on EOF for the last playlist entry; a later
            # loadfile can replace the playlist but leave pause=yes, so nothing plays.
            if not self._ok(self._ipc(['loadfile', str(path), 'replace'])):
                return False
            return self._ok(self._ipc(['set_property', 'pause', False]))

    def get_pause(self) -> bool | None:
        with self._lock:
            if not self._alive():
                return None
            msg = self._ipc(['get_property', 'pause'], timeout_sec=0.5)
            if not self._ok(msg):
                return None
            return bool(msg.get('data'))

    def _playlist_count(self) -> int | None:
        if not self._alive():
            return None
        msg = self._ipc(['get_property', 'playlist-count'], timeout_sec=0.5)
        if not self._ok(msg):
            return None
        try:
            return int(msg.get('data', 0))
        except (TypeError, ValueError):
            return None

    def get_playback_state(self) -> dict:
        with self._lock:
            if not self._alive():
                return {'active': False, 'paused': False, 'stopped': True}
            msg = self._ipc(['get_property', 'pause'], timeout_sec=0.5)
            if not self._ok(msg):
                return {'active': False, 'paused': False, 'stopped': True}
            paused = bool(msg.get('data'))
            count = self._playlist_count()
            stopped = count is None or count < 1
            return {'active': True, 'paused': paused, 'stopped': stopped}

    def set_pause(self, paused: bool) -> bool:
        with self._lock:
            if not self._ensure():
                return False
            return self._ok(self._ipc(['set_property', 'pause', paused]))

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

    def stop(self) -> bool:
        """Stop and clear playlist if mpv is running; no-op if mpv is not up."""
        with self._lock:
            if not self._alive():
                return True
            cleared = self._ok(self._ipc(['playlist-clear']))
            stopped = self._ok(self._ipc(['stop']))
            return cleared and stopped


audioPlayer = MpvPlayer()
