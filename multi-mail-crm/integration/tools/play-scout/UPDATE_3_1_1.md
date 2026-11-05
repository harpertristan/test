# Архив: обновление Play Scout 3.1.0 → 3.1.1 на Mac

**Актуальное обновление 4.0.1 в той же папке, без ручного переноса: [MAC.md](MAC.md).** Ниже сохранена прежняя инструкция для справки.

Исправлено зависание сервера сразу после запуска и при открытии CRM с историей. Причина: сервер повторно обходил всю историю для каждой карточки, а планировщик запускал этот расчёт даже при выключенном ИИ. Сохранённые исключения по-прежнему учитываются.

## 1. Остановить зависшую версию

Откройте новое окно Терминала: Command + N. Если обычный Control + C в старом окне не завершает программу, команда ниже принудительно завершит процесс, слушающий порт 3000. В данной инструкции это ваш Play Scout. Уже записанная история остаётся в `data`.

```sh
lsof -tiTCP:3000 -sTCP:LISTEN | while read -r PLAY_SCOUT_PID; do kill -KILL "$PLAY_SCOUT_PID"; done
```

## 2. Скачать исправление

Скачайте [новый ZIP с GitHub](https://github.com/harpertristan/test/archive/refs/heads/main.zip), распакуйте и назовите полученную папку **play-scout-fix**. Положите её на Рабочий стол. Внутри должны сразу находиться `package.json`, `server.js`, папки `lib`, `public`, а не ещё одна папка с проектом.

Рабочая папка из вашей диагностики: `/Users/yu/Desktop/play-scout-v31`. Следующая команда проверит новую версию, сделает резервную копию `data` и `.env`, затем скопирует исправленные файлы поверх программы. `ditto` объединяет папки; файлы данных, которых нет в архиве, сохраняются.

Вставьте блок целиком:

```sh
(
  set -e
  cd "$HOME/Desktop/play-scout-v31"
  PLAY_SCOUT_FIX="$HOME/Desktop/play-scout-fix"
  PLAY_SCOUT_BACKUP="$HOME/Desktop/play-scout-backup-$(date +%Y%m%d-%H%M%S)"
  test -f package.json
  test -f data/state.json
  node -e 'const p=require(process.argv[1]); if(p.name!=="play-finance-finder" || p.version.localeCompare("3.1.1","en",{numeric:true})<0) throw Error("Нужен архив Play Scout 3.1.1 или новее")' "$PLAY_SCOUT_FIX/package.json"
  mkdir "$PLAY_SCOUT_BACKUP"
  ditto data "$PLAY_SCOUT_BACKUP/data"
  if [ -f .env ]; then cp -p .env "$PLAY_SCOUT_BACKUP/.env"; fi
  ditto "$PLAY_SCOUT_FIX" "$PWD"
  printf 'Резервная копия: %s\n' "$PLAY_SCOUT_BACKUP"
  npm ci
  npm run doctor
  npm start
)
```

Ожидаемая версия в диагностике: **Play Scout 3.1.1 или новее**. Число приложений и кандидатов должно соответствовать вашей сохранённой истории. Ключи повторно вводить не нужно, если `.env` уже был в рабочей папке.

## 3. Открыть CRM

После строки `Play Finance Finder: port 3000` откройте **http://127.0.0.1:3000/crm**. Терминал оставьте открытым. Обновите старую вкладку через Command + R.

Если страница по-прежнему недоступна, в новом окне Терминала выполните и пришлите текст ответа:

```sh
curl --noproxy '*' --max-time 5 http://127.0.0.1:3000/api/health
```

Ожидается JSON с `"status":"ok"` и версией `3.1.1` или новее.
