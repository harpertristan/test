"""Host-side provisioning of a trusted task controller. No keys are printed."""

import json
import os
import secrets

from bootstrap_owner import BASE, ROOT, run
from prepare_hermes_gateway import GATEWAY_CONFIG

CONFIG = GATEWAY_CONFIG.replace(
    "  api_server: []\nmcp_servers: {}",
    """  api_server: [paperclip_task]
mcp_servers:
  paperclip_task:
    command: /opt/hermes/.venv/bin/python
    args: [/opt/workspace-agent/task_control_mcp.py]
    trust: full
    tools:
      include: [current_task, submit_result]""",
)

CONFIG += '\ntools:\n  tool_search:\n    enabled: "off"\n'

PROVISION = r"""
import { createRequire } from 'node:module';
const require = createRequire('/app/server/package.json');
const { createDb, agents, heartbeatRuns } = await import(require.resolve('@paperclipai/db'));
const { eq, and, inArray } = await import(require.resolve('drizzle-orm'));
const { agentService } = await import('/app/server/src/services/agents.ts');
const db = createDb(process.env.DATABASE_URL);
const matches = (await db.select().from(agents).where(eq(agents.adapterType,'hermes_gateway')))
  .filter(a => a.name === 'Hermes' && a.status !== 'terminated');
if (matches.length !== 1) throw Error('Expected one Hermes agent');
const agent = matches[0];
const active = await db.select({id:heartbeatRuns.id}).from(heartbeatRuns).where(and(
  eq(heartbeatRuns.agentId,agent.id),inArray(heartbeatRuns.status,['running','queued']))).limit(1);
if (active.length) throw Error('Finish active tasks before setup');
let key = null;
if (process.env.WORKSPACE_PROVISION_KEY === 'yes') {
  key = await agentService(db).createApiKey(agent.id,'Local scoped task controller',
    {kind:'standard'},{responsibleUserId:agent.createdByUserId});
}
console.log('WORKSPACE_RESULT=' + JSON.stringify({agentId:agent.id,companyId:agent.companyId,...(key?{token:key.token}:{})}));
process.exit(0);
"""


def private_file(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o400)
    with os.fdopen(fd, "w") as output:
        output.write(value)
    os.chown(path, 10000, 10000)
    os.chmod(path, 0o400)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Запустите через sudo")
    private = ROOT / "private"
    identity_path = private / "task-control.json"
    config = ROOT / "config/hermes-gateway.yaml"
    if config.read_text() not in (GATEWAY_CONFIG, CONFIG):
        raise SystemExit("Конфигурация изменена вручную; изменения отменены")
    result = run(
        BASE
        + [
            "exec",
            "-T",
            "--workdir",
            "/app/cli",
            "-e",
            "WORKSPACE_PROVISION_KEY=" + ("no" if identity_path.exists() else "yes"),
            "paperclip",
            "node",
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            PROVISION,
        ]
    )
    entries = [
        line for line in result.splitlines() if line.startswith("WORKSPACE_RESULT=")
    ]
    if len(entries) != 1:
        raise RuntimeError("Не удалось подготовить контроллер; секретный вывод скрыт")
    identity = json.loads(entries[0].split("=", 1)[1])
    if identity_path.exists():
        saved = json.loads(identity_path.read_text())
        if any(saved.get(k) != identity[k] for k in ("agentId", "companyId")):
            raise RuntimeError("Привязка агента изменилась; изменения отменены")
    else:
        private_file(identity_path, json.dumps(identity))
    capability = private / "task-capability.key"
    if not capability.exists():
        private_file(capability, secrets.token_hex(32))
    lines = (private / "paperclip.env").read_text().splitlines()
    database = [line for line in lines if line.startswith("DATABASE_URL=")]
    if len(database) != 1:
        raise RuntimeError("Не найдена собственная БД Paperclip")
    # Only the controller gets the DB credential; never Hermes or its MCP child.
    private_file(private / "task-control.env", database[0] + "\n")
    bridge_state = ROOT / "state/task-bridge"
    bridge_state.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chown(bridge_state, 10000, 10000)
    os.chmod(bridge_state, 0o700)
    socket_dir = ROOT / "task-control"
    socket_dir.mkdir(mode=0o700, exist_ok=True)
    os.chown(socket_dir, 10000, 10000)
    os.chmod(socket_dir, 0o700)
    config.write_text(CONFIG)
    os.chmod(config, 0o444)
    print("Локальный контроллер текущей задачи подготовлен; секреты не выводились.")
    print(
        "Разрешены проверка текущей задачи и передача результата на проверку. Внешние действия не добавлены."
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
