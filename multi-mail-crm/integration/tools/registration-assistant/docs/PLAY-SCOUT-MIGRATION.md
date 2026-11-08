# Перенос помощника в Play Scout — пошаговая инструкция

Результат: один сервер и адрес сайта, два раздела:

- Play Scout: https://play-scout.34.22.184.67.sslip.io/crm
- Помощник: https://play-scout.34.22.184.67.sslip.io/assistant/

Помощник использует доступ Play Scout. Отдельной формы логина и пароля в серверной вкладке нет. Расширение подключается токеном. Локальная версия помощника сохраняет прежний режим входа для резервного запуска.

Инструкция рассчитана на подтверждённую установку `/srv/play-scout/code`, Docker Compose и Caddy. Установщик проверяет эти условия и читает исходные Compose-файлы из работающего контейнера. Текущие `data`, `app.env`, сертификаты Caddy и установленная Ollama остаются на месте. Новый код помещается отдельно в `/srv/play-scout-workspace`; перед переключением создаётся резервная копия CRM.

## 1. Подготовка

В CRM остановите текущий поиск / ИИ и дождитесь остановки. В локальном помощнике дождитесь окончания загрузки документов. На время переключения не запускайте новые задачи.

Откройте обычный PowerShell на компьютере, где находится помощник.

## 2. Обновите локальные файлы и создайте архив данных

Вставьте **одной строкой**:

```powershell
$ErrorActionPreference='Stop'; $base='https://raw.githubusercontent.com/harpertristan/test/registration-assistant'; $target=Join-Path ([Environment]::GetFolderPath('Desktop')) 'registration-assistant'; if(!(Test-Path (Join-Path $target 'Start-Windows.cmd'))){throw "Папка помощника не найдена: $target"}; $release=Invoke-RestMethod "$base/updates/latest.json"; $updater=Join-Path $env:TEMP ("assistant-update-"+[guid]::NewGuid().ToString('N')+".mjs"); Invoke-WebRequest "$base/scripts/update.mjs" -UseBasicParsing -OutFile $updater; if((Get-FileHash $updater -Algorithm SHA256).Hash -ine $release.updater_sha256){throw 'Контрольная сумма не совпала'}; node --use-env-proxy $updater --target $target --start; if($LASTEXITCODE -ne 0){throw 'Обновление не завершено'}
```

После успешного обновления выполните во **всё том же окне PowerShell**:

```powershell
node --disable-warning=ExperimentalWarning (Join-Path $target 'scripts/export-migration.mjs') --target $target --output (Join-Path ([Environment]::GetFolderPath('Desktop')) 'assistant-transfer.tar.gz')
```

На рабочем столе появится `assistant-transfer.tar.gz`. В архив входят база, оригиналы документов и ключ расшифровки сохранённых настроек OpenAI. Если ключ был в `.env`, переносятся только его AI-настройки, а не Windows-пути и порты.

Локальный помощник безопасно остановится. Его исходные данные останутся на компьютере. Если архив с таким именем уже есть, сначала переименуйте прежний архив — скрипт не перезаписывает его.

## 3. Загрузите архив на сервер

Откройте прежнее SSH-окно сервера в Google Cloud. В меню SSH нажмите **«Загрузить файл / Upload file»** и выберите архив с рабочего стола. Дождитесь завершения загрузки.

В SSH проверьте файл:

```bash
chmod 600 "$HOME/assistant-transfer.tar.gz"
ls -lh "$HOME/assistant-transfer.tar.gz"
```

Если загрузчик показал другой путь, подставьте его вместо `$HOME/assistant-transfer.tar.gz` в следующем шаге.

Архив содержит документы и сохранённые настройки — он предназначен для вашего сервера, а не для публикации в GitHub.

## 4. Установите общую панель

В SSH вставьте весь блок:

```bash
(
  set -e
  curl --fail --location --show-error \
    https://raw.githubusercontent.com/harpertristan/test/registration-assistant/deploy/play-scout/install.sh \
    -o /tmp/install-play-scout-workspace.sh
  sudo bash /tmp/install-play-scout-workspace.sh \
    --archive "$HOME/assistant-transfer.tar.gz"
)
```

Дождитесь сообщения **«Готово. В Play Scout появилась вкладка помощника»**.

Установщик:

1. Проверяет действующую установку и исходные Compose-файлы.
2. Загружает код двух приложений в отдельную папку.
3. Проверяет архив по SHA256 каждого файла и восстанавливает помощник в пустую папку данных. Уже существующая база не перезаписывается.
4. Собирает новые образы и проверяет конфигурацию Caddy.
5. Останавливает CRM для согласованной резервной копии базы вместе с журналом и `app.env`.
6. Переключает интерфейс и подключает помощник. Ollama не пересоздаётся.
7. Если настроен штатный таймер копирования Play Scout, подключает к нему копирование обоих приложений с прежним расписанием.
8. Проверяет общий доступ через HTTPS с действующими настройками Play Scout. При ошибке переключения пытается вернуть прежние приложение и Caddy.

Если в архиве несколько пользователей помощника, установщик попросит выбрать существующего владельца компаний. Повторите команду **без `--archive`**, добавив `--user`, например:

```bash
sudo bash /tmp/install-play-scout-workspace.sh --user ivan
```

Здесь `ivan` нужно заменить на прежний логин владельца документов. Это настройка доступа к перенесённым данным, а не новый вход в браузере. Остальные записи базы сохраняются.

## 5. Откройте сайт и оформление

Откройте https://play-scout.34.22.184.67.sslip.io/crm и нажмите Ctrl+F5 (на Mac — Cmd+Shift+R).

Вверху появятся разделы **Play Scout** и **Помощник регистраций**. Перейдите в помощник: должны быть доступны перенесённые компании и документы без отдельного входа.

В Play Scout выберите **Оформление → Фиолетовое**. Появится персонаж с лупой. Обычное и ночное оформление сохранены. В помощнике остаётся его прежний персонаж; там по-прежнему можно выбрать обычное или фиолетовое оформление.

## 6. Переподключите расширение Dolphin

1. Откройте `chrome://extensions` в Dolphin и перезагрузите расширение из обновлённой папки `registration-assistant/extension`.
2. В серверной вкладке помощника нажмите **«Создать токен на 24 часа»**.
3. В настройках расширения укажите адрес:

```text
https://play-scout.34.22.184.67.sslip.io/assistant/
```

4. Вставьте созданный токен и сохраните подключение.
5. Обновите страницу банковской анкеты и откройте панель помощника.

Токен действует 24 часа. Для вставки данных основная анкета компании должна быть проверена и сохранена, как прежде.

## 7. Проверка и управление

Статус сервисов:

```bash
sudo /srv/play-scout-workspace/workspace.sh status
```

Последние журналы:

```bash
sudo /srv/play-scout-workspace/workspace.sh logs
```

Запуск установленной общей панели:

```bash
sudo /srv/play-scout-workspace/workspace.sh start
```

Остановка приложений с сохранением данных:

```bash
sudo /srv/play-scout-workspace/workspace.sh stop
```

Согласованная копия CRM и помощника с автоматическим запуском после копирования:

```bash
sudo /srv/play-scout-workspace/workspace.sh backup-and-start
```

Возврат прежних интерфейса и Caddy:

```bash
sudo /srv/play-scout-workspace/workspace.sh rollback
```

Данные помощника при откате сохраняются. После перехода используйте `workspace.sh` для управления общей панелью: старый `server.sh public` относится к прежней конфигурации без помощника.

Резервная копия CRM находится в `/srv/play-scout-workspace/backups/`; точный путь печатает установщик. Перенесённые данные помощника находятся в `/srv/play-scout-workspace/assistant-data`.

Если этап завершился ошибкой, сохраните текст ошибки и вывод `workspace.sh status` (если этот файл уже создан). Не удаляйте базы, журналы и Docker-тома для повторного запуска.

## Если общая панель уже установлена, а архив ещё не импортирован

Браузерный SSH и `gcloud compute scp` могут использовать разные домашние папки. Найдите архив:

```bash
sudo find /home /root -maxdepth 3 -type f -name 'assistant-transfer.tar.gz' -ls
```

Используйте найденный полный путь. Дополнительный импорт проверяет архив и целостность SQLite до остановки помощника, сохраняет прежнюю папку данных и настройки, выбирает прежнего пользователя и пересоздаёт только контейнер помощника. Play Scout и Ollama продолжают работать. При ошибке запуска возвращаются прежние данные. Это замена базы помощника снимком с Windows, а не слияние двух баз; текущая серверная база сохраняется в резервной папке.

```bash
(
  set -e
  curl --fail --location --show-error \
    https://raw.githubusercontent.com/harpertristan/test/registration-assistant/deploy/play-scout/import-installed.sh \
    -o /tmp/import-play-scout-assistant.sh
  sudo bash /tmp/import-play-scout-assistant.sh /home/ivano/assistant-transfer.tar.gz
)
```

Если в архиве несколько пользователей, добавьте прежний логин владельца компаний вторым аргументом. Ключи не печатаются в терминале. После импорта проверьте компании, документы и соединение OpenAI в кабинете. Расширение подключите свежим токеном серверного помощника.
