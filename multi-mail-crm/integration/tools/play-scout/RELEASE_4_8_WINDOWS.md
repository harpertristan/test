# Play Scout 4.8.0 — Windows / NVIDIA

Объединение дублей, выбор источников по категориям, проверка доступа, уточнение условий счёта и подключение Apify.
[Подробности](RELEASE_4_8.md).

Остановите приложение через Ctrl + C. Откройте PowerShell:

```powershell
cd "$env:USERPROFILE\PlayScout"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-windows.ps1 -Target (Get-Location).Path
if ($LASTEXITCODE -ne 0) { throw 'Обновление не завершено.' }
npm.cmd run doctor -- --storage
if ($LASTEXITCODE -ne 0) { throw 'Проверка хранилища не пройдена. Сохраните всю папку data.' }
npm.cmd run start:manual
```

Для другой рабочей папки измените первую строку. Дождитесь
**«Готово: Play Scout 4.8.0»**. Ключи, полная история с журналом, записи в работе,
комментарии, очередь, модели, настройки GPU и расписания сохраняются.
Очистка базы не запускается; updater делает резервную копию `data` и `.env`.

Для прерванного прохода используйте **«Продолжить проверку»**.
При новой ошибке сохраните её код и вывод `npm.cmd run doctor -- --storage`.
Не удаляйте журнал / блокировку и не присылайте ключи или `.env`.

Штатная остановка — Ctrl + C или `3-Stop.cmd`. Последующий ручной запуск —
`npm.cmd run start:manual` из рабочей папки.

Подключение Facebook / LinkedIn через Apify после обновления: [SOCIAL_CONNECTIONS.md](SOCIAL_CONNECTIONS.md). Ключ и задачи вводятся локально; без настройки платный сбор не запускается.
