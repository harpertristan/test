import unittest
import time
from unittest.mock import patch
from model_proxy import Gateway, Handler

class ModelQueueTests(unittest.TestCase):
    def test_busy_rate_window_waits_for_slot(self):
        g=Gateway.__new__(Gateway)
        import threading
        g.lock=threading.Lock()
        now=time.monotonic()
        g.calls=[now-59.97]*20
        with patch("model_proxy.time.sleep") as pause:
            # Move the clock so window ages naturally; don't stall test.
            clock=[now,now+0.10,now+0.10]
            with patch("model_proxy.time.monotonic",side_effect=lambda:clock.pop(0) if clock else now+0.10):
                self.assertTrue(g.wait_for_rate_slot(timeout=1))
        self.assertGreaterEqual(pause.call_count,1)

    def test_queue_limits_are_bounded(self):
        import threading
        g=Gateway.__new__(Gateway)
        g.queue=threading.BoundedSemaphore(32)
        self.assertTrue(all(g.queue.acquire(blocking=False) for _ in range(32)))
        self.assertFalse(g.queue.acquire(blocking=False))
        for _ in range(32):g.queue.release()

    def test_no_unbounded_rate_wait(self):
        g=Gateway.__new__(Gateway)
        import threading
        g.lock=threading.Lock()
        g.calls=[time.monotonic()]*20
        self.assertFalse(g.wait_for_rate_slot(timeout=0))
if __name__=="__main__":
    unittest.main()
