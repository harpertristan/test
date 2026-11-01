# Play Scout 4.6.1 — Windows / 32 ГБ RAM / NVIDIA 8 ГБ

[Что исправлено](RELEASE_4_6_1.md). Удалён старый парсер Google Play, выполнявший
код из ответа сайта; новый читает только данные. Установка не выполняет
установочные скрипты зависимостей. Профили GPU и модель не меняются.

## Обновление в существующей папке

Остановите Play Scout через Ctrl + C в его окне. Откройте PowerShell:

```powershell
cd "$env:USERPROFILE\PlayScout"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-windows.ps1 -Target (Get-Location).Path
```

Используется updater из существующей версии 4.6.0; он скачивает новый исходный
код, а установку выполняет уже обновлённый модуль с `npm ci --ignore-scripts`.
`-ExecutionPolicy Bypass` действует только для этого процесса PowerShell и не
отключает антивирус Windows. Если установленного updater нет, используйте
[INSTALL_WINDOWS.md](INSTALL_WINDOWS.md). Существующие `.env` и `data` сохраните.

Здесь нет `-Start`: приложение не запускается автоматически. Updater создаёт
резервную копию и сохраняет историю, очередь, ключи, комментарии, исключения и
выбранный ИИ. Дождитесь «Готово: Play Scout 4.6.1».

## Обычный запуск

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd run start:desktop
```

Используйте `.cmd` на Windows; `.command` предназначены для Mac. Установка —
`1-Install.cmd`, запуск — `2-Start.cmd`, остановка — `3-Stop.cmd`. Файлы `.cmd`
сохраняют ASCII и CRLF.

Для NVIDIA 8 ГБ сохранён [профиль llama.cpp](GPU_AGENT.md#windows-одна-карта),
для шести RTX 2060 Super — [GPU-пул](GPU_AGENT.md#ферма-шесть-rtx-2060-super-в-одном-компьютере).
Гибрид GPT + Ollama использует общую очередь; облачная часть может быть платной.
Запуск не сбрасывает базу и не отправляет успешно завершённые проверки заново.
