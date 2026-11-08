"""Check API boundary only. No tasks, model requests or secret output."""

import json
from pathlib import Path
import sys
from hermes_gateway_bridge import KEY_FILE, UnixConnection


def main():
    key = Path(KEY_FILE).read_text().strip()
    for method, path, expected, authenticated in [
        ("GET", "/health", 401, False),
        ("GET", "/health", 200, True),
        ("POST", "/v1/files", 403, True),
        ("POST", "/api/jobs", 403, True),
        ("GET", "https://example.com/", 403, True),
    ]:
        client = UnixConnection("runtime", timeout=5)
        try:
            client.request(
                method,
                path,
                headers={"Authorization": "Bearer " + key} if authenticated else {},
            )
            response = client.getresponse()
            body = response.read()
            if response.status != expected:
                raise RuntimeError(
                    f"{method} {path}: unexpected HTTP {response.status}"
                )
            if expected == 200 and json.loads(body).get("status") != "ok":
                raise RuntimeError("Native API not ready")
            if "--runtime" not in sys.argv:
                print(f"OK: {method} {path}: {response.status}")
        finally:
            client.close()
    if "--runtime" not in sys.argv:
        print("Hermes API проверен; задач и запросов в OpenAI не было.")


if __name__ == "__main__":
    main()
