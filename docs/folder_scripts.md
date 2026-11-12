# Папки и серверные JS-источники

## New: новая сессия Codex

В меню папки `codexes` есть отдельный пункт `New...`: достаточно указать `Name`
и существующий абсолютный `Working directory`. Старый `Add console...` остаётся
для регистрации существующих контекстов, включая известный `session_id`.

New запускает короткоживущий скрытый `ycodex app-server` с тем же окружением,
что и терминалы (включая актуальный Windows PATH и YCODEX_HOME). Через
`thread/start`, `thread/archive`, `thread/unarchive`, `thread/name/set` и
`thread/read` создаётся и проверяется настоящая сохранённая пустая сессия.
Запрос к модели (`turn/start`) не отправляется. Никаких самодельных rollout-файлов.
После операции вспомогательный процесс и его дочерние процессы завершаются.
В Markdown добавляется новый раздел с обычным `pinned_text` и командой:

```cmd
cd /d "TAB_FOLDER" && title TAB_NAME && codex resume SESSION_ID --dangerously-bypass-approvals-and-sandbox --bypass-safety-y
```

При чтении источника `codex` нормализуется в `ycodex`, как у существующих записей.
Это сохраняет совместимость с локальным форком и его home. Консоль остаётся
idle: TUI запускается только по `Start`. Флаги отключения ограничений добавляются
по явно заданному пользователем шаблону. `Add console...` также всегда добавляет
оба флага `--dangerously-bypass-approvals-and-sandbox --bypass-safety-y`,
независимо от наличия resume ID; существующие команды из источника не меняются.
Имя не допускает cmd-метасимволы
`& | < > % " ! ^`, путь — кавычки, переводы строк и `% ! ^`; пробелы и `&` в
пути поддерживаются. Дубликаты, в том числе DELETED-разделы с тем же именем,
проверяются до создания сессии. Если Markdown изменился во время подготовки,
чужие изменения не затираются; ошибка возвращает уже выделенный session ID
для ручного восстановления через Add console.

На уровне платформы это необязательная возможность любой scripted-папки:

```js
export function defineFields(context, { operation } = {}) {
  // operation: create, update или new. Старые одноаргументные функции совместимы.
  return operation === "new"
    ? [{ name: "name", label: "Name", type: "string", required: true }]
    : [{ name: "name", label: "Name", type: "string" }];
}
async function newEntry(context, values) { /* allocate resource and write source */ }
export { newEntry as new };
```

Экспорт `new` включает `capabilities.new` и пункт `New...`; наличие `create`
для этого не требуется. После успеха вызывается `list`, процессы слотов не
запускаются. У New лимит worker 60 секунд (обычные операции — 10 секунд),
у подготовки Codex — 25 секунд плюс завершение процесса.

HTTP: `GET /api/projects/:project/fields?operation=new`, затем
`POST /api/projects/:project/new` с `{ "values": { "name": "...", "cwd": "..." } }`.
MCP: `get_folder_fields(project, operation="new")`, затем
`new_folder_entry(project, values)`. В manual/my_wins New не поддерживается;
существующий create/API не меняет семантику. Сгенерированный codexes-wrapper
обновляется при старте, пользовательские JS не переписываются.

Проверено 2026-11-11: typecheck, production build, 133 теста (21 файл),
создание настоящей сессии установленным ycodex и resume из другого процесса
на изолированном home; UI New, авто-выбор idle-слота, дубликат и сброс полей,
desktop/mobile. На `4011` обновлён только HTTP-процесс через PM2: семь работавших
консолей сохранили PID, terminal host не перезапускался. Реальный Markdown
не пополнялся тестовыми записями; UI-создание проверялось на отдельном источнике
и отдельном Codex home. Вспомогательный PM2-процесс удалён после проверки.

## Ошибки источников и MCP

Ошибка `list` отображается текстом под заголовком папки, в том числе когда папка
свёрнута. Сообщение о дубликате содержит конфликтующее имя либо ключ и оба имени.
Последний корректный список сохраняется; после исправления источника успешный
`list` (периодический или ручной) убирает ошибку. В codexes дубли проверяются
до удаления повторяющихся команд, чтобы они не маскировались дедубликацией.

В MCP операции `create_folder_entry`, `update_folder_entry`, `delete_folder_entry`
для `my_wins` требуют `confirmSourceWrite: true`. Без него возвращается ошибка
с точным путём к файлу и предупреждением: операция изменяет источник; предпочтительно
отредактировать файл напрямую и вызвать `reload_project_config`. Для удаления
по-прежнему требуется также `confirmed: true`. `get_folder_fields` возвращает
`sourceWriteWarning`. Для manual/scripted этот дополнительный флаг не требуется.
UI использует собственные диалоги и не требует MCP-флага.

`create_console`/`register_console` не добавляют временные записи в `my_wins`.
MCP `create_console`/`register_console` без `project` автоматически используют
manual-папку `AGENTS_TEMP`: предпочтительно для разовых запросов агентов.
Папка создаётся при первом обращении; явно указанный проект имеет приоритет.
Временность и TTL сохраняются, `persistent: true` отключает автоудаление.
HTTP API и UI без проекта по-прежнему используют `Default`.
Рабочая директория консоли может оставаться директорией исходного проекта.

При первом чтении старых данных тип `my_wins` определяется по происхождению
batch-слотов, а не просто по наличию `projectPath` или файла в рабочей директории.
Явно сохранённый тип имеет приоритет; повторное чтение реестра не заменяет
выведенный тип на manual. Синхронизация файловой папки удаляет отсутствующие
остановленные слоты и лишние дубли; работающие отсутствующие слоты остаются orphaned.

Реализация универсальных папок: `manual`, `my_wins`, `scripted`. Старый
`import_codex_contexts` и `/api/codex-contexts/import` удалены. Обновление источника
вызывает экспорт **`list`**, не `refresh`. Общий клиентский polling не вызывает JS.

## Контракт

Одна scripted-папка соответствует одному локальному JS-модулю. В Settings задаются
абсолютный путь к модулю и интервал в секундах. `0` означает только ручное обновление
и обновление после CRUD. Обязателен `list(context)`, остальные функции необязательны.
Рекомендуемый формат файла — ESM `.mjs`.

```js
export function list(context) {
  return [{
    key: "stable-source-key",
    name: "Build",
    command: "npm run build",
    cwd: "D:/work/project",
    background: "STD_GREEN",
    values: { name: "Build", description: "", background: "STD_GREEN" }
  }];
}

export function defineFields(context) {
  return [
    { name: "name", label: "Name", type: "string", required: true },
    { name: "description", label: "Description", type: "string" },
    { name: "pinned_text", label: "pinned_text", type: "string", multiline: true },
    { name: "background", label: "Background", type: "color" }
  ];
}

export function getVariables(context, entry) {
  return { work_dir: entry.cwd, folder_name: context.folder.name };
}

export async function create(context, values) { /* write source */ }
export async function update(context, original, values) {
  // Write source; when the source key changes, return its new value.
  return { key: "new-source-key" };
}
async function remove(context, original) { /* disable/delete source entry */ }
export { remove as delete };
```

`pinned_text` возвращается также на верхнем уровне элемента `list` и в его
`values` для редактирования. `getVariables` необязателен и возвращает словарь
строк для подстановок `{{name}}`; `multiline: true` у строкового поля включает
textarea в диалоге. Формат хранения, ограничения и пример Codex описаны
в [pinned_text.md](pinned_text.md).

`context` содержит `folder: { id, name }` и `dataDir`. `original` содержит исходные
`key`, `name` и `values` записи. `values` — словарь строк. Без `defineFields` форма
содержит только `name` и `description`. Поддерживаются типы `string` и `color`.
Успешный create/update/delete перечитывает источник через `list`.

`key` и `name` должны быть непустыми; только `key` обязан быть уникальным внутри
выдачи одной папки. В разных папках одинаковые имена и ключи разрешены.
Политику повторяющихся имён определяет JS-источник, не платформа: Codex
выдаёт ошибку при дублировании имени/сессии, PM2 разрешает одинаковые имена
с разными PM2 ID и сохраняет оба процесса. В подсказке PM2-записи указан её ID.
Ошибки показываются отдельным блоком под заголовком своей группы, в том числе
в компактном режиме, без наложения на другие группы. Внутренний ID
yconhost отличается от изменяемого ключа источника. При смене ключа через update
возвращать `{ key }`, чтобы сохранить консоль, историю и процесс. Миграция старых
слотов сопоставляет их по прежнему имени. Внешняя одновременная смена всех ключей
не распознаётся как переименование.

Форма существующей записи также возвращает `revision`. UI отправляет его при
изменении вместе с `{ values, revision }`; MCP-клиентам рекомендуется делать так же.
Это защищает от перезаписи чужих правок, даже если периодический list уже обновил
серверный кэш после открытия формы. Сам скрипт дополнительно проверяет актуальность
исходного раздела перед записью.

Скрипт выполняется в worker с лимитом времени 10 секунд и результата 10 MB; до
10000 элементов, до 64 полей формы. Операции одной папки последовательны. Ручной
List source перезагружает модуль. Периодические вызовы используют загруженный JS.
Ошибка сохраняет последний успешный состав и видна у папки. Это доверенный Node.js,
а не защитная песочница: доступ к FS и запуску программ остаётся у скрипта.

Состав создаёт только idle-слоты. Изменение команды/cwd работающей консоли помечает
необходимость Restart, но не перезапускает её. Пропавший работающий элемент остаётся
`orphaned`; пропавший idle-слот убирается, логи не удаляются. Смена типа/пути источника
требует `confirmed=true` и пересоздаёт папку с прежним именем. Внешние файлы и чужие
процессы при пересоздании не удаляются.

## Цвет

Редактор `color` использует react-colorful в Ariakit Dialog. В нём STD-палитра,
произвольный HEX и сброс к Default. Apply меняет черновик формы; источник записывается
только её Save. Cancel/Escape отменяют выбор. STD-токены сохраняются без превращения
в RGB: например, STD_RED отображается как `(20,12,12)` в dark и `(255,247,247)` в light.

## Codex/Claude и PM2

При первом запуске миграция создаёт JS-файлы в `dataDir/folder-scripts` и регистрирует
папки. Старые `codexContexts` настройки читаются только для этой миграции; дальнейшая
конфигурация путей находится в созданном JS. Исходные Markdown/Lua не переписываются
при миграции. Маркер `folder-sources-v1.json` предотвращает повторное добавление
закрытой папки. Папки и их настройки хранятся в прежнем `managed-projects.json`.

Скрипт Codex/Claude возвращает поля name/description/session_id/cwd/background,
поддерживает `Color:` HEX/RGB/STD и обратимое удаление через `# DELETED ...`.
Имя и session_id редактируются отдельно. Конфликт внешнего изменения раздела
выдаёт ошибку; форма восстанавливает исходные значения. Lua-пресет при первом
изменении получает Markdown-переопределение; Lua остаётся неизменным.

Для чужих процессов скрипт возвращает `readonly: true`, `external` со статусом/PID
и экспортирует `readOutput(context, original, { tailLines })`. Ядро не создаёт
и не контролирует такие процессы. PM2 — такой источник; лог читается ограниченным
хвостом файлов, STDOUT/STDERR помечены отдельно. Его интервал по умолчанию 2 секунды,
у Codex/Claude — 60 секунд. Ошибка PM2 не блокирует другие папки и health.

## HTTP/MCP

- `POST /api/projects`: name/type/scriptPath/projectPath/intervalSeconds/defaults.
- `GET|PUT /api/projects/:project/settings`: настройки; confirmed при пересоздании.
- `POST /api/projects/:project/list`: перечитать JS и вызвать list.
- `GET /api/projects/:project/fields`: форма новой записи.
- `POST /api/projects/:project/entries`: `{ values }`.
- `GET|PUT /api/consoles/:id/entry`: форма/изменение `{ values }`.
- `DELETE /api/consoles/:id/entry`: `{ confirmed: true }`.

Прежние специализированные CRUD-пути `/mywins` удалены, чтобы не обходить
единые проверки формы, конфликтов и подтверждения удаления.

MCP: `create_project`, `get_folder_settings`, `update_folder_settings`, `list_folder`,
`get_folder_fields`, `create_folder_entry`, `update_folder_entry`, `delete_folder_entry`.
Старые команды запуска/ввода и ожидания выполнения остаются для owned-консолей.
`create_console`/`register_console` предназначены только для manual-папок и сохраняют
временность по умолчанию. Источники меняются только через их CRUD-операции.

Проверка внедрения выполняется на отдельном dataDir и порту; остановка живого сервиса
не является частью автоматической проверки.

## Проверка 2026-11-05: AGENTS_TEMP

MCP-инструменты создания консоли теперь используют `AGENTS_TEMP`, если `project`
не передан. `register_console` больше не требует `project` в схеме; значение
по умолчанию и краткая рекомендация для разовых запросов указаны в MCP.
Существующие консоли не переносятся, явный проект и `persistent` сохраняют смысл.

Пройдены typecheck, 44 API/folder-теста и сборка TypeScript в отдельный каталог
`data/agents-temp-verification/dist`. Проверены оба инструмента без проекта,
явный проект, ручной тип новой папки, очистка по TTL, схема MCP и неизменность
HTTP-default `Default`. Первичная проверка не меняла рабочий `dist`, поскольку
на момент проверки работали четыре пользовательские консоли.

После явного разрешения пользователя выполнены `pnpm build` и перезапуск
продуктивного `yconhost` через PM2 на `4011`. Резервная копия:
`data/deploy-backups/20261105-075335`. Проверены health, MCP-схемы и описание;
`register_console` без проекта создал idle-слот в `AGENTS_TEMP` с `persistent=false`.
Тестовый слот удалён, папка остаётся доступной. Ошибок источников нет,
пользовательские процессы автоматически не запускались. Итоговый список PM2 сохранён.

## Проверка 2026-11-02

- Пройдены typecheck, 73 теста и production-сборка в отдельный каталог.
- Пройдены Windows-тесты ConPTY и native CLI, включая освобождение процессов.
- Playwright: 1440x1000 dark и 390x844 light; выбор STD, сохранение токена в Markdown,
  отмена/Escape с возвратом фокуса, ошибка имени+session_id со сбросом исходных полей.
- Вложенные диалоги не перекрыты фоном, на mobile нет горизонтального переполнения.
- Реальный PM2 проверен через scripted-папку с произвольным именем; доступны только
  чтение статуса/вывода и настройки источника, без управления чужими процессами.
- Проверочный сервер запускается через PM2 командой ниже. Его owned-терминалы
  используют FakeTerminalFactory: это стенд форм/API, не место запуска рабочих команд.

```powershell
pnpm exec tsc -p tsconfig.json --outDir data/folder-verification/dist
pnpm exec vite build --outDir data/folder-verification/dist/client
pm2 start scripts/verify-folders-server.mjs --name yconhost-folders-check
```

URL стенда: http://127.0.0.1:4021/. Рабочие dist, settings.json5, data и процесс
сервиса на 4011 при проверке не заменяются. Внедрение в него требует отдельного
перезапуска; действующие консоли при таком перезапуске остановятся.
