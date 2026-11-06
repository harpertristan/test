"""Print only allowlisted denial fields, never raw logs or request arguments."""

import json
import subprocess

from bootstrap_owner import BASE, HERE


def safe_events(raw):
    for line in raw.splitlines():
        # Docker compose prefixes each line; only our dedicated structured event is accepted.
        start = line.find('{"event":"task_control_refused"')
        if start < 0:
            continue
        try:
            item = json.loads(line[start:])
        except ValueError:
            continue
        result = {"event": "task_control_refused"}
        for field in ("stage", "code", "nativeCode"):
            value = item.get(field)
            if (
                isinstance(value, str)
                and 0 < len(value) <= 80
                and all(c.isalnum() or c == "_" for c in value)
            ):
                result[field] = value
        status = item.get("httpStatus")
        if isinstance(status, int) and 100 <= status <= 599:
            result["httpStatus"] = status
        yield result


def main():
    command = BASE + [
        "-f",
        str(HERE / "compose.hermes-gateway.yaml"),
        "-f",
        str(HERE / "compose.task-control.yaml"),
        "logs",
        "--no-color",
        "--tail",
        "150",
        "task-control",
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    events = list(safe_events(result.stdout))
    for event in events[-12:]:
        print(json.dumps(event))
    if not events:
        print("Нет записанных кодов отказа. Сырые журналы не выводились.")


if __name__ == "__main__":
    main()
