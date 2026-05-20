import json
import mimetypes
import queue
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

from android_volume import VolumeUnavailable, get_volume, set_volume
from audio_normalize import ffmpeg_available
from audio_player import audioPlayer
from card_playback_service import (
    get_now_playing_tap_id,
    sanitize_tap_id,
    schedule_play_card_for_tap,
)
from cards_store import (
    commit_staging,
    create_staging_from_track,
    create_staging_from_url,
    create_staging_upload,
    delete_track_file,
    discard_staging,
    get_card,
    list_cards,
    normalize_staging,
    resolve_audio_path,
    save_card,
    validate_file_stem,
)
from multipart import parse_file_uploads
from tapped_server import WAIT_TAP_TIMEOUT_SEC

WEB_ROOT = Path(__file__).resolve().parent / 'web'
STATIC_ROOT = WEB_ROOT / 'static'
TEMPLATE_EDITOR = WEB_ROOT / 'templates' / 'editor.html'


class SimpleHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if 'wait-tap' in self.path:
            return
        super().log_message(format, *args)

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header('Content-type', content_type)
        self.send_header('Content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, status: int, fs_path: Path) -> None:
        body = fs_path.read_bytes()
        ctype, _ = mimetypes.guess_type(str(fs_path))
        if not ctype:
            ctype = 'application/octet-stream'
        self._send_bytes(status, body, ctype)

    def _send_json(self, status: int, obj) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self._send_bytes(status, body, 'application/json; charset=utf-8')

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def _send_static(self, url_path):
        rel = url_path[len('/static/'):].lstrip('/')
        if not rel or '..' in rel.split('/'):
            self.send_error(404)
            return
        fs_path = (STATIC_ROOT / rel).resolve()
        if not str(fs_path).startswith(str(STATIC_ROOT.resolve())) or not fs_path.is_file():
            self.send_error(404)
            return
        ctype, _ = mimetypes.guess_type(str(fs_path))
        if not ctype:
            ctype = 'application/octet-stream'
        body = fs_path.read_bytes()
        self._send_bytes(200, body, ctype)

    def _send_html(self, path: Path) -> None:
        html = path.read_text(encoding='utf-8')
        self._send_bytes(200, html.encode('utf-8'), 'text/html; charset=utf-8')

    def _path_parts(self):
        return urlparse(self.path).path.strip('/').split('/')

    def _api_card_id(self, parts: list[str]) -> str | None:
        if len(parts) < 3 or parts[0] != 'api' or parts[1] != 'cards':
            return None
        return sanitize_tap_id(unquote(parts[2]))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        raw_path = parsed.path

        if raw_path.startswith('/static/'):
            self._send_static(raw_path)
            return

        path_parts = parsed.path.strip('/').split('/')

        if path == '/':
            self._send_html(TEMPLATE_EDITOR)
            return

        if path == '/api/cards':
            self._send_json(200, list_cards())
            return

        if path == '/api/volume':
            try:
                self._send_json(200, {'volume': get_volume()})
            except VolumeUnavailable as exc:
                self._send_json(503, {'error': str(exc)})
            return

        if path == '/api/playback':
            state = audioPlayer.get_playback_state()
            card_id = get_now_playing_tap_id()
            if card_id is not None:
                state['cardId'] = card_id
            self._send_json(200, state)
            return

        card_id = self._api_card_id(path_parts)
        if card_id is not None and len(path_parts) == 3:
            card = get_card(card_id)
            if card is None:
                self._send_json(404, {'error': 'not found'})
                return
            self._send_json(200, card)
            return

        if (
            card_id is not None
            and len(path_parts) >= 5
            and path_parts[3] == 'audio'
        ):
            rel = '/'.join(unquote(p) for p in path_parts[4:])
            fs_path = resolve_audio_path(card_id, rel)
            if fs_path is None:
                self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
                return
            self._send_file(200, fs_path)
            return

        if path == '/wait-tap':
            q = self.server.register_waiter()
            try:
                tap_id = q.get(timeout=WAIT_TAP_TIMEOUT_SEC)
            except queue.Empty:
                self._send_json(408, {'error': 'timeout'})
                return
            finally:
                self.server.unregister_waiter(q)

            self._send_json(200, {'id': tap_id})
            return

        if len(path_parts) == 2 and path_parts[0] == 'tapped':
            tap_id = sanitize_tap_id(unquote(path_parts[1]))
            if tap_id is None:
                self._send_bytes(400, b'invalid tap id', 'text/plain; charset=utf-8')
                return
            self.server.record_tap(tap_id)
            self._send_bytes(200, f'hello {tap_id}'.encode('utf-8'), 'text/plain; charset=utf-8')
            return

        self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')

    def do_PUT(self):
        path_parts = self._path_parts()
        card_id = self._api_card_id(path_parts)
        if card_id is None or len(path_parts) != 3:
            self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
            return

        body = self._read_json_body()
        if body is None or 'tracks' not in body:
            self._send_json(400, {'error': 'expected JSON with tracks array'})
            return
        tracks = body.get('tracks')
        if not isinstance(tracks, list) or not all(isinstance(t, str) for t in tracks):
            self._send_json(400, {'error': 'tracks must be an array of strings'})
            return

        title = body.get('title')
        if title is not None and not isinstance(title, str):
            self._send_json(400, {'error': 'title must be a string'})
            return

        card = save_card(card_id, title=title, tracks=tracks)
        if card is None:
            self._send_json(400, {'error': 'invalid card id'})
            return
        self._send_json(200, card)

    def do_DELETE(self):
        path_parts = self._path_parts()
        card_id = self._api_card_id(path_parts)
        if card_id is None:
            self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
            return

        if len(path_parts) == 5 and path_parts[3] == 'staging':
            staging_id = unquote(path_parts[4])
            if not discard_staging(card_id, staging_id):
                self._send_json(404, {'error': 'staging not found'})
                return
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 5 and path_parts[3] == 'tracks':
            track_name = unquote(path_parts[4])
            if not delete_track_file(card_id, track_name):
                self._send_json(404, {'error': 'track not found'})
                return
            self.send_response(204)
            self.end_headers()
            return

        self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')

    def do_POST(self):
        path_parts = self._path_parts()

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'stop':
            audioPlayer.stop()
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'pause':
            if not audioPlayer.set_pause(True):
                self._send_json(503, {'error': 'pause failed'})
                return
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'resume':
            if not audioPlayer.set_pause(False):
                self._send_json(503, {'error': 'resume failed'})
                return
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'forward':
            if not audioPlayer.forward():
                self._send_json(503, {'error': 'skip forward failed'})
                return
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'back':
            if not audioPlayer.back():
                self._send_json(503, {'error': 'skip back failed'})
                return
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 2 and path_parts[0] == 'api' and path_parts[1] == 'volume':
            body = self._read_json_body()
            if not isinstance(body, dict) or 'volume' not in body:
                self._send_json(400, {'error': 'expected JSON with volume number'})
                return
            raw = body.get('volume')
            if not isinstance(raw, (int, float)):
                self._send_json(400, {'error': 'volume must be a number'})
                return
            try:
                set_volume(raw)
                self._send_json(200, {'volume': get_volume()})
            except VolumeUnavailable as exc:
                self._send_json(503, {'error': str(exc)})
            return

        card_id = self._api_card_id(path_parts)
        if card_id is None:
            self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
            return

        if len(path_parts) == 4 and path_parts[3] == 'play':
            schedule_play_card_for_tap(card_id)
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 5 and path_parts[3] == 'tracks' and path_parts[4] == 'from-url':
            body = self._read_json_body()
            if not isinstance(body, dict):
                self._send_json(400, {'error': 'JSON body required'})
                return
            url = body.get('url')
            if not isinstance(url, str) or not url.strip():
                self._send_json(400, {'error': 'url required'})
                return
            result = create_staging_from_url(card_id, url)
            if 'error' in result:
                err = result['error']
                status = 400 if err.startswith('only http') else 503
                self._send_json(status, {'error': err})
                return
            self._send_json(200, result)
            return

        if len(path_parts) == 6 and path_parts[3] == 'tracks' and path_parts[5] == 'edit':
            track_name = unquote(path_parts[4])
            result = create_staging_from_track(card_id, track_name)
            if result is None:
                self._send_json(404, {'error': 'track not found'})
                return
            self._send_json(200, result)
            return

        if len(path_parts) == 4 and path_parts[3] == 'tracks':
            ctype = self.headers.get('Content-Type', '')
            if not ctype.startswith('multipart/form-data'):
                self._send_json(400, {'error': 'multipart/form-data required'})
                return
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length) if length > 0 else b''
            uploads = parse_file_uploads(ctype, raw)
            if not uploads:
                self._send_json(400, {'error': 'no files uploaded'})
                return
            filename, data = uploads[0]
            result = create_staging_upload(card_id, filename, data)
            if result is None:
                self._send_json(400, {'error': 'invalid upload'})
                return
            self._send_json(200, result)
            return

        if len(path_parts) == 6 and path_parts[3] == 'staging' and path_parts[5] == 'normalize':
            if not ffmpeg_available():
                self._send_json(503, {'error': 'ffmpeg not available; install ffmpeg in Termux'})
                return
            staging_id = unquote(path_parts[4])
            body = self._read_json_body() or {}
            original_name = body.get('originalName', '')
            if not isinstance(original_name, str) or not original_name:
                self._send_json(400, {'error': 'originalName required'})
                return
            result = normalize_staging(card_id, staging_id, original_name)
            if result is None:
                self._send_json(500, {'error': 'normalization failed'})
                return
            self._send_json(200, result)
            return

        if len(path_parts) == 6 and path_parts[3] == 'staging' and path_parts[5] == 'commit':
            staging_id = unquote(path_parts[4])
            body = self._read_json_body()
            if body is None:
                self._send_json(400, {'error': 'JSON body required'})
                return
            choice = body.get('choice')
            original_name = body.get('originalName', '')
            if choice not in ('original', 'normalized'):
                self._send_json(400, {'error': 'choice must be original or normalized'})
                return
            if not isinstance(original_name, str) or not original_name:
                self._send_json(400, {'error': 'originalName required'})
                return
            file_stem = body.get('fileStem')
            if file_stem is not None and not isinstance(file_stem, str):
                self._send_json(400, {'error': 'fileStem must be a string'})
                return
            replace_track = body.get('replaceTrack')
            if replace_track is not None and not isinstance(replace_track, str):
                self._send_json(400, {'error': 'replaceTrack must be a string'})
                return
            if choice == 'normalized' and not ffmpeg_available():
                self._send_json(503, {'error': 'ffmpeg not available'})
                return
            if file_stem is not None and str(file_stem).strip():
                stem_err = validate_file_stem(str(file_stem), original_name)
                if stem_err:
                    self._send_json(400, {'error': stem_err})
                    return
            filename = commit_staging(
                card_id,
                staging_id,
                original_name,
                choice,
                file_stem=file_stem,
                replace_track=replace_track,
            )
            if filename is None:
                self._send_json(400, {'error': 'commit failed'})
                return
            self._send_json(200, {'filename': filename})
            return

        self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
