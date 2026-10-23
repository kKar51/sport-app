# Журнал зала — карта кода

PWA без сборки и зависимостей: открывается с экрана «Домой» iPhone, работает офлайн, пишет данные через GitHub API в приватный репозиторий владельца. Этот репозиторий публичный: **никаких личных данных** (веса, еда, программа, токены) в код, тесты и коммиты.

## Модули

| Файл | Что внутри |
|---|---|
| `app.js` (~1600 строк) | Всё приложение: хранилище, синхронизация, отрисовка вкладок, события. Читай нужный раздел, а не файл целиком (см. ниже) |
| `stats.js` | Чистые расчёты и SVG «Прогресса»: адаптивные недели веса, тренд, темп, прогноз, 1ПМ, рабочие подходы, подходы на мышцу, логарифмическая кривая, графики. Без DOM — покрыт `tests/stats-unit.cjs` |
| `muscles.js` | Каталог упражнение → мышцы (1 / ½) и инвентарь, правила по названию, грифы и раскладка блинов, зоны объёма 4/10/20 |
| `progress.js`, `progress-view.js` | Модель и график страниц отдельной метрики (вес, сон, шаги, замеры, упражнение) |
| `health.js` | Разбор импорта Apple Health (`SPORT_HEALTH_V1`) |
| `sw.js` | Офлайн-кеш оболочки, network-first |
| `health-setup.html` | Инструкция по команде iPhone |

Разделы `app.js` отмечены `/* ---------- … ---------- */` — найди номер строки: `grep -n "^/\* ---------- " app.js`.

| Раздел | Ключевые функции |
|---|---|
| helpers | `addDays`, `fmtN`, `signed`, `plural`, `num` |
| local store + GitHub sync | `Store`, `persist`, `touchPath(path)` — пометить файл изменённым и поставить в очередь, `pull`, `pushAll` |
| app state | `S`, `rebuild()` — разложить `Store.files` по `S.workouts/body/food/...` |
| program logic | `P()`, `weekOf`, `phaseOf`, `effEx(slot, choice)` — замена наследует поля слота, `findEx`, `slotChoice`, `hintFor` |
| data edits | `getW`, `bodyGet/bodySet`, `bodySeries`, `foodDay` |
| render: today | `sessionBlock` (подходы, цель, гриф), `targetFor` (двойная прогрессия), `finishSummary`, таймер `startRest/runRest` |
| render: food | `renderFood`, `foodTotals` |
| render: progress tab | `weightModel`, `weightCard`, `strengthRows`, `volumeSection`, `renderStats` |
| render: root / events | `render()`, `paintMeters`, `paintStagger`, один обработчик кликов по `data-act` |

## Правила кода

- Стиль файла: ES5, однострочные функции, `var`, строки HTML через `+`, `esc()` для всего пользовательского.
- **CSP запрещает инлайн-стили** (`style="…"` в разметке блокируется). Динамику — через `data-*` и CSSOM после `render()` (`paintMeters`, `paintStagger`).
- Пропуск — не ноль: неизвестное значение не рисуется и не входит в среднее.
- Схема JSON и ключ `localStorage` `sport-journal.v1` не меняются без миграции и теста сохранности.
- Комментарии — короткие, по-английски, объясняют «почему».

## Выпуск версии

Скилл `app-release` в приватном каталоге. Вкратце: поднять `?v=N` во всех `<link>/<script>` `index.html`, `CACHE` и `SHELL` в `sw.js`, подпись «версия N» в настройках (`app.js`), имя кеша в `tests/mobile.cjs`; новый модуль — добавить и в `index.html`, и в `SHELL`. Раздел версии — в `README.md`.

## Тесты

- Быстрые: `node tests/stats-unit.cjs`, `node tests/progress-unit.cjs`.
- Браузерные (`mobile`, `daily-progress`, `health`, `data-preservation`): Playwright с системным Chrome (`channel: 'chrome'`), путь к пакету — через `NODE_PATH`. Данные синтетические.
- `tests/data-preservation.cjs` падает и на версии 13 («Read-only navigation/download never writes to the mock remote») — известная проблема, не от новых правок.
