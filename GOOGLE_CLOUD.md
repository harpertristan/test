# Полный перенос Play Scout в Google Cloud: Mac → сервер с Ollama

Инструкция для Google Compute Engine, Ubuntu 24.04 LTS x86_64, NVIDIA L4, Docker Compose и HTTPS через Caddy. Сохраняются CRM, материалы, очередь, заметки, исключения, настройки, API-ключи и модели Ollama. Сервер после переноса работает без включённого Mac. Один экземпляр приложения обслуживает общую базу.

Подготовленные файлы находятся в `deploy/google-cloud/`. Команды ниже выполняются вами в своём Google Cloud; создание и оплата сервера автоматически не производились. GPU-квота, региональная доступность, домен и фактическая работа на вашей VM требуют проверки после создания.

## 1. Что арендовать и сколько это стоит

Рекомендуемый старт для GPT + Ollama: **g2-standard-8**, 8 vCPU, 32 ГБ RAM, 1 × NVIDIA L4 с 24 ГБ VRAM. Обычная VM без GPU сохранит функции Ollama, но может заметно замедлить разбор. Большая модель может не помещаться даже в 24 ГБ — сначала выполните на Mac `ollama list` и `du -sh "$HOME/.ollama/models"`.

Создайте отдельный проект, подключите Billing и запросите доступную квоту G2 / NVIDIA L4 в нужном регионе. Настройте бюджет и уведомления в Billing. Бюджет — уведомление, а не автоматическая остановка расходов. Стоимость проверяйте в калькуляторе перед созданием: GPU+VM за 24×7, диск, статический IPv4, резервные копии и исходящий трафик; OpenAI, Brave, Gemini и Apify оплачиваются отдельно. Для ежемесячного расчёта обычно используют около 730 часов. Не выбирайте Spot для постоянного общего CRM без готовности к прерываниям.

Для основного диска начните с **200 ГБ pd-balanced**, но оставьте запас под все модели, базу, образы и резервные копии. Диск не должен удаляться вместе с VM. Удаление проекта может удалить и диски; независимые копии обязательны.

- Калькулятор: https://cloud.google.com/products/calculator
- G2: https://cloud.google.com/compute/docs/gpus
- GPU-квоты: https://cloud.google.com/compute/resource-usage
- SSH: https://cloud.google.com/compute/docs/connect/standard-ssh

## 2. Создать VM и безопасный SSH с Mac

Установите Google Cloud CLI по официальной инструкции https://cloud.google.com/sdk/docs/install (для Apple Silicon выберите macOS ARM). Затем в Терминале Mac:

```bash
gcloud init
gcloud auth login
```

Задайте свои значения в одном окне терминала (зону проверьте на доступность G2; ниже пример):

```bash
export SCOUT_PROJECT='ВАШ_PROJECT_ID'
export SCOUT_ZONE='europe-west4-a'
export SCOUT_VM='play-scout'
export SCOUT_REGION="${SCOUT_ZONE%-*}"
gcloud config set project "$SCOUT_PROJECT"
gcloud services enable compute.googleapis.com iap.googleapis.com
```

В консоли Google Cloud включите OS Login для проекта/VM и выдайте себе роли **Compute OS Admin Login** и **IAP-secured Tunnel User**. Если VM использует service account, для SSH может понадобиться **Service Account User** на нём. Для приложения облачный service account не требуется: используйте `--no-service-account`, а не ключ администратора проекта.

```bash
gcloud compute instances create "$SCOUT_VM" \
  --zone "$SCOUT_ZONE" \
  --machine-type g2-standard-8 \
  --image-family ubuntu-2404-lts-amd64 \
  --image-project ubuntu-os-cloud \
  --boot-disk-size 200GB \
  --boot-disk-type pd-balanced \
  --no-boot-disk-auto-delete \
  --maintenance-policy TERMINATE \
  --metadata enable-oslogin=TRUE \
  --no-service-account \
  --tags play-scout
```

Команда предполагает сеть `default`. Если она отсутствует, создайте отдельную VPC с подсетью либо укажите имеющуюся через `--network` / `--subnet`; согласуйте firewall с выбранной сетью. У G2 GPU входит в тип машины.

Разрешите SSH только через IAP, не открывая порт 22 всему Интернету:

```bash
gcloud compute firewall-rules create play-scout-ssh-iap \
  --network default --direction INGRESS --action ALLOW \
  --rules tcp:22 --source-ranges 35.235.240.0/20 --target-tags play-scout
```

Если в сети уже есть `default-allow-ssh` или другое правило для `0.0.0.0/0:22`, ограничьте его либо исключите эту VM из его действия. Добавление узкого правила не отменяет широкое. Сначала проверьте IAP-подключение, чтобы не потерять доступ.

```bash
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap
```

Это ваш постоянный вход с Mac. Далее команды, помеченные «на сервере», выполняются в открывшемся SSH. Для выхода: `exit`.

## 3. На сервере: Docker и NVIDIA

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git ubuntu-drivers-common "linux-headers-$(uname -r)"
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo ubuntu-drivers install --gpgpu
sudo reboot
```

Подключитесь с Mac снова той же командой SSH. Проверьте драйвер:

```bash
nvidia-smi
```

Должна отображаться NVIDIA L4. Пока драйвер не работает, не продолжайте запуск Ollama. Для проблем с драйвером используйте руководство Google: https://cloud.google.com/compute/docs/gpus/install-drivers-gpu . Не отключайте проверку подписей пакетов или TLS.

Установите NVIDIA Container Toolkit из официального APT-репозитория:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sudo docker run --rm --gpus all ubuntu:24.04 nvidia-smi
```

Последняя команда должна видеть GPU внутри контейнера. Перезапуск Docker выполняйте на этом этапе, пока приложение ещё не обслуживает пользователей.

## 4. На сервере: скачать код и подготовить папки

```bash
sudo install -d -m 0755 /srv/play-scout
sudo git clone https://github.com/harpertristan/test.git /srv/play-scout/code
sudo install -d -m 0700 /srv/play-scout/backups
sudo install -d -m 0700 -o 1000 -g 1000 /srv/play-scout/data
sudo install -d -m 0700 /srv/play-scout/ollama
sudo cp /srv/play-scout/code/deploy/google-cloud/deployment.env.example /srv/play-scout/deployment.env
sudo chmod 600 /srv/play-scout/deployment.env
```

`code` — только исходники; `data` — вся рабочая история; `app.env` — ваши ключи и пароли; `ollama` — локальные модели. Они находятся вне Git и не заменяются обновлением. Не запускайте две копии приложения на одном `data`.

## 5. На Mac: перенести всю историю и ключи

Остановите задания и приложение через Ctrl+C. До завершения переноса старый экземпляр не запускайте. Команды рассчитаны на стандартную рабочую папку; если она другая, исправьте только строку `cd`.

```bash
cd "$HOME/Desktop/play-scout-v31"
npm run doctor -- --storage
ollama list
du -sh data "$HOME/.ollama/models"
```

Проверьте, что используемый `DATA_DIR` — именно эта папка `data`. Если в `.env` задан иной путь, архивируйте **всю фактическую папку данных**, а не пустую `data` рядом с кодом. Для этого переместите её копию в отдельную staging-папку под именем `data`, добавьте копию `.env` и архивируйте staging. Не переносите только `state.json`: необходимы журнал и остальные файлы.

Создайте приватный архив с полной папкой данных и `.env`; следующий блок не перезаписывает уже существующий архив:

```bash
(
  set -e
  umask 077
  archive="$HOME/Desktop/play-scout-server-migration.tgz"
  test ! -e "$archive" || { echo 'Архив уже существует: сохраните его под другим именем перед повтором.'; exit 1; }
  tar --exclude='*.lock' --exclude='.DS_Store' -czf "$archive" data .env
  chmod 600 "$archive"
)
gcloud compute scp "$HOME/Desktop/play-scout-server-migration.tgz" \
  "$SCOUT_VM:~/play-scout-server-migration.tgz" \
  --zone "$SCOUT_ZONE" --tunnel-through-iap
```

Архив содержит ключи: не отправляйте его в чат/Git/публичное хранилище. Передача SCP шифруется. После проверки переноса храните архив в защищённой резервной копии или удалите транспортную копию.

Для точного переноса установленных моделей Ollama скопируйте каталог models. Сначала завершите текущую генерацию. Если Ollama работает фоновым приложением на Mac, закройте его перед архивированием:

```bash
(
  set -e
  umask 077
  archive="$HOME/Desktop/play-scout-ollama-models.tgz"
  test ! -e "$archive" || { echo 'Архив моделей уже существует.'; exit 1; }
  tar -C "$HOME/.ollama" -czf "$archive" models
)
gcloud compute scp "$HOME/Desktop/play-scout-ollama-models.tgz" \
  "$SCOUT_VM:~/play-scout-ollama-models.tgz" \
  --zone "$SCOUT_ZONE" --tunnel-through-iap
```

Если использован нестандартный `OLLAMA_MODELS`, архивируйте фактический каталог под именем `models`. Это может быть большой объём. Вместо передачи можно скачать те же публичные модели через `ollama pull`, но пользовательские модели/теги точнее сохраняет копия каталога. Не переносите исполняемые файлы Ollama с Mac: Linux использует свой контейнер.

## 6. На сервере: восстановить и защитить профиль

Только на новой VM с ещё пустой базой:

```bash
sudo test ! -e /srv/play-scout/data/state.json && \
  sudo tar -xzf "$HOME/play-scout-server-migration.tgz" -C /srv/play-scout
sudo mv /srv/play-scout/.env /srv/play-scout/app.env
sudo chown -R 1000:1000 /srv/play-scout/data
sudo chmod 700 /srv/play-scout/data
sudo chown 1000:1000 /srv/play-scout/app.env
sudo chmod 600 /srv/play-scout/app.env
sudo tar -xzf "$HOME/play-scout-ollama-models.tgz" -C /srv/play-scout/ollama
sudo chmod 700 /srv/play-scout/ollama
sudo nano /srv/play-scout/app.env
```

В `nano` сохраните существующие API-ключи и ID задач. Добавьте/замените **разные** длинные пароли:

```dotenv
APP_PASSWORD=ВАШ_ДЛИННЫЙ_ПАРОЛЬ_АДМИНИСТРАТОРА
VIEW_PASSWORD=ДРУГОЙ_ДЛИННЫЙ_ПАРОЛЬ_ДЛЯ_ПРОСМОТРА
```

Значения вводите только в редакторе на сервере, не в командной строке и не в чате. Минимум 12 символов, лучше случайные 24+. Не используйте примеры буквально. Ctrl+O, Enter, Ctrl+X сохраняют и закрывают nano. Переменные `DATA_DIR`, `HOST`, `PORT`, `OLLAMA_BASE_URL` в контейнере задаются конфигурацией сервера и имеют приоритет над старым `.env`.

Если старые ключи хранились только в системном окружении Mac, их нет в `.env`: добавьте отсутствующие значения через защищённый редактор. Наличие ключа ещё не доказывает его работоспособность; проверьте подключения после входа.

## 7. Первый запуск, сначала без публикации в Интернет

```bash
cd /srv/play-scout/code
sudo bash deploy/google-cloud/server.sh build
sudo bash deploy/google-cloud/server.sh start
sudo bash deploy/google-cloud/server.sh doctor
sudo bash deploy/google-cloud/server.sh status
```

`start` поднимает и Ollama с GPU, и приложение. Первый запуск может скачивать образы. В `deployment.env` оставьте `PLAY_SCOUT_MODE=--manual`: расписания на паузе, но ручной поиск и разбор доступны. Сервис автоматически стартует после перезагрузки VM; Mac можно отключить после завершения миграции.

Проверьте модели и реальную генерацию (в примере замените модель на имя из своего `ollama list`):

```bash
sudo docker compose --env-file /srv/play-scout/deployment.env \
  -f deploy/google-cloud/compose.yaml exec ollama ollama list
sudo docker compose --env-file /srv/play-scout/deployment.env \
  -f deploy/google-cloud/compose.yaml exec ollama ollama run qwen2.5:3b 'Ответь одним словом: работает'
sudo docker compose --env-file /srv/play-scout/deployment.env \
  -f deploy/google-cloud/compose.yaml exec ollama ollama ps
```

В `ollama ps` проверьте использование GPU. Отсутствующую стандартную модель можно установить той же командой с `ollama pull ИМЯ_МОДЕЛИ` вместо `ollama run ...`. GPU и генерация считаются проверенными только после успешных команд на вашей VM.

Для первичной проверки интерфейса откройте **на Mac в отдельном терминале** SSH-туннель:

```bash
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap \
  -- -N -L 3300:127.0.0.1:3000
```

Откройте в браузере Mac `http://127.0.0.1:3300/crm` — это приватный туннель, не ссылка для других людей. Вход: `admin` и ваш APP_PASSWORD. Сравните с Mac количество карточек, заметки, исключения, источники, очередь, модель и настройки. Проверьте локальный ИИ и API-подключения через интерфейс, затем разберите одну карточку. В гибридном режиме должны быть доступны оба движка. Проверки внешних API могут расходовать их баланс.

Ollama в контейнере доступна приложению через `http://ollama:11434`; порт 11434 наружу не публикуется. Если фактически использовался **llama.cpp/GPU-пул**, а не Ollama, сохранённые `127.0.0.1:8081` и пути моделей Mac автоматически не заработают: требуется отдельная установка Linux llama.cpp и перенастройка endpoint. Такой профиль не считайте перенесённым до реального теста выбранного движка.

## 8. Общий доступ: домен и HTTPS

Нужен ваш домен/поддомен, например `scout.example.com`. Зарезервируйте постоянный внешний IP VM. На Mac:

```bash
gcloud compute addresses create play-scout-ip --region "$SCOUT_REGION"
gcloud compute addresses describe play-scout-ip --region "$SCOUT_REGION" --format='get(address)'
```

В Google Cloud Console → VM → Edit → Network interfaces назначьте этот зарезервированный IP. Текущее SSH через IAP не зависит от внешнего адреса. У DNS-провайдера создайте A-запись `scout` на этот IP; удалите неправильную AAAA-запись, если IPv6 не настроен. Не включайте перенаправление на старый IP.

Откройте только веб-порты:

```bash
gcloud compute firewall-rules create play-scout-web \
  --network default --direction INGRESS --action ALLOW \
  --rules tcp:80,tcp:443 --source-ranges 0.0.0.0/0 --target-tags play-scout
```

На сервере:

```bash
sudo nano /srv/play-scout/deployment.env
```

Укажите реальное имя без `https://` и пути: `SCOUT_DOMAIN=scout.example.com`. Затем:

```bash
cd /srv/play-scout/code
sudo bash deploy/google-cloud/server.sh public
curl --fail --silent --show-error https://scout.example.com/api/health
```

Подставьте свой домен в curl. Caddy получает и продлевает TLS-сертификат автоматически; для этого DNS и порты 80/443 должны быть доступны снаружи. Порт 3000 слушает на VM только loopback; 11434 не публикуется. Состояние `running` у Caddy не означает, что сертификат уже выдан. При ошибке: `sudo bash deploy/google-cloud/server.sh logs`, проверьте DNS, firewall и часы сервера. Не передавайте логины по открытому публичному HTTP.

Ссылка людям: **https://ВАШ_ДОМЕН/crm**.

- `admin` + APP_PASSWORD: изменения, поиск и платные API-запуски; выдавайте только доверенным операторам.
- `viewer` + VIEW_PASSWORD: просмотр, без изменений и запусков.

Это две общие роли Basic Auth, **не персональные аккаунты** с раздельными базами и аудитом по каждому человеку. Все видят общую CRM; одновременные изменения одной заметки могут перезаписать друг друга. Для персональных аккаунтов/ролей потребуется отдельная доработка. Не размещайте несколько реплик приложения на этой файловой базе.

Чтобы разрешить сохранённые расписания после проверки, установите в `deployment.env` строку `PLAY_SCOUT_MODE=` (пустое значение) и повторите `server.sh start`. Проверьте время расписаний: источники используют Europe/Kaliningrad, а не локальное время SSH. Платные задания и лимиты проверьте до включения. Apify остаётся с ручным явным запуском; сервер не делает его ежедневным автоматически.

## 9. Будущие обновления одной командой с Mac

Повторно задайте переменные, если открыли новый терминал:

```bash
export SCOUT_PROJECT='ВАШ_PROJECT_ID'
export SCOUT_ZONE='europe-west4-a'
export SCOUT_VM='play-scout'
gcloud config set project "$SCOUT_PROJECT"
```

Обновление запускайте, когда задания закончились; другие пользователи должны знать о коротком перерыве:

```bash
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap \
  --command='sudo bash /srv/play-scout/code/deploy/google-cloud/server.sh update'
```

Скрипт получает `main`, проверяет отсутствие локальных изменений кода, собирает новый образ до остановки приложения, затем корректно останавливает приложение, сохраняет **весь data и app.env**, исходную конфигурацию и ID старого образа. После этого поднимает новую версию и проверяет health. История, ключи и модели не находятся в Git и не заменяются кодом. На неудаче запуска приложение остаётся остановленным; путь копии — `/srv/play-scout/last-backup`. Частично неудачное обновление не считается завершённым.

После обновления проверьте интерфейс и один типовой запрос. Расписания остаются в выбранном режиме. Не запускайте `npm run update:mac` на сервере и не редактируйте приложение через `git reset --hard`.

Полезные команды с Mac:

```bash
# Войти интерактивно
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap
# Состояние
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap \
  --command='sudo bash /srv/play-scout/code/deploy/google-cloud/server.sh status'
# Логи: просматривайте локально, перед отправкой удаляйте возможные секреты
gcloud compute ssh "$SCOUT_VM" --zone "$SCOUT_ZONE" --tunnel-through-iap \
  --command='sudo bash /srv/play-scout/code/deploy/google-cloud/server.sh logs'
```

## 10. Резервные копии, восстановление и откат

Перед обслуживанием и минимум ежедневно делайте согласованную копию: остановка приложения → архив **всей** папки данных → запуск. `server.sh backup` останавливает приложение и намеренно оставляет остановленным:

```bash
cd /srv/play-scout/code
sudo bash deploy/google-cloud/server.sh backup
sudo bash deploy/google-cloud/server.sh start
sudo cat /srv/play-scout/last-backup
```

`profile.tar.gz` содержит ключи в app.env и все пользовательские данные. Папка backups доступна только root. Выносите копии с VM в отдельное защищённое хранилище с ограниченным доступом; копия на том же диске не защищает от его потери. Можно использовать snapshot-диск после остановки приложения; включите в план и каталог моделей `/srv/play-scout/ollama`. Сам `server.sh backup` модели не архивирует из-за размера. Сохраняйте исходную копию Mac до проверки восстановления.

Откат — на сервере, только после проверки выбранного пути копии. Он возвращает данные на момент копии, поэтому более поздние решения сначала сохраните отдельно:

```bash
sudo -i
set -e
cd /srv/play-scout/code
bash deploy/google-cloud/server.sh stop
backup=$(cat /srv/play-scout/last-backup)
test -s "$backup/profile.tar.gz"
test -s "$backup/image-id"
docker image inspect "$(cat "$backup/image-id")" >/dev/null
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mv /srv/play-scout/data "/srv/play-scout/data-before-rollback-$stamp"
cp -p /srv/play-scout/app.env "/srv/play-scout/app.env-before-rollback-$stamp"
tar -xzf "$backup/profile.tar.gz" -C /srv/play-scout
docker image tag "$(cat "$backup/image-id")" play-scout:rollback
cp "$backup/deployment.env" /srv/play-scout/deployment.env
sed -i 's/^PLAY_SCOUT_IMAGE_TAG=.*/PLAY_SCOUT_IMAGE_TAG=rollback/' /srv/play-scout/deployment.env
# Восстанавливаем именно конфигурацию того образа, не сбрасывая Git:
install -d -m 0700 /srv/play-scout/rollback-config
cp "$backup/compose.yaml" "$backup/Caddyfile" /srv/play-scout/rollback-config/
docker compose --env-file /srv/play-scout/deployment.env \
  -f /srv/play-scout/rollback-config/compose.yaml up -d --no-build --wait --wait-timeout 180 app ollama
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
exit
```

При откате базовый запуск не пересоздаёт Caddy; его сохранённый контейнер продолжает проксировать сервис app. После восстановления HTTPS проверьте отдельно. До следующего обновления разберите причину сбоя и согласуйте актуальную конфигурацию с `code/deploy/google-cloud`. Не удаляйте старые образы/копии до успешной проверки, не используйте `docker system prune -a` или `docker compose down -v` как способ обновления.

Автоматическая ежедневная копия в 03:00 по Калининграду (с небольшой случайной задержкой и коротким перерывом приложения):

```bash
cd /srv/play-scout/code
sudo cp deploy/google-cloud/play-scout-backup.service deploy/google-cloud/play-scout-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now play-scout-backup.timer
sudo systemctl list-timers play-scout-backup.timer
```

Таймер включайте после завершения начальной миграции. Проверка вручную: `sudo systemctl start play-scout-backup.service`, затем `sudo journalctl -u play-scout-backup.service -n 30`. На сбое копирования скрипт пытается вернуть приложение в работу, но выдаёт ошибку задания; проверьте место на диске и последнюю успешную копию. Уведомления об ошибках и вынос копии с VM настройте отдельно. Копии не удаляются автоматически: следите за свободным местом и задайте срок хранения после настройки внешнего хранилища. Не запускайте обновление и резервное копирование одновременно; на время ручного обновления при необходимости остановите timer и включите после завершения.

## 11. Что считать завершённым переносом

1. `nvidia-smi` работает на VM и в контейнере; Ollama генерирует ответ выбранной моделью на GPU.
2. Снимок и журнал согласованы; количество карточек, заметки, решения и очередь соответствуют Mac.
3. OpenAI/Brave/Gemini/Apify проверены, сохранённые задачи те же. Платные проверки выполняются осознанно.
4. Домен открывает HTTPS без ошибки сертификата, оба логина работают, viewer не может изменять данные.
5. Одна карточка проходит полный разбор; сервер переживает перезагрузку с сохранением базы и моделей.
6. Копия вынесена с VM, восстановление на отдельной тестовой копии проверено.
7. Старое приложение на Mac остаётся остановленным; пользователи работают с серверной общей базой.

Подготовка файлов и проверка в среде разработки не заменяют эти проверки в вашем Google Cloud. Если домена пока нет, используйте только SSH-туннель до его настройки; не открывайте приложение с паролями на публичном HTTP.
