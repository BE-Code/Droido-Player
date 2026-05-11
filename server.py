from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

HOST = '0.0.0.0'
PORT = 8080


class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path_parts = parsed.path.strip('/').split('/')

        # Match: /tapped/:id
        if len(path_parts) == 2 and path_parts[0] == 'tapped':
            tap_id = path_parts[1]

            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()

            response = f'hello {tap_id}'
            self.wfile.write(response.encode())
            return

        # 404 for everything else
        self.send_response(404)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'Not Found')


if __name__ == '__main__':
    server = HTTPServer((HOST, PORT), SimpleHandler)

    print(f'Server running on http://{HOST}:{PORT}')
    print('Example: http://127.0.0.1:8080/tapped/123')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down server...')
        server.server_close()
