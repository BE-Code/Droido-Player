from card_playback import audioPlayer
from handlers import SimpleHandler
from tapped_server import TappedServer

HOST = '0.0.0.0'
PORT = 8080

if __name__ == '__main__':
    server = TappedServer((HOST, PORT), SimpleHandler)

    print(f'Server listening on all interfaces: http://{HOST}:{PORT}')
    print('This device: http://127.0.0.1:{}/'.format(PORT))
    print('Other devices on WiFi: http://<this-phone-or-tablet-ip>:{}/'.format(PORT))
    print('Tap webhook example: http://127.0.0.1:{}/tapped/123'.format(PORT))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down server...')
    finally:
        audioPlayer.stop()
        server.server_close()
