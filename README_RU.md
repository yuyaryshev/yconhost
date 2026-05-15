# yconhost

yconhost - локальный Web UI/API для управления консолями на хосте. Приложение сохраняет реальную консоль хоста как источник истины и предоставляет браузерный терминал, HTTP API, WebSocket streaming и небольшой HTTP MCP интерфейс для автоматизации.

## Основные возможности

- Создание, просмотр, перезапуск и остановка отдельных консолей.
- Пакетный запуск консолей проекта из `mywins.json` или `my_wins.json`.
- Live streaming вывода терминала через WebSocket.
- Отображение интерактивных терминалов в браузере через xterm.js.
- Отправка обычного текста и специальных команд, включая `Ctrl+C` и `Ctrl+Break`.
- Переключение между `managed` и `manual` режимами; в manual mode Web UI становится read-only для ввода.
- Сохранение истории вывода в `data/logs`.
- Ротация логов и ограниченный in-memory scrollback.
- Поиск ошибок по plain text и ANSI colored output.
- Возможность отключить ANSI parser для отдельной консоли.
- HTTP endpoints и минимальный HTTP MCP endpoint.
- Production-запуск через pm2.

## Команды

- `pnpm install` - установить зависимости.
- `pnpm test` - запустить тесты endpoint'ов и анализатора вывода.
- `pnpm typecheck` - запустить TypeScript-проверку.
- `pnpm build` - собрать сервер и клиент.
- `pnpm start` - запустить production-сборку.

Production-конфиг pm2 находится в `ecosystem.config.cjs` и сейчас слушает `127.0.0.1:4010`, потому что порт `4000` на этом хосте уже занят.

## API

- `GET /api/health`
- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `POST /api/consoles/:id/mode`
- `POST /api/consoles/:id/vanilla`
- `DELETE /api/consoles/:id`
- `POST /mcp`

## Текущие ограничения

- Отобразить/скрыть vanilla console сейчас реализовано как состояние yconhost и переключение режима. Прямое OS-level управление существующим окном консоли требует отдельного Windows adapter.
- После рестарта yconhost уже восстанавливаются metadata и сохраненный вывод; live re-attach к уже работающему процессу и его консоли еще реализуется.
- UI-тестирование через Chrome MCP может не пройти, если общий профиль Chrome DevTools MCP уже заблокирован другим процессом.
