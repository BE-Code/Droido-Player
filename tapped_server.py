import queue
import threading
from collections import deque
from http.server import ThreadingHTTPServer

WAIT_TAP_TIMEOUT_SEC = 120.0


class TappedServer(ThreadingHTTPServer):
    """Routes each tap to the next waiting long-poll, FIFO."""

    def __init__(self, server_address, RequestHandlerClass):
        super().__init__(server_address, RequestHandlerClass)
        self._wait_lock = threading.Lock()
        self._tap_waiters = deque()

    def register_waiter(self):
        q = queue.Queue(maxsize=1)
        with self._wait_lock:
            self._tap_waiters.append(q)
        return q

    def unregister_waiter(self, q):
        with self._wait_lock:
            try:
                self._tap_waiters.remove(q)
            except ValueError:
                pass

    def record_tap(self, tap_id):
        q = None
        with self._wait_lock:
            if self._tap_waiters:
                q = self._tap_waiters.popleft()
        if q is not None:
            try:
                q.put_nowait(tap_id)
            except queue.Full:
                pass
