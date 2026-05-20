import json
import mimetypes
import queue
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

from audio_player import audioPlayer
from card_playback_service import sanitize_tap_id, schedule_play_card_for_tap
from cards_store import get_card, list_cards, save_card, save_uploaded_file
from multipart import parse_file_uploads
from tapped_server import WAIT_TAP_TIMEOUT_SEC

WEB_ROOT = Path(__file__).resolve().parent / 'web'
STATIC_ROOT = WEB_ROOT / 'static'
TEMPLATE_INDEX = WEB_ROOT / 'templates' / 'index.html'
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
            self._send_html(TEMPLATE_INDEX)
            return

        if path == '/editor':
            self._send_html(TEMPLATE_EDITOR)
            return

        if path == '/api/cards':
            self._send_json(200, list_cards())
            return

        card_id = self._api_card_id(path_parts)
        if card_id is not None and len(path_parts) == 3:
            card = get_card(card_id)
            if card is None:
                self._send_json(404, {'error': 'not found'})
                return
            self._send_json(200, card)
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

    def do_POST(self):
        path_parts = self._path_parts()
        path = '/' + '/'.join(path_parts) if path_parts else '/'

        if path == '/api/stop':
            audioPlayer.stop()
            self.send_response(204)
            self.end_headers()
            return

        card_id = self._api_card_id(path_parts)
        if card_id is None:
            self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
            return

        if len(path_parts) == 4 and path_parts[3] == 'preview':
            schedule_play_card_for_tap(card_id)
            self.send_response(204)
            self.end_headers()
            return

        if len(path_parts) == 4 and path_parts[3] == 'tracks':
            ctype = self.headers.get('Content-Type', '')
            if not ctype.startswith('multipart/form-data'):
                self._send_json(400, {'error': 'multipart/form-data required'})
                return
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length) if length > 0 else b''
            uploaded: list[str] = []
            for filename, data in parse_file_uploads(ctype, raw):
                name = save_uploaded_file(card_id, filename, data)
                if name is not None:
                    uploaded.append(name)
            if not uploaded:
                self._send_json(400, {'error': 'no files uploaded'})
                return
            self._send_json(200, {'uploaded': uploaded})
            return

        self._send_bytes(404, b'Not Found', 'text/plain; charset=utf-8')
