# Изолированный модельный шлюз Hermes — этап настройки

Состояние: модельный шлюз и CLI-запуск через Unix socket. Paperclip и адаптеры трёх
приложений ещё не подключены. Установка не означает готовность всего агента.

Hermes использует network_mode: none и не получает ключ OpenAI. В его контейнере
работает loopback HTTP -> Unix bridge. Шлюз OpenAI — отдельный непривилегированный
контейнер с исходящей сетью; публичных портов у него нет. Только он читает ключ.
Ключ в запрос агента/аргументы CLI не попадает. Общий каталог сокета монтируется
Hermes read-only, чтобы он не мог заменить сокет или создать в нём файлы.

Шлюз разрешает только текстовый Chat Completions для gpt-4o-mini и локальный список
разрешённых моделей. Запрещены Files, Responses, отправка почты, произвольные URL,
редиректы, изображения по ссылкам и серверные инструменты. Function tools здесь
лишь описание функций для модели, не право выполнять внешние действия.

Проверки: 11 unittest, lint и Docker Compose config прошли локально. Реальный запрос
с ключом пользователя и запуск на его VPS проверяются после установки.

Предохранители: 2 одновременных запроса, 20 запросов/мин, ограниченные размер запроса
и длина ответа. Это защита нагрузки, а не механизм запрета публикаций.
Жёсткие суточные квоты выключены по умолчанию. При необходимости оператор задаёт
DAILY_REQUEST_LIMIT и DAILY_INPUT_BYTE_LIMIT только шлюзу. Их счётчики сохраняются
в SQLite и не сбрасываются при перезапуске. Это не точный финансовый лимит в долларах.

Установка на уже подготовленный VPS:

1. Получить эту ветку в отдельный /srv/hermes-stack/deployment-source.
2. `sudo python3 agent-stack/prepare.py` (из deployment-source).
   Ключ копируется из работающей CRM, если найден; иначе запрашивается скрытым вводом.
   Исходный .env CRM не изменяется. Нет копирования остальных ключей и BotFather token.
3. `docker compose -f agent-stack/compose.yaml config --quiet`.
4. `docker compose -f agent-stack/compose.yaml up -d model-proxy`.
5. `docker compose -f agent-stack/compose.yaml exec -T model-proxy /opt/hermes/.venv/bin/python /opt/workspace-agent/probe_gateway.py`.
   Проверка не выполняет вызовов OpenAI.
6. Первый модельный тест: `docker compose -f agent-stack/compose.yaml run --rm -T hermes chat -q 'Ответь ровно: МОДЕЛЬ ПОДКЛЮЧЕНА'`.
   Это уже разрешённая передача синтетического запроса в OpenAI, без рабочих данных.

В окружении Google SSH используйте `sudo docker --host=unix:///var/run/docker.sock`.
Не запускайте Paperclip с trusted-local UI на публичном адресе. Его запуск и связка
с Hermes — следующий отдельный этап. Существующий бот CRM сохраняет свой webhook.
Не предоставляйте агенту docker.sock или каталоги существующих сервисов.

## Первый запуск Paperclip без публикации панели

`prepare_paperclip.py` создаёт только собственные секреты Paperclip и его БД,
повторный запуск не меняет пароли. `compose.paperclip.yaml` добавляет отдельную
PostgreSQL и Paperclip с аутентификацией, отключённой регистрацией/телеметрией,
выключенным scheduler агентов и отдельной внутренней сетью. Ключ OpenAI и папки
рабочих сервисов Paperclip не получает. На хосте открыт только 127.0.0.1:3101.

```bash
sudo python3 prepare_paperclip.py
sudo docker --host=unix:///var/run/docker.sock compose \
  -f compose.yaml -f compose.paperclip.yaml \
  up -d --wait --wait-timeout 240 paperclip-db paperclip
```

Это подготовительный закрытый запуск; учётная запись владельца и внешний защищённый
доступ настраиваются следующим шагом. Browser localhost на компьютере пользователя
не относится к localhost VPS. Не открывайте порт 3101 в Google Cloud firewall.
Пароли/claim-ссылки и полные разрешённые Compose env-конфигурации не присылаются в чат.
