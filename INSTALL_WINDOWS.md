# Play Scout 4.4.0 — установка Windows с нуля

Для вашего компьютера: Windows 10/11 x64, 32 ГБ оперативной памяти и NVIDIA с 8 ГБ видеопамяти. Рабочая папка: **`C:\Users\ivano\PlayScout`**. В командах `$env:USERPROFILE` автоматически подставит папку вашего пользователя. Установка от имени администратора для самой программы не нужна.

## 1. Установить Node.js

Откройте **https://nodejs.org/**, скачайте Windows Installer **LTS, x64**, установите с обычными параметрами. Программа поддерживает Node.js 22 и новее; для начала подойдёт актуальная LTS. После установки закройте прежние окна PowerShell и откройте новое: «Пуск» → PowerShell.

Проверьте:

```powershell
node --version
npm.cmd --version
```

Обе команды должны показать номер версии. Если `node` не найден, перезапустите PowerShell после установки Node.js. Устанавливать дополнительные Windows Build Tools для обычного запуска Play Scout не требуется.

## 2. Скачать программу в правильную папку

Это блок **новой установки**: он остановится, если папка `PlayScout` уже существует. Установленную копию обновляйте через **[инструкцию обновления](RELEASE_4_4_WINDOWS.md)**, сохраняя ключи и базу. Для отдельной чистой копии можно заменить `'PlayScout'` в первой переменной на `'PlayScout-new'` и использовать это имя во всех следующих командах.

В новом PowerShell вставьте **весь блок**:

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $PlayScoutFolder = Join-Path $env:USERPROFILE 'PlayScout'
  if (Test-Path -LiteralPath $PlayScoutFolder) { throw 'PlayScout folder already exists. Use 10-Update.cmd or choose another folder name.' }
  $PlayScoutTemp = Join-Path $env:TEMP ('play-scout-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $PlayScoutTemp | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $PlayScoutZip = Join-Path $PlayScoutTemp 'play-scout.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/harpertristan/test/archive/refs/heads/main.zip' -OutFile $PlayScoutZip -TimeoutSec 120
    Expand-Archive -LiteralPath $PlayScoutZip -DestinationPath $PlayScoutTemp
    $PlayScoutExtracted = Join-Path $PlayScoutTemp 'test-main'
    if (-not (Test-Path -LiteralPath (Join-Path $PlayScoutExtracted 'package.json'))) { throw 'The downloaded archive does not contain Play Scout.' }
    Move-Item -LiteralPath $PlayScoutExtracted -Destination $PlayScoutFolder
  } finally {
    Set-Location $env:USERPROFILE
    if (Test-Path -LiteralPath $PlayScoutTemp) { Remove-Item -LiteralPath $PlayScoutTemp -Recurse -Force }
  }
  Set-Location $PlayScoutFolder
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Read the error above.' }
  npm.cmd run doctor
  if ($LASTEXITCODE -ne 0) { throw 'Read the diagnostic output above.' }
}
```

После скачивания папка содержит `package.json`, `server.js`, `lib`, `public`, `scripts` и файлы `.cmd`. Диагностика должна показать **Play Scout 4.4.0 или новее**. Отсутствие ключа до следующего шага ожидаемо. История для новой установки не нужна.

Если папка скачана вручную: распакуйте ZIP, переименуйте **внутреннюю папку с `package.json`** в `PlayScout` и переместите её в `C:\Users\ivano`. Затем:

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd ci
npm.cmd run doctor
```

Команды выполняются в папке программы. В приглашении должно быть `PS C:\Users\ivano\PlayScout>`, а не `C:\Windows\System32>`.

## 3. Добавить ключ Brave для сайтов, публикаций и реестров

Получите ключ в **https://brave.com/search/api/**. Тариф и доступ к поиску проверяйте в кабинете Brave.

В PowerShell:

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd run configure
```

Когда появится приглашение, вставьте **только значение ключа** и нажмите Enter. Ввод скрыт. Программа сама создаст файл **`.env` в папке PlayScout**. Не создавайте `PlayScout-keys.env`: этот файл использовался только для переноса ключей с Mac. `.env` не присылайте в чат и не публикуйте.

Google Play использует отдельный механизм поиска; ключ Brave нужен веб-источникам и дополнительному поиску сведений о сайтах. Наличие ключа не означает, что тариф Brave уже активирован.

## 4. Выбрать ИИ

Для локального GPU-анализа OpenAI-ключ не требуется. Для вашей NVIDIA 8 ГБ начальный вариант — **llama.cpp + Qwen2.5-3B-Instruct Q4_K_M**, экономный режим, одна карточка одновременно. Память Windows 32 ГБ не заменяет видеопамять GPU.

### Локальный вариант без оплаты ИИ за запросы

1. Обновите драйвер NVIDIA. Команда `nvidia-smi` должна показать вашу карту.
2. С [официальных релизов llama.cpp](https://github.com/ggml-org/llama.cpp/releases) скачайте **Windows x64 CUDA-сборку** и библиотеки из того же релиза. Распакуйте в **`C:\AI\llama`**. Там должны находиться `llama-server.exe` и его DLL.
3. С [официальной страницы модели](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/tree/main) скачайте **полный GGUF Q4_K_M** в **`C:\AI\models\qwen2.5-3b-instruct-q4_k_m.gguf`**. Если веса опубликованы частями, скачайте все части и объедините `llama-gguf-split --merge` из той же сборки. Переименования одной части недостаточно.
4. Откройте отдельное окно PowerShell и выполните:

```powershell
cd "$env:USERPROFILE\PlayScout"
node .\scripts\start-gpu-agent.js --server "C:\AI\llama\llama-server.exe" --model "C:\AI\models\qwen2.5-3b-instruct-q4_k_m.gguf"
```

Оставьте окно открытым. Это сервер ИИ, он слушает `127.0.0.1:8081`. После запуска CRM в шаге 5 откройте её настройки → профиль **Windows · 32 ГБ RAM / NVIDIA 8 ГБ** → **«Применить профиль ИИ»** → **«Проверить локальный ИИ / все GPU»**. Проверьте, что выбран движок **llama.cpp**, alias **`qwen2.5-3b-instruct-q4_k_m`**, адрес **`http://127.0.0.1:8081`**, экономный режим. Сохраните настройки, разберите одну карточку. В журнале сервера должна отображаться загрузка слоёв на CUDA.

При ошибке локального ИИ платный API автоматически не включается. Точную скорость нужно измерить на вашей карте. Для сравнения 3B/7B, установки Metal на Mac и шести RTX 2060 Super — [GPU_AGENT.md](GPU_AGENT.md).

### Облачный вариант

Если выбираете OpenAI, создайте ключ в **https://platform.openai.com/api-keys**, настройте отдельный баланс API и выполните:

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd run configure:ai
```

Вставьте ключ в скрытое приглашение. В CRM затем выберите **OpenAI API**, экономный режим и сохраните настройки. Подписка ChatGPT не пополняет API.

Для Gemini — ключ **https://aistudio.google.com/apikey** и `npm.cmd run configure:gemini`; затем выберите Gemini в CRM. Бесплатная квота зависит от аккаунта и модели. Ключи Brave и ИИ различаются.

## 5. Запустить CRM

В новом окне PowerShell:

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd run start:desktop
```

Откройте **http://127.0.0.1:3000/crm**. Окно программы оставьте открытым. Если локальный ИИ используется, его окно из шага 4 тоже должно работать.

Обычный следующий запуск — двойной щелчок **`2-Start.cmd`** в папке PlayScout. Файлы `.command` относятся к Mac; в Windows используйте `.cmd` и PowerShell. Проводник может скрывать расширение: `2-Start` с типом «Сценарий Windows» — нужный файл.

## 6. Настроить первый поиск

1. В настройках CRM проверьте общую политику юрисдикций. Румыния, Словакия, Словения остаются в поиске; Китай / Гонконг / Макао, арабские юрисдикции, СНГ, Украина и Беларусь исключаются по сведениям о провайдере. Нигерия также исключена. Язык или страна магазина не заменяют сведения о компании.
2. Сохраните настройки источников и ИИ. Рекомендации Google Play оставьте включёнными. Ваши 39 ориентиров, включая BORDERPAY Business и Omexpay Business, будут доступны для повторной ручной проверки. В 4.4 сохраняется только защита записей «Уже в работе / был в работе». Оставьте «Поиск по вашим ориентирам» и рекомендации включёнными, чтобы искать другие похожие проекты. Чистые криптокошельки отсекаются при новом поиске; прежние сохранённые записи доступны для ручной перепроверки; криптопроекты с собственным предложением фиатного бизнес-счёта через партнёра проходят проверку.
3. Нажмите **«Выбрать источник поиска» → Google Play → «Искать только здесь»**. Находки попадут в общую CRM. Затем отдельно можно запустить сайты, Trustpilot, Finextra или реестры EMI / MiCA.
4. Для первой проверки откройте одну карточку и нажмите **«Разобрать этот сервис через ИИ»**. После проверки скорости используйте **«Разобрать найденное»** либо отметку «ИИ после сбора» у нужного источника.
5. «Впервые найденные» — проекты, которых не было в прежней базе и исключениях; это не обязательно недавно запущенные проекты. Восстановленные ориентиры сюда не попадают. «Проверено: подходит» переносит карточку в «Подтверждено мной». Сортировка по релизу / публикации доступна отдельно. Статус «Проверить вручную» и упоминание EUR / SEPA не подтверждают EU IBAN.
6. Для ежедневного наблюдения задайте время и включите расписание у конкретных источников. Компьютер и программа должны работать. Если видно предупреждение о прежних общих расписаниях, отключите их кнопкой перед переходом на отдельные.

## 7. Остановить, проверить или обновить

Остановка — **`3-Stop.cmd`**, либо в **новом** PowerShell:

```powershell
cd "$env:USERPROFILE\PlayScout"
npm.cmd run stop
```

Проверка сервера без запросов Google / Brave / ИИ:

```powershell
curl.exe --noproxy "*" --max-time 5 http://127.0.0.1:3000/api/health
```

Ожидается `"status":"ok"`, версия `4.4.0` или новее. Этот ответ проверяет приложение, а не доступность Google Play или ИИ.

Обновление — **`10-Update.cmd`**. Полная команда и сохранение базы: [RELEASE_4_4_WINDOWS.md](RELEASE_4_4_WINDOWS.md).

Если ключ добавлен после запуска, остановите CRM и запустите заново. Если модель не найдена, проверьте путь к полному GGUF и alias. Если Google временно ограничил выдачу, повторный запуск сотен запросов подряд не ускорит поиск: очередь и найденные карточки сохраняются. Не удаляйте `data` или `.env` для исправления сетевых ошибок.
