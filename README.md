# Battleforge

Фэнтезийная игра с прокачкой юнитов и пошаговыми PvP-боями для платформы
[Pikabu Games](https://games.pikabu.ru/sdk/docs/intro/what-do).

## Структура

- `frontend/` — Vite + React + TypeScript + Tailwind + shadcn/ui.
  - `src/sdk/` — обёртка над Pikabu SDK (`init`, `player`, `ads`, `store`, события) + dev-фолбэк
    для локальной разработки вне платформы.
  - `src/game/` — экраны игры: `CollectionView` (коллекция юнитов, прокачка), `BattleView`
    (сборка отряда, пошаговый бой по WebSocket), `catalog.ts` (зеркало каталога юнитов бэкенда),
    `use-battle-socket.ts` (клиент боевого протокола).
  - `src/game/Scene.tsx` — задел на 3D через `@react-three/fiber`, пока не подключён к экранам.
- `backend/` — Go-сервис:
  - `internal/pikabu/` — проверка подписанных данных SDK (JWT HS256).
  - `internal/units/` — каталог фэнтезийных юнитов, формулы роста статов и стоимости прокачки.
  - `internal/player/` — коллекция юнитов и золото игрока (in-memory).
  - `internal/battle/` — пошаговый боевой движок (очередь ходов по SPD, урон, победитель) и
    матчмейкинг.
  - `internal/httpapi/` — REST (коллекция/прокачка/верификация покупок) и WebSocket-эндпоинт боя.
- `docker-compose.yml` — оба сервиса одной командой (см. «Запуск через Docker» ниже).

## Игровой цикл

1. Игрок стартует с 500 золота и тремя юнитами 1 уровня: Воин, Маг, Лучник.
2. На вкладке «Коллекция» прокачивает юнитов за золото (`POST /api/collection/upgrade`) —
   характеристики растут линейно с уровнем.
3. На вкладке «Бой» собирает отряд из 3 юнитов и жмёт «Найти бой» — WebSocket-клиент
   встаёт в очередь матчмейкинга (`/api/battle/ws`).
4. Как только находится соперник, начинается пошаговый бой: очередь ходов строится по
   скорости (SPD) юнитов обеих сторон, каждый игрок сам выбирает цель для атаки своего юнита.
   Победитель получает 100 золота.

## Запуск через Docker

Самый быстрый способ поднять оба сервиса сразу:

```sh
cp .env.example .env   # вписать PIKABU_SECRET_KEY
docker compose up -d --build
```

- backend слушает `http://localhost:8080` (порт настраивается через `BACKEND_PORT` в `.env`).
- frontend (статика на nginx) — `http://localhost:5183` (`FRONTEND_PORT`).

`VITE_API_URL` встраивается в статический бандл фронтенда **на этапе сборки образа**
(`docker compose build`, не `up`) и должен указывать на адрес backend, доступный из браузера
пользователя, а не из docker-сети — поэтому по умолчанию `http://localhost:8080`, а не
`http://backend:8080`. Если меняете `VITE_API_URL` или `BACKEND_PORT` в `.env`, пересоберите
фронтенд: `docker compose build frontend`.

```sh
docker compose logs -f       # логи обоих сервисов
docker compose down          # остановить и убрать контейнеры
```

## Frontend

```sh
cd frontend
npm install
cp .env.example .env   # VITE_API_URL — адрес backend, по умолчанию http://localhost:8080
npm run dev             # локальная разработка
npm run build            # сборка в dist/ для загрузки в Студию Pikabu
```

SDK Pikabu (`https://games.pikabu.ru/sdk/sdk.js`) грузится динамически из
`src/sdk/pikabu-sdk.ts` и работает только внутри платформы Pikabu Games или
тестового окружения Студии. Вне платформы (`npm run dev` в обычном браузере)
`usePikabuSDK()` закономерно возвращает `status: 'error'`, и `usePlayerId()`
переключается на случайный ID в localStorage — только для локальной разработки,
в шапке приложения это явно помечено бейджем «Dev-режим». Чтобы проверить
интеграцию по-настоящему, создайте тестовую ссылку в разделе «Тестирование» Студии.

## Backend

```sh
cd backend
cp .env.example .env   # и вписать PIKABU_SECRET_KEY из Студии
go run ./cmd/server
go test ./... -race
```

Секретный ключ игры используется **только** на бэкенде — Pikabu SDK явно
запрещает хранить его в клиентском коде.

REST:
- `GET /api/collection` — коллекция и золото игрока (заголовок `X-Player-Id`).
- `POST /api/collection/upgrade` — прокачать юнита (`{"instanceId": "..."}`).
- `POST /api/pikabu/player/verify` — проверяет `sdk.player.getSignedData()`.
- `POST /api/pikabu/purchases/confirm` — проверяет `purchase.getSignedData()` и подтверждает
  начисление покупки (дедупликация по `purchaseId`).

WebSocket `GET /api/battle/ws?playerId=...`:
1. Клиент первым сообщением шлёт `{"type":"queue","unitIds":["u1","u2","u3"]}`.
2. Сервер отвечает `queued`, затем `battle_start` при нахождении соперника.
3. На каждый ход владелец юнита получает `your_turn` (unitId + validTargets), соперник —
   `opponent_turn`. Владелец отвечает `{"type":"action","targetId":"..."}`.
4. После каждого действия оба получают `battle_update` (лог + текущее состояние юнитов).
5. По завершении — `battle_end` с полем `winner`.

`X-Player-Id`/`?playerId=` в этом прототипе передаётся клиентом напрямую — это упрощение.
В проде идентификатор должен браться из серверной сессии, установленной после проверки
`sdk.player.getSignedData()` через `/api/pikabu/player/verify`, а не приходить от клиента как есть.

## Что дальше

- Заменить in-memory хранилища (`internal/player`, комнаты боёв, дедупликация покупок) на БД.
- Привязать `X-Player-Id`/`playerId` к серверной сессии вместо доверия клиенту напрямую.
- Подключить фронтенд к `/api/pikabu/purchases/confirm`: слать `purchase.getSignedData()`
  на бэкенд перед `consumePurchase`.
- Расширить боевой движок: способности/лечение (юнит «Целитель» пока обычный атакующий),
  критические удары, более 3 юнитов в отряде.
- Матчмейкинг сейчас — FIFO-очередь на одного ожидающего; для продакшна нужны рейтинг и
  несколько параллельных очередей.
- Подключить 3D-сцену (`frontend/src/game/Scene.tsx`) как визуализацию арены боя.
- Ознакомиться с разделом «Требования к игре» в документации SDK перед публикацией.
- Для деплоя за реальным доменом добавить reverse-proxy с TLS (Caddy/Traefik/nginx) перед
  обоими контейнерами вместо голых портов из docker-compose.yml.
