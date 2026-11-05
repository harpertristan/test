"""Three isolated queues inside the single Compose worker service.

A slow IMAP/LLM request cannot consume the notification worker. Every child is
terminated on shutdown; an unexpected exit restarts the whole service.
"""

import signal
import subprocess
import sys
import time

stopping = False
children = []


def stop(signum, frame):
    global stopping
    stopping = True


for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, stop)
try:
    for queue, concurrency in (("sync", 2), ("classify", 2), ("control", 1)):
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "celery",
                    "-A",
                    "app.workers.celery_app:celery_app",
                    "worker",
                    "--loglevel=INFO",
                    "--queues=" + queue,
                    "--hostname=" + queue + "@%h",
                    "--concurrency=" + str(concurrency),
                    "--max-tasks-per-child=200",
                ]
            )
        )
    while not stopping:
        if any(child.poll() is not None for child in children):
            raise RuntimeError("Worker process exited")
        time.sleep(0.5)
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 75
    for child in children:
        try:
            child.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
