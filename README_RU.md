# yconhost

yconhost - локальный Web UI/API для управления консольными процессами через ConPTY/pipe backend. Приложение предоставляет браузерный терминал, HTTP API, WebSocket streaming и небольшой HTTP MCP интерфейс для автоматизации.

## Основные возможности

- Создание, просмотр, перезапуск и остановка отдельных консолей.
- Inline-переименование консолей в заголовке деталей; определения консолей сохраняются и пересоздаются после рестарта yconhost.
- Пакетный запуск консолей проекта из `mywins.json` или `my_wins.json`.
- Сохранение списка последних проектов, защита от повторного открытия и групповые действия start/stop/restart/read/close.
- Live streaming вывода терминала через WebSocket.
- Отображение интерактивных терминалов в браузере через xterm.js.
- Запуск pty-сессий с `xterm-256color`/truecolor env hints для CLI-инструментов с цветным выводом.
- Отправка обычного текста и специальных команд, включая `Ctrl+C` и `Ctrl+Break`.
- Сохранение истории вывода в `data/logs`.
- Ротация логов и ограниченный in-memory scrollback.
- Поиск ошибок по plain text и ANSI colored output.
- Просмотр строк, сработавших как ошибки, в debug mode и сброс unread-счетчиков из UI.
- Возможность отключить ANSI parser для отдельной консоли.
- HTTP endpoints и минимальный HTTP MCP endpoint.
- Production-запуск через pm2.
- Перезапуск HTTP/MCP-сервера без остановки консолей: отдельный terminal host под PM2 хранит процессы, логи и состояние xterm.

## Команды

- `pnpm install` - установить зависимости.
- `pnpm test` - запустить тесты endpoint'ов и анализатора вывода.
- `pnpm typecheck` - запустить TypeScript-проверку.
- `pnpm build` - собрать сервер и клиент.
- `pnpm start:terminal-host` - запустить владельца терминалов (обычно через PM2).
- `pnpm start` - запустить HTTP-сервер; terminal host должен работать с теми же settings/dataDir.

Production-конфиг PM2 находится в `ecosystem.config.cjs`, адрес постоянный:
**http://127.0.0.1:4011/**. Начальный запуск: `pm2 start ecosystem.config.cjs`,
затем `pm2 save`. Обычное обновление сервера: `pm2 restart yconhost`.
Не использовать `restart all`, если нужно сохранить сессии.
Подробности: [операции перезапуска](docs/server_restart_without_console_loss.md).

## API

- `GET /api/health`
- `GET /api/projects`
- `GET /api/recent-projects`
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

## Текущие ограничения

- ConPTY/pipe backend поддерживает стандартный host и yopenconsole с показом/скрытием настоящего native CLI.
- После рестарта HTTP-сервера сохраняются процессы, нативное окно и состояние TUI. Рестарт terminal host или Windows завершает сессии; после reboot сохранённые команды автоматически не запускаются.
- UI-тестирование через Chrome MCP может не пройти, если общий профиль Chrome DevTools MCP уже заблокирован другим процессом.
