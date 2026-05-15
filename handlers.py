import json
import mimetypes
import queue
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

from card_playback import sanitize_tap_id
from tapped_server import WAIT_TAP_TIMEOUT_SEC

WEB_ROOT = Path(__file__).resolve().parent / 'web'
STATIC_ROOT = WEB_ROOT / 'static'
TEMPLATE_PATH = WEB_ROOT / 'templates' / 'index.html'


class SimpleHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if 'wait-tap' in self.path:
            return
        super().log_message(format, *args)

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
        self.send_response(200)
        self.send_header('Content-type', ctype)
        self.send_header('Content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        raw_path = parsed.path

        if raw_path.startswith('/static/'):
            self._send_static(raw_path)
            return

        path_parts = parsed.path.strip('/').split('/')

        if path == '/':
            html = TEMPLATE_PATH.read_text(encoding='utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(html.encode('utf-8'))
            return

        if path == '/wait-tap':
            q = self.server.register_waiter()
            try:
                tap_id = q.get(timeout=WAIT_TAP_TIMEOUT_SEC)
            except queue.Empty:
                self.send_response(408)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                body = json.dumps({'error': 'timeout'}).encode('utf-8')
                self.send_header('Content-length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            finally:
                self.server.unregister_waiter(q)

            body = json.dumps({'id': tap_id}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if len(path_parts) == 2 and path_parts[0] == 'tapped':
            tap_id = sanitize_tap_id(unquote(path_parts[1]))
            if tap_id is None:
                self.send_response(400)
                self.send_header('Content-type', 'text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'invalid tap id')
                return
            self.server.record_tap(tap_id)

            self.send_response(200)
            self.send_header('Content-type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(f'hello {tap_id}'.encode('utf-8'))
            return

        self.send_response(404)
        self.send_header('Content-type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'Not Found')
