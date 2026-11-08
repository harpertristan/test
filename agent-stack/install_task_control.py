"""Install the current-task bridge, preserving a text-only rollback path."""

from bootstrap_owner import BASE, HERE, ROOT, run
import os
import subprocess
from prepare_task_control import CONFIG, main as prepare

ALL = BASE + [
    "-f",
    str(HERE / "compose.hermes-gateway.yaml"),
    "-f",
    str(HERE / "compose.task-control.yaml"),
]
PREVIOUS = BASE + ["-f", str(HERE / "compose.hermes-gateway.yaml")]


def up(command, services):
    run(
        command
        + [
            "up",
            "-d",
            "--no-deps",
            "--force-recreate",
            "--wait",
            "--wait-timeout",
            "180",
            *services,
        ]
    )


def main():
    config = ROOT / "config/hermes-gateway.yaml"
    old = config.read_text()
    prepare()
    try:
        run(ALL + ["config", "--quiet"])
        print("Запускаю контроллер текущей задачи…", flush=True)
        up(ALL, ["task-control"])
        print("Подключаю два локальных инструмента Hermes…", flush=True)
        up(ALL, ["hermes-runtime", "hermes-paperclip-bridge"])
        print(
            run(
                ALL
                + [
                    "exec",
                    "-T",
                    "hermes-runtime",
                    "/opt/hermes/.venv/bin/python",
                    "/opt/workspace-agent/probe_task_control.py",
                ]
            ),
            end="",
        )
    except Exception:
        # Keep startup diagnostics private before recreating a failed container.
        try:
            failure = subprocess.run(
                ALL
                + [
                    "logs",
                    "--no-color",
                    "--tail",
                    "80",
                    "hermes-runtime",
                    "task-control",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            diagnostic = ROOT / "private/task-control-startup.log"
            with diagnostic.open("w") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(failure.stdout)
        except (OSError, subprocess.SubprocessError):
            pass  # Diagnostics must never prevent rollback.
        # Restore the previous text-only run path instead of relaxing a policy.
        config.write_text(old)
        try:
            if old == CONFIG:
                up(ALL, ["task-control"])
                up(ALL, ["hermes-runtime", "hermes-paperclip-bridge"])
            else:
                up(PREVIOUS, ["hermes-runtime", "hermes-paperclip-bridge"])
                run(ALL + ["stop", "task-control"])
        except Exception:
            raise RuntimeError(
                "Не удалось закончить откат. Проверьте контейнеры; ключи не выводились"
            ) from None
        raise RuntimeError(
            "Контроллер не установлен. Предыдущий режим Hermes восстановлен; ключи не выводились"
        ) from None
    print("Подключено: русский язык, текущая задача и передача результата в in_review.")
    print(
        "Done остаётся за пользователем. Почта, документы и внешние действия ещё не подключены."
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
