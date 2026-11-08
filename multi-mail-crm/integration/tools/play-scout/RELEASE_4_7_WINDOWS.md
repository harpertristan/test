# Play Scout 4.7.0 — Windows / NVIDIA

Те же исправления хранения и остановки, что на Mac.
[Подробности](RELEASE_4_7.md).

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
**«Готово: Play Scout 4.7.0»**. Ключи, полная история с журналом, записи в работе,
комментарии, очередь, модели, настройки GPU и расписания сохраняются.
Очистка базы не запускается; updater делает резервную копию `data` и `.env`.

Для прерванного прохода используйте **«Продолжить проверку»**.
При новой ошибке сохраните её код и вывод `npm.cmd run doctor -- --storage`.
Не удаляйте журнал / блокировку и не присылайте ключи или `.env`.

Штатная остановка — Ctrl + C или `3-Stop.cmd`. Последующий ручной запуск —
`npm.cmd run start:manual` из рабочей папки.
