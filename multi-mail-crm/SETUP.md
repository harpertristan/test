# Подключение и работа — пошаговая инструкция

## 1. Открыть третью вкладку без входа

Локально: `python3 scripts/init_env.py`, затем
`docker compose --profile integrated up --build -d --wait`. Откройте
`http://localhost:3000/crm` и выберите **Почтовая CRM**. Прямой путь — `/mail-crm/`.
Логин, пароль и создание администратора для новой CRM не требуются.

На существующем VPS не запускайте демо-копии двух старых приложений: используйте
[integration/DEPLOYMENT.md](integration/DEPLOYMENT.md). Настройки и базы первых двух
инструментов остаются прежними; новый модуль использует отдельные тома.

## 2. Подключить домен и HTTPS на VPS

1. Направьте DNS A-запись вашего домена, например `crm.example.com`, на VPS.
2. Откройте входящие TCP 80 и 443. Порты 5432, 6379 и 8000 наружу не открывайте.
3. Установите Caddy по [официальной инструкции](https://caddyserver.com/docs/install).
4. В `deploy/Caddyfile` замените `crm.example.com` на свой домен. Установите этот
   файл в `/etc/caddy/Caddyfile` и перезагрузите Caddy. Он проксирует локальный 8080
   и автоматически получает TLS-сертификат.
5. В `.env` установите:

   ```dotenv
   PUBLIC_URL=https://crm.example.com
   APP_BASE_PATH=/mail-crm
   ```

6. Примените переменные:

   ```sh
   docker compose up -d --force-recreate api worker beat
   ```

7. Откройте свой HTTPS-домен и откройте вкладку снова. Для API и WebSocket нужен один origin.
   Не добавляйте `/api` к `PUBLIC_URL`; завершающий слеш не нужен.

## 3. Добавить фирмы и ящики

Откройте почтовую CRM:

1. **Управление → Компании → Добавить компанию**: название обязательно;
   ИНН, сайт, телефон, адрес и заметки можно заполнить позже.
2. **Почтовые ящики → Добавить ящик**: выберите компанию, провайдера, email.
3. Для IMAP введите пароль приложения. Для Gmail/Zoho сохраните ящик, затем нажмите
   **Подключить OAuth** в его строке.
4. Нажмите **Синхронизировать**. Строка показывает время последней успешной проверки
   и ошибку, если она есть. Задание выполняется в очереди, не мгновенно.

Один ящик привязывается к одной фирме. Изменение фирмы в настройках ящика переносит
его переписку в новую фирму. Удаление ящика удаляет его локальную историю; исходный
почтовый ящик у провайдера не удаляется. Есть подтверждение перед удалением.

## 4. Zoho Mail EU

1. Откройте `https://api-console.zoho.eu`, создайте **Server-based application**.
2. Добавьте redirect URI **точно**:

   ```text
   https://crm.example.com/mail-crm/api/oauth/callback/zoho_eu
   ```

3. Запишите Client ID и Client Secret в `.env`:

   ```dotenv
   ZOHO_CLIENT_ID=ваш_client_id
   ZOHO_CLIENT_SECRET=ваш_client_secret
   ZOHO_ORGANIZATION_ID=ваш_org_id
   ```

4. Пересоздайте `api worker beat` командой из раздела 2.
5. В интерфейсе создайте ящик `zoho_eu`. Укажите **organization_id**: все ящики
   одной организации должны использовать одинаковый ID, иначе общий limiter
   не сможет правильно учитывать квоту.
6. Нажмите **Подключить OAuth**, войдите именно в нужный ящик и подтвердите доступ.
7. Нажмите **Синхронизировать**. Вернувшись из OAuth, вы также увидите обновлённое подключение.

Запрашиваются `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.ALL`.
Фактические разрешения и доступность API зависят от тарифа и правил организации.
API закреплён на `https://mail.zoho.eu/api`, token URL —
`https://accounts.zoho.eu/oauth/v2/token`; регион `.com` здесь не используется.

**Webhook при наличии подходящего тарифа/интеграции:** защищённый endpoint и значение
header можно получить администратором через `GET /api/accounts/<UUID>/zoho-webhook`.
Настройте отправку POST на возвращённый URL с возвращённым `X-CRM-Webhook-Token`.
Если ваша интеграция Zoho не умеет пользовательский header или webhook недоступен,
оставьте polling. Не отключайте проверку webhook-токена.

**Квота:** при 30 req/min одна организация не может обслужить 300 индивидуальных
опросов раз в 2 минуты. На чтение контента тоже тратится запрос. Для быстрой доставки
нужны webhook и достаточная квота; просто увеличивать число worker-процессов бесполезно.

## 5. Gmail / Google Workspace

1. В Google Cloud включите **Gmail API**. Настройте OAuth consent screen.
2. Создайте OAuth Client типа **Web application**.
3. Добавьте redirect URI:

   ```text
   https://crm.example.com/mail-crm/api/oauth/callback/gmail
   ```

4. В `.env` заполните `GMAIL_CLIENT_ID` и `GMAIL_CLIENT_SECRET`, пересоздайте backend-сервисы.
5. Добавьте Gmail-ящик в интерфейсе, нажмите **Подключить OAuth** и выберите тот же email.
6. Подтвердите scopes `gmail.readonly`, `gmail.send`, `gmail.modify`.
7. Выполните начальную синхронизацию. Сам вызов `messages.get` не меняет UNREAD.

Публичное приложение с такими scopes может требовать Google OAuth verification.
В режиме Testing добавьте нужные тестовые аккаунты; Google ограничивает срок refresh
токенов тестовых приложений. Для постоянной эксплуатации используйте подходящий
режим публикации и политику Google Workspace. Проверка API не снимает требования Google.

**Push через Pub/Sub — необязателен для начала:**

1. Создайте topic, разрешите `gmail-api-push@system.gserviceaccount.com` публиковать в него.
2. Создайте authenticated push subscription на
   `https://crm.example.com/mail-crm/api/webhooks/gmail`.
3. Настройте OIDC service account и audience. В `.env` заполните:

   ```dotenv
   GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/TOPIC_ID
   GMAIL_PUBSUB_AUDIENCE=https://crm.example.com/mail-crm/api/webhooks/gmail
   GMAIL_PUSH_SERVICE_ACCOUNT=SERVICE_ACCOUNT_EMAIL
   ```

4. Пересоздайте `api worker beat`. Задание продления само зарегистрирует Gmail watch
   после подключения OAuth; повторная проверка — каждые 10 минут, обновление watch
   — когда до истечения осталось меньше суток.

Webhook проверяет подпись Google, issuer, audience и email аккаунта доставки.
Не используйте неаутентифицированную push subscription. Polling остаётся fallback.

## 6. Inbox.eu

1. В настройках Inbox.eu разрешите IMAP-доступ для почтовых программ.
2. В CRM выберите **Inbox.eu** и введите полный адрес электронной почты.
   Он же используется как логин; отдельное поле логина не требуется.
3. Введите пароль для почтовой программы Inbox.eu. Если сервис выдал отдельный
   пароль внешнего доступа, используйте его вместо обычного пароля сайта.
4. Сохраните ящик и нажмите **Синхронизировать**.

Система использует `mail.inbox.eu:993` (IMAP TLS) и `mail.inbox.eu:465` (SMTP TLS).
Чтение выполняется через `EXAMINE` и `BODY.PEEK[]`, без изменения непрочитанности.
Пароль хранится зашифрованным. При редактировании пустое поле сохраняет текущий пароль.
Google / Gmail и Zoho Mail EU подключаются через OAuth: пароль вводится только на сайте
соответствующего сервиса после кнопки **Подключить Google / Zoho** в списке ящиков.

При обновлении адреса `@inbox.eu`, добавленные через прежний Mail.ru-коннектор,
переносятся на Inbox.eu с пересозданием курсора синхронизации. История не удаляется.
Другие старые Mail.ru-ящики отключаются, их записи и переписка сохраняются для истории.
Новые ящики могут использовать только Inbox.eu, Gmail и Zoho Mail EU.

## 7. Классификация — OpenAI либо Ollama

**OpenAI:**

```dotenv
CLASSIFIER_BACKEND=openai
OPENAI_API_KEY=ваш_ключ
OPENAI_MODEL=gpt-4o-mini
LLM_REQUESTS_PER_MINUTE=60
```

После изменения пересоздайте `worker`. Новые входящие классифицируются автоматически.
При ошибке будет `other` с confidence 0 и причиной в tooltip категории.

**Локальная Ollama:**

1. Запустите Ollama на отдельной доступной машине и установите модель `qwen2.5:7b`.
2. Укажите в `.env`:

   ```dotenv
   CLASSIFIER_BACKEND=ollama
   OLLAMA_BASE_URL=http://IP_ДОСТУПНОГО_СЕРВЕРА:11434
   OLLAMA_MODEL=qwen2.5:7b
   ```

3. Пересоздайте `worker`. Не открывайте Ollama в публичный Интернет без защиты.

Ollama не входит в шестисервисный Compose: 8 GB VPS не следует одновременно считать
готовым GPU-сервером LLM. На Linux `host.docker.internal` требует отдельной настройки;
проще указать маршрутизируемый внутренний адрес. Локальная модель — техническая
возможность; правовые требования 152-ФЗ нужно оценивать для всего хранения и обработки данных.

## 8. Telegram

1. Создайте бота через BotFather. В `.env` заполните:

   ```dotenv
   TELEGRAM_BOT_TOKEN=ваш_токен
   TELEGRAM_BOT_USERNAME=имя_бота_без_символа_собаки
   ```

2. Убедитесь, что `PUBLIC_URL` — ваш доступный HTTPS-домен.
3. Примените настройки и зарегистрируйте webhook:

   ```sh
   docker compose up -d --force-recreate api worker beat
   docker compose exec api python -m app.cli telegram-webhook
   ```

4. Откройте **Настройки → Получить одноразовый код**.
5. Отправьте боту `/start <код>` или открывает предложенную ссылку.
6. Нажимает **Проверить привязку** в CRM.

Код действует 10 минут, используется один раз и привязывает личный чат. При >5
уведомлениях одному пользователю за окно 60 секунд бот отправляет одну сводку.
В обычном сообщении есть «Открыть в CRM» и «Прочитано». Отсутствие Telegram-настроек
не блокирует получение/классификацию писем. Для первой загрузки большого архива
удобнее подключить Telegram после начальной синхронизации.

## 9. Добавить 300 ящиков через CSV

Это альтернатива ручному созданию. Возьмите `accounts.example.csv`, сохраните свою
копию вне Git. Поля: `company,email,provider,display_name,organization_id,imap_user,password_env`.

Для IMAP строка содержит **имя переменной**, например `MAILBOX_SALES_PASSWORD`,
а значение пароля приложения хранится в `.env`:

```dotenv
MAILBOX_SALES_PASSWORD=пароль_приложения
```

После изменения `.env` пересоздайте `api`, затем импортируйте:

```sh
docker compose up -d --force-recreate api
docker compose exec -T api python -m app.cli import-accounts --file - < my-accounts.csv
```

Импорт создаёт недостающие компании, не дублирует уже созданные одинаковые ящики,
при ошибке откатывает весь импорт. Для OAuth-ящиков затем подключите OAuth через
интерфейс. CSV не должен содержать открытые пароли. После успешного импорта IMAP
пароли уже зашифрованы в БД; при желании удалите временные `MAILBOX_...` из `.env`
и пересоздайте контейнеры, сохранив ключ Fernet.

## 10. Общая CRM без учётных записей

Вход и регистрация отсутствуют. Нет создания пользователей, паролей и invite-кодов.
Всем открывшим CRM доступны её действия. Избранное и Telegram общие. Наличие
в URL технического UUID для WebSocket — маршрутизация уведомлений, не авторизация.
Пароли IMAP, OAuth-разрешения и API-ключи сервисов по-прежнему нужны и защищаются
Fernet; не публикуйте `.env` и резервные копии. Старые инструменты сохраняют свои
исходные настройки доступа.

## 11. Остановка, запуск, обновление и копии

```sh
# Остановить без удаления данных:
docker compose down
# Запустить снова:
docker compose up -d
# Сначала сделать резервную копию:
sh scripts/backup.sh
# Затем обновить исходники и пересобрать:
docker compose up --build -d
```

Не используйте `docker compose down -v`: эта команда удаляет тома с данными.
Резервные копии находятся в `backups/`, исключены из Git. Отдельно сохраните `.env`
в защищённом хранилище: без прежнего `FERNET_KEY` пароли и OAuth-токены из БД не расшифровать.
Не заменяйте пароль PostgreSQL в `.env` после инициализации без изменения пароля роли в БД.

Пример восстановления (предварительно убедитесь, что выбран нужный dump; операция
заменяет данные текущей базы):

```sh
docker compose stop api worker beat frontend
docker compose exec -T postgres sh -c 'exec pg_restore --clean --if-exists --exit-on-error --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < backups/YOUR_BACKUP.dump
docker compose up -d
```

## 12. Диагностика и метрики

```sh
docker compose ps
docker compose logs --tail=100 api worker beat
docker compose exec -T worker celery -A app.workers.celery_app:celery_app inspect ping --timeout=10
docker compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready').read().decode())"
```

- `api` не стартует: проверьте ключи `.env`, доступность БД и журнал миграций.
- Нет новых писем: смотрите `last_error` ящика, его активность, worker/beat и авторизацию провайдера.
- OAuth вернул ошибку: проверьте точный redirect URI, регион EU, consent/test-users и выбранный email.
- `other`, confidence 0: проверьте ключ/баланс LLM либо доступ к Ollama.
- Нет Telegram: проверьте webhook, PUBLIC_URL с HTTPS и общую Telegram-привязку CRM; подождите окно 60 секунд.
- «Результат отправки неизвестен»: сначала выясните у провайдера, доставлено ли письмо; не повторяйте вслепую.

`/health/live` проверяет процесс. `/health/ready` проверяет PostgreSQL, Redis и миграции;
это не тест OAuth, SMTP или работы всех worker. `/metrics` доступен внутри Docker-сети
по `api:8000`, но закрыт через публичный Nginx. Пример scrape — `monitoring/prometheus.yml`.
HTTP-метрики агрегируются между процессами API; счётчики worker хранятся в Redis.
Логи структурированы JSON. Не отправляйте `.env`, резервные копии или тела писем в общие логи.

## 13. Тесты

Локальные unit-тесты:

```sh
python3.12 -m venv .venv
. .venv/bin/activate
pip install --require-hashes -r requirements.lock
python -m pytest -q tests/test_classifier.py tests/test_providers.py tests/test_pending.py
```

Полный интеграционный набор запускается **только на отдельной базе с окончанием `_test`**:

```sh
docker compose exec -T postgres psql -U crm -d crm -c 'CREATE DATABASE crm_test'
docker compose exec -T api sh -c 'export DATABASE_URL="${DATABASE_URL%/*}/crm_test" REDIS_URL=redis://redis:6379/14 TEST_INTEGRATION=1; alembic upgrade head && python -m pytest -q -o cache_dir=/tmp/crm-pytest-cache'
```

Если меняли имя PostgreSQL-пользователя/базы, замените `crm` в первой команде.
Если `crm_test` уже существует, создавать её повторно не нужно. Тесты удаляют
данные только в выделенной тестовой базе; не направляйте их на рабочую БД.

Проверка UI с изолированными фикстурами 320 ящиков:

```sh
cd frontend
npm ci
npx playwright install chromium
npm run test:browser
```

Система должна быть запущена на локальном 8080; можно задать `CRM_BASE_URL`.
Если Chromium уже установлен системно, задайте `CHROMIUM_PATH`. В Docker/CI может
потребоваться sandbox-конфигурация и библиотеки Chromium. Браузерный тест провайдеры не вызывает.

## 14. Сеть управляемой облачной среды

На обычном VPS используются штатные TLS-корни и исходящая сеть. В управляемой среде
может потребоваться доверенный CA прокси **и при сборке, и во время работы**.
Используйте `docker-compose.cloud.yml` с `PROXY_CA_BUNDLE`, указывающим на полный
доверенный CA bundle. Проверку TLS не отключайте.

```sh
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d
```

Нужен разрешённый HTTPS-доступ к `mail.zoho.eu`, `accounts.zoho.eu`,
`accounts.google.com`, `oauth2.googleapis.com`, `gmail.googleapis.com`,
`www.googleapis.com`, `api.openai.com`, `api.telegram.org` и к Ollama при её использовании.
Для IMAP/SMTP нужен разрешённый TCP/TLS-доступ к `mail.inbox.eu:993` и `mail.inbox.eu:465`;
HTTP-прокси сам по себе его не предоставляет. В текущей среде настоящие почтовые
подключения не проверялись: доступ и учётные данные необходимо настроить перед live-тестом.

## Удаление писем и правило Inbox.eu

Кнопка **Удалить письмо** у входящего письма создаёт устойчивую задачу переноса
в корзину провайдера. Письмо сразу скрывается из CRM; запись с remote ID сохраняется,
поэтому повторная синхронизация не возвращает удалённое письмо и не создаёт уведомления.
Общая корзина провайдера не очищается. В «Управлении» видны число ожидающих переносов
и ошибки. Неудачные переносы повторяются через 5 минут.

Правило всегда включено: входящие от `support@inbox.eu` с полной темой
`New sign in from … to your email` автоматически уходят в корзину для любой страны.
Регистр букв не важен. Другие отправители, ответы `Re:` и другие темы не подходят.
Правило применяется до LLM и уведомлений Telegram; подтверждение не запрашивается.
Миграция `0004` помечает подходящие старые письма, пересчитывает счётчики; фоновая задача
переносит их на сервере. Новые письма обрабатываются сразу при импорте.

Inbox.eu использует UID MOVE либо COPY → STORE Deleted → UID EXPUNGE только конкретного UID.
Если Trash отсутствует или безопасные команды не поддерживаются, оригинал сохраняется,
а ошибка отображается в «Управлении». При обрыве между COPY и завершением возможна
повторная копия в Trash; общей EXPUNGE и безвозвратной очистки корзины нет.
Gmail использует `messages.trash`, Zoho EU — перенос в системную папку Trash.
Восстановление выполняется через почтовый сервис; в CRM сохраняется метка удаления.
