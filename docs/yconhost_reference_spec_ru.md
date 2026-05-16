# Эталонное ТЗ yconhost

Статус: черновик для согласования. Документ объединяет требования из истории обсуждения, текущие принятые возможности проекта и отложенную архитектуру карточек через backend `@xterm/headless`.

## 1. Назначение

yconhost - локальное single-user web-приложение для управления консольными процессами на текущем хосте.

Приложение предоставляет:

- интерактивный терминал в браузере;
- проектные группы процессов на основе `mywins.json` / `my_wins.json`;
- сохранение определений консолей и логов вывода;
- HTTP API и минимальный HTTP MCP API для автоматизации;
- в перспективе - карточки сообщений/ошибок, извлеченные из отрендеренного состояния терминала.

Приложение предназначено для локальной разработки, где нужно запускать, смотреть, перезапускать, останавливать и анализировать много консольных процессов из одного UI.

Аутентификация, пользователи и multi-user isolation не требуются.

## 2. Исторические решения

### 2.1 Отказ от native Windows console окон

Изначально рассматривалась идея, что основной истиной для каждой консоли будет реальное native Windows console окно (`conhost.exe`), а yconhost будет управлять им через managed/manual mode.

Это направление было исследовано и отклонено:

- безопасный вариант одновременной vanilla console и pipe streaming/input не найден;
- эксперименты с `cmd_mitm_hack.exe` / подменой `conhost.exe` признаны слишком хрупкими и рискованными;
- глобальные hooks и потенциально опасные для всей машины варианты явно исключены;
- эмуляция vanilla окна бессмысленна, потому что vanilla окно было нужно только как способ сохранить поведение, которое pipe режим мог бы ломать.

Целевая архитектура: только pipe-only.

### 2.2 Текущий pipe-only baseline

yconhost управляет процессами через `node-pty` / ConPTY на Windows.

Терминал в браузере отображается через xterm.js. yconhost не создает и не управляет отдельными native Windows console окнами.

Re-attach к уже работающим child-процессам после рестарта yconhost не требуется. Вместо этого после рестарта пересоздаются сохраненные определения консолей.

## 3. Принятые возможности, которые нужно сохранить

### 3.1 Жизненный цикл консоли

Система должна поддерживать:

- создание отдельной консоли;
- получение списка консолей;
- выбор консоли;
- перезапуск консоли;
- остановку/закрытие консоли вместе с process tree;
- отправку обычного текстового ввода;
- отправку специальных команд, включая `Ctrl+C` и `Ctrl+Break`;
- чтение tail или полного вывода консоли;
- отображение PID в деталях консоли.

Завершение процесса должно работать со всей process tree, а не только с root PID.

### 3.2 Создание консолей в UI

В шапке sidebar должны быть три элемента создания:

- `+`: сразу создает default `cmd.exe` консоль в текущей рабочей папке yconhost.
- кнопка folder/open: открывает диалог только с полем рабочей папки.
  - Если в папке есть `mywins.json` или `my_wins.json`, папка открывается как проект.
  - Если такого файла нет, создается `cmd.exe` консоль с указанной рабочей папкой.
- burger menu:
  - содержит advanced пункт `Create...`;
  - advanced create позволяет выбрать `cmd.exe`, `powershell.exe` или `Other...`;
  - ручной ввод пути к executable показывается только при выборе `Other...`;
  - advanced create поддерживает поля command и working directory.

### 3.3 Детали консоли

Правая панель деталей консоли показывает:

- inline-редактируемое имя консоли в заголовке деталей;
- рабочую папку;
- PID;
- `Mark read`;
- `Ctrl+C`;
- `Restart`;
- `Close`;
- xterm.js терминал.

Переименование консоли выполняется только в правой панели деталей. Список консолей слева используется только для переключения и закрытия консолей.

Имя консоли должно сохраняться и переживать рестарт yconhost.

### 3.4 Список консолей в sidebar

Sidebar группирует консоли по проектам.

Группа `Default` существует всегда.

Строка консоли показывает:

- индикатор статуса;
- имя консоли;
- badge с количеством непрочитанных ошибок;
- кнопку закрытия.

Клик по строке выбирает консоль.

### 3.5 Проекты

Открытие проекта:

- проект - это папка с `mywins.json` или `my_wins.json`;
- конфиг содержит `wins`;
- элементы с `no_run` пропускаются;
- каждый win создает одну консоль;
- `project` консоли - basename папки проекта;
- `cwd` может быть корнем проекта или подпапкой относительно проекта;
- команда может быть задана через `cmd` или `command`.

Защита от повторного открытия:

- повторное открытие того же project path не должно создавать второй комплект консолей;
- для миграционной совместимости уже открытый project name тоже считается дубликатом, если у старых записей нет `projectPath`.

Действия над проектом:

- закрыть проект;
- перезапустить все консоли;
- остановить все консоли;
- запустить все консоли;
- отметить все как прочитанные.

Действия проекта доступны через burger menu рядом с заголовком проекта.

### 3.6 Последние проекты

В диалоге folder/open под `Working directory` отображается список последних проектов.

Поведение:

- список хранится в файле внутри data directory yconhost;
- открытие проекта обновляет список;
- ввод в `Working directory` фильтрует recent projects по подстроке в имени или пути;
- пример: ввод `book` должен находить `books_lib`;
- у каждой строки recent project есть burger menu с пунктом `Close`;
- `Close` удаляет recent entry и закрывает проект, если он сейчас открыт.

### 3.7 Сохранение состояния

Сохраняемые данные:

- определения консолей;
- список последних проектов;
- логи вывода.

Определения консолей пересоздаются после рестарта yconhost. Это не re-attach к старым процессам.

Логи вывода хранятся в `data/logs`.

Требования к логам:

- настраиваемый максимальный размер;
- настраиваемая ротация;
- настраиваемое ограничение in-memory scrollback.

### 3.8 Поведение терминала

Терминал в браузере:

- xterm.js;
- live output через WebSocket;
- polling-only live mode недостаточен;
- input должен проходить без разрушающей нормализации;
- paste, unicode, arrows, home/end, page up/down, tab и multiline input должны работать так, как это обычно поддерживают xterm/node-pty.

PTY environment:

- сессии должны объявлять цветной terminal state;
- `TERM=xterm-256color`;
- truecolor/color env hints: `COLORTERM=truecolor`, `FORCE_COLOR=1`, `CLICOLOR=1`, `CLICOLOR_FORCE=1`;
- `NO_COLOR` удаляется из env child-процесса, если это решение не будет пересмотрено.

### 3.9 Базовое отслеживание ошибок

Текущий простой server-side tracker:

- сканирует raw PTY chunks;
- ищет plain text `error` / `errors`;
- исключает `no errors`;
- исключает `errors 0`;
- опционально учитывает красный/бордовый ANSI output;
- может отключать ANSI parser для отдельной консоли;
- увеличивает unread error count;
- хранит строки, которые сработали, для debug mode.

`Mark read` сбрасывает unread counters.

Этот tracker полезен, но не является целевым источником rich cards.

### 3.10 Debug mode

Глобальный burger содержит переключатель debug mode.

Текущий debug mode показывает строки, найденные raw parser, в деталях консоли.

Это диагностическая возможность. В будущем она может быть заменена карточками на основе backend `@xterm/headless`.

### 3.11 API

Обязательный HTTP API:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/recent-projects`
- `DELETE /api/recent-projects`
- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/name`
- `POST /api/consoles/:id/read`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `DELETE /api/consoles/:id`
- `POST /api/projects/:project/restart`
- `POST /api/projects/:project/stop`
- `POST /api/projects/:project/start`
- `POST /api/projects/:project/read`
- `DELETE /api/projects/:project`
- `POST /mcp`

Минимальный HTTP MCP API:

- список консолей;
- чтение вывода консоли;
- запись ввода в консоль.

## 4. Целевая архитектура с backend headless xterm

Если rich message/error cards становятся ключевой фичей, целевая архитектура должна использовать backend headless xterm вместо собственного ANSI parser.

Использовать:

- `@xterm/xterm` в браузере;
- `@xterm/headless` на backend;
- версии желательно держать согласованными.

Архитектура:

```text
node-pty session
  -> raw log store
  -> browser xterm.js over WebSocket
  -> backend @xterm/headless mirror
       -> normal buffer scan
       -> alternate screen detection
       -> persistent/temporary cards
       -> unread counters
```

Backend headless terminal является canonical source для extracted cards и в перспективе для unread counters.

Browser xterm остается интерактивным UI renderer.

## 5. Требования к headless mirror

Каждая managed console владеет одним backend terminal mirror.

На каждый PTY output:

```ts
mirror.write(chunk);
logStore.append(chunk);
websocketBroadcast(chunk);
```

Mirror должен давать состояние для scan:

- `buffer.normal`;
- `buffer.active`;
- `buffer.alternate`;
- `onWriteParsed`;
- `rows`;
- `cols`;
- `baseY`.

Resize:

- браузер отправляет resize events через WebSocket;
- сервер resize'ит и PTY, и headless mirror;
- если несколько клиентов смотрят одну консоль с разными размерами, используется canonical size, изначально last active client size;
- fallback size: `120x40`.

Extractor должен терпеть различия wrapping между browser xterm и backend mirror.

## 6. Extracted cards

Карточки - это не только ошибки. Это извлеченные значимые сообщения терминала.

Предлагаемый тип:

```ts
type ExtractedCard = {
  id: string;
  kind: "persistent" | "temporary";
  category: "error" | "warning" | "info" | "message";
  title: string;
  message: string;
  rawText: string;
  hash: string;
  createdAt: number;
  bufferY?: number;
};
```

### 6.1 Persistent cards

Persistent cards извлекаются из finalized normal scrollback:

```ts
const buffer = mirror.buffer.normal;
const start = lastScannedFinalY;
const end = buffer.baseY;
```

Правила:

- сканировать только новые finalized lines;
- карточки остаются, даже если терминал позже очистил scrollback;
- dedup по hash;
- хранить в server memory или persist - отдельное product decision.

### 6.2 Temporary cards

Temporary cards извлекаются из текущего visible normal screen:

```ts
const buffer = mirror.buffer.normal;
const start = buffer.baseY;
const end = buffer.baseY + mirror.rows;
```

Правила:

- если активен alternate buffer, temporary cards очищаются, extraction пропускается;
- temporary cards пересобираются на каждом throttled scan;
- temporary cards скрываются, если уже есть такой persistent card.

### 6.3 Extraction rules

Extractor работает по blocks, а не только по отдельным строкам.

Начальная группировка:

- split rendered buffer text по `\n`;
- пустая строка закрывает текущее сообщение;
- stack trace строки вида `    at ...` присоединяются к предыдущему сообщению;
- известные continuation lines присоединяются к предыдущему сообщению;
- block классифицируется как `error`, `warning`, `info` или `message`.

Deduplication:

```ts
hash = `${category}:${normalize(rawText)}`;
```

Normalization:

- trim;
- collapse repeated whitespace;
- позже можно нормализовать timestamps и absolute paths.

### 6.4 UI карточек

Панель карточек:

- вне xterm;
- без overlay;
- collapsible;
- предпочтительно над xterm и под toolbar;
- max height и собственный scroll;
- показывает counts и categories;
- не должна мешать пользоваться xterm.

Текущий debug panel должен быть заменен или переработан в эту панель.

### 6.5 Click to scroll

Это опциональная фаза 2.

Backend `bufferY` - только приблизительная подсказка, потому что browser xterm может иметь другой width и wrapping.

Надежный click-to-scroll требует client-side markers/decorations для строк, которые браузер наблюдал live, или восстановления/сериализации terminal state.

Позже можно рассмотреть `@xterm/addon-serialize`, если точное восстановление состояния станет важным.

## 7. Data model

### 7.1 Console definition

Обязательные поля:

- `id`;
- `name`;
- `project`;
- `projectPath?`;
- `cwd`;
- `command`;
- `shell`;
- `args`;
- `ansiParserEnabled` или replacement tracker config;
- timestamps created/updated.

### 7.2 Runtime console state

Обязательные поля:

- console definition;
- PID;
- status: `starting`, `running`, `ready`, `exited`;
- exit code;
- PTY session;
- backend headless mirror;
- tail buffer;
- persistent cards;
- temporary cards;
- unread counts.

### 7.3 Project

Идентичность проекта должна опираться на normalized absolute `projectPath`.

Project name - display name и migration fallback, а не идеальная stable identity.

## 8. Configuration

Settings должны поддерживать:

- host;
- port;
- data directory;
- default shell;
- log max bytes;
- log rotation count;
- scrollback bytes;
- tracker/extractor throttle;
- backend mirror default cols/rows;
- backend mirror scrollback size.

## 9. Требования к тестированию

Backend:

- endpoint tests;
- console lifecycle tests;
- project duplicate-open tests;
- recent project persistence tests;
- project group action tests;
- headless mirror extraction tests;
- card grouping/dedup tests;
- resize handling tests.

Frontend:

- Chrome MCP smoke tests;
- creation controls;
- recent project filtering;
- project burger actions;
- console details rename;
- close buttons;
- mark read;
- cards panel не overlay'ит xterm.

Acceptance scenario:

- использовать `D:\b\Mine\GIT_Work\books_lib`;
- не изменять этот проект;
- проверить защиту от повторного открытия;
- проверить project actions;
- проверить, что UI остается usable.

## 10. Non-goals

- управление native Windows console windows;
- vanilla/manual mode;
- подмена conhost;
- global hooks;
- multi-user auth;
- remote-host security model;
- гарантированный re-attach к child-процессам после рестарта yconhost.

## 11. Оценка rewrite

Текущая кодовая база полезна как prototype и уже реализует много product features, но архитектура headless-xterm cards меняет центральную модель:

- output tracking переезжает с raw chunk regexes на rendered terminal buffer state;
- resize становится first-class серверной обязанностью;
- unread counters должны в перспективе вычисляться из extracted cards;
- debug/error UI должен быть переосмыслен как cards panel, а не как patch поверх текущего debug mode.

Это не маленький refactor. Изменения затрагивают runtime ownership консоли, WebSocket protocol, data model, tracker implementation, UI layout и tests.

Рекомендуемое решение:

- Если цель - только улучшать process/project controls, лучше продолжать небольшими доработками.
- Если rich cards на основе terminal-rendered state становятся core feature, rewrite по этому ТЗ оправдан.

Предпочтительный rewrite-подход:

1. Согласовать и заморозить этот документ как product spec.
2. Оставить текущий repo как behavioral reference и regression oracle.
3. Создать новую implementation branch или новый clean project directory.
4. С первого дня строить backend runtime вокруг `node-pty` + `@xterm/headless`.
5. Добавлять tests по фичам до восстановления полного UI.
6. Переносить только принятые возможности из этого документа.

Не переносить native vanilla-console code или conhost experiments.
