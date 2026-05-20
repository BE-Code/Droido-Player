import queue
import threading
from collections import deque
from http.server import ThreadingHTTPServer

from card_playback_service import schedule_play_card_for_tap

WAIT_TAP_TIMEOUT_SEC = 120.0
_CANCEL_SENTINEL = object()


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

    def cancel_waiting(self) -> bool:
        """Unblock the most recent /wait-tap long-poll (user cancelled scan)."""
        with self._wait_lock:
            if not self._tap_waiters:
                return False
            q = self._tap_waiters.pop()
        try:
            q.put_nowait(_CANCEL_SENTINEL)
        except queue.Full:
            pass
        return True

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
        else:
            schedule_play_card_for_tap(tap_id)
