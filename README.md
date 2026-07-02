# KSP2 Mission Control — ЦУП с LLM-диспетчером

Полноценный центр управления полётами для Kerbal Space Program 2. LLM выступает
в роли диспетчера FLIGHT: вы даёте директиву («выведи ракету на орбиту 100 км»), он
планирует и исполняет её, командуя кораблём через мод и читая живую телеметрию между
действиями. Всё управление и мониторинг — через веб-интерфейс ЦУП.

Диспетчер работает через **любой OpenAI-совместимый API**: по умолчанию — **Cloud.ru
Foundation Models** (DeepSeek, Qwen и др.), но так же подойдут OpenAI, OpenRouter,
локальные Ollama/LM Studio/vLLM. Требуется модель с поддержкой function calling.

```
┌────────────────────┐   TCP :8766    ┌─────────────────┐   WS/REST    ┌──────────────┐
│  KSP2 + мод        │◄──────────────►│  Backend        │◄────────────►│  Frontend    │
│  MccLink           │  телеметрия    │  FastAPI +      │  :8000       │  ЦУП UI      │
│  (SpaceWarp/       │  5 Гц + команды│  Claude-агент   │              │  React :3000 │
│   BepInEx)         │                │  (Docker)       │              │  (Docker)    │
└────────────────────┘                └─────────────────┘              └──────────────┘
```

## Состав

| Компонент | Что делает |
|---|---|
| `mod/` | C#-мод MccLink (SpaceWarp): TCP-сервер в игре — стрим телеметрии (высота, орбита, SAS, узлы манёвра...) и приём команд (тяга, стадии, SAS, узлы, варп) |
| `backend/` | FastAPI: мост к игре, LLM-диспетчер (OpenAI-совместимый API, tool-use loop со стримингом), WebSocket для UI, журнал миссии (SQLite), история телеметрии |
| `frontend/` | Диспетчерская: телеметрия-плитки, графики (высота/орбита, скорость), консоль диспетчера с его рассуждениями и командами, журнал миссии, ручное управление |

## Требования

- Windows с KSP2 **0.2.x** + установленный **SpaceWarp** (у вас уже стоит через CKAN)
- **Docker Desktop** (compose v2)
- Ключ к OpenAI-совместимому провайдеру. По умолчанию — **Cloud.ru** (Foundation Models,
  https://cloud.ru), модель с function calling (напр. `deepseek-ai/DeepSeek-V3`).

## Быстрый старт

### 1. Собрать и установить мод (один раз)

```powershell
cd ksp2-mcc
.\install-mod.ps1                      # путь по умолчанию C:\Games\Kerbal Space Program 2
# или: .\install-mod.ps1 -GameDir "D:\Games\Kerbal Space Program 2"
```

Скрипт собирает мод в Docker-контейнере **против DLL вашей установки игры** (гарантия
совместимости версий) и копирует его в `BepInEx\plugins\MccLink`.

### 2. Настроить окружение

```powershell
Copy-Item .env.example .env
notepad .env    # вписать MCC_API_KEY (и при необходимости MCC_BASE_URL / MCC_MODEL)
```

По умолчанию диспетчер ходит в Cloud.ru Foundation Models. Чтобы взять другого провайдера,
задайте в `.env`:

```ini
# OpenAI
MCC_BASE_URL=https://api.openai.com/v1
MCC_MODEL=gpt-4o
# Локальный Ollama
MCC_BASE_URL=http://host.docker.internal:11434/v1
MCC_MODEL=qwen2.5:32b
```

### 3. Запустить ЦУП

```powershell
docker compose up -d --build
```

### 4. Полететь

1. Запустите KSP2, поставьте корабль на старт (или загрузите сохранение в полёте).
2. Откройте **http://localhost:3000** — в шапке должно загореться «Игра: на связи».
3. Дайте директиву диспетчеру, например:
   - «Выведи ракету на круговую орбиту 90 км»
   - «Создай узел циркуляризации в апоцентре и выполни его»
   - «Подними апоцентр до 250 км»
   - «Своди корабль с орбиты и посади на парашютах»

Диспетчер отчитывается в консоли: его рассуждения (сворачиваемые), каждая команда в игру
с результатом, итоговый отчёт. Кнопка **■ Стоп** прерывает исполнение в любой момент.
Панель «Ручное управление» шлёт команды в обход LLM (тяга, SAS, стадия, аварийный сейф).

## Как это устроено

### Мод MccLink

TCP-сервер на порту `8766` (настраивается в `BepInEx/config/com.mcc.mcclink.cfg`),
протокол — JSON-строки. Раз в 200 мс рассылает снапшот телеметрии; принимает команды:

`ping`, `get_telemetry`, `set_throttle`, `stage`, `set_sas`, `set_action_group`,
`create_node`, `clear_nodes`, `warp_to`, `cancel_warp`, `warp_index`.

Все вызовы игрового API идут в главном потоке Unity (команды из сокета кладутся в
очередь). Warp-to реализован собственным контроллером ступеней варпа с автостопом.

### Диспетчер (backend)

Агент через OpenAI-совместимый API (`chat.completions` с function calling и стримингом).
Провайдер, эндпоинт и модель задаются в `.env` (`MCC_BASE_URL`, `MCC_MODEL`, `MCC_API_KEY`);
по умолчанию Cloud.ru Foundation Models. Reasoning-модели (DeepSeek-R1 и т.п.) — их поле
`reasoning_content` показывается в консоли как «анализ». Инструменты агента: `get_telemetry`,
`wait`, `set_throttle`, `stage`, `set_sas`, `set_action_group`, `create_maneuver_node`,
`clear_maneuver_nodes`, `warp_to`, `cancel_warp`, `emergency_safe`. Системный промпт содержит
лётные процедуры (выведение, исполнение узла, посадка) и правила безопасности (не варпать под
тягой, глушить двигатели после манёвра и т.п.). Лимит — 60 шагов на директиву.

> Если провайдер не поддерживает `stream=true` вместе с `tools`, поставьте `MCC_STREAM=0`
> в `.env` — агент переключится на нестриминговые вызовы (текст появится одним блоком).

Контекст диалога сохраняется между директивами (можно сказать «а теперь подними
перицентр»), кнопка «Сброс контекста» очищает его. Журнал миссии пишется в SQLite
(volume `mcc-data`) и переживает перезапуски.

### REST API

| Метод | Путь | Что |
|---|---|---|
| GET | `/api/status` | статус моста/агента |
| GET | `/api/telemetry/history?seconds=900` | история для графиков |
| GET | `/api/events?limit=200` | журнал миссии |
| POST | `/api/directive` `{text}` | директива диспетчеру |
| POST | `/api/agent/stop` | остановить агента |
| POST | `/api/agent/reset` | сбросить контекст диалога |
| POST | `/api/command` `{cmd,args}` | ручная команда в игру |
| WS | `/ws` | телеметрия + события агента в реальном времени |

## Troubleshooting

| Симптом | Решение |
|---|---|
| «Игра: нет связи» | Игра запущена? Мод установлен? В `BepInEx\LogOutput.log` должна быть строка `MCC Link bridge listening on 0.0.0.0:8766`. Брандмауэр Windows может спросить разрешение при первом запуске. |
| Агент отвечает «нет соединения с игрой» | То же + проверьте, что backend видит хост: в `.env` `KSP_BRIDGE_HOST=host.docker.internal` (игра и Docker на одной машине). |
| Ошибка LLM API | Проверьте `MCC_API_KEY` / `MCC_BASE_URL` / `MCC_MODEL` в `.env`, перезапустите: `docker compose up -d`. Если модель не умеет tools — возьмите другую (нужен function calling). |
| Мод не собрался после обновления игры | Пересоберите: `.\install-mod.ps1` — компиляция идёт против DLL текущей версии игры; при смене API игры правки локализованы в `mod/src/KspApi.cs` и `CommandProcessor.cs`. |
| UI открывается, но пусто | Смотрите логи: `docker compose logs -f backend` |

## Разработка без Docker

```powershell
# backend
cd backend; pip install -r requirements.txt
$env:MCC_API_KEY="..."; $env:KSP_BRIDGE_HOST="localhost"; $env:MCC_DB_PATH="./mcc.db"
uvicorn app.main:app --reload

# frontend (проксирует /api и /ws на localhost:8000)
cd frontend; npm install; npm run dev
```

## Ограничения и планы

- Диспетчер управляет **активным** кораблём; переключение кораблей — вручную в игре.
- Точность исполнения узлов зависит от телеметрии 5 Гц + реального времени LLM;
  для прецизионных манёвров агент дросселирует тягу в конце сжигания.
- Стыковка возможна через SAS Target + RCS, но автопилота стыковки в v0.1 нет —
  хорошее направление для развития (например, команда `dock_approach` в моде).
