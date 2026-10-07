# Шаблоны документов: визуальный редактор

Редактор бизнес-документов (УПД, накладная, акт, счёт, сертификат качества, паспорт оборудования,
задание на производство, складской документ, этикетки) на **GrapesJS Studio SDK**.
Шаблон хранится в синтаксисе **Jinja**, печатается backend-рендером в HTML и PDF.

- Список шаблонов: `/doc-templates` (меню «Контроль → Шаблоны документов»)
- Редактор: `/doc-designer/<id>`

## Как устроено

```
Jinja HTML ──importer──▶ дизайн-HTML (data-jinja-*) ──▶ компоненты Studio ──▶ редактор
                                                                              │
backend-рендер ◀── Jinja HTML ◀──exporter── дизайн-HTML ◀── проект Studio ◀───┘
```

| Часть | Где |
|---|---|
| Jinja ↔ дизайн-HTML: токенизатор, importer, exporter, разбор выражений | `lib/doc-templates/jinja/` |
| Санитайзер (без `<script>`, `on*=`, `javascript:`) | `lib/doc-templates/jinja/sanitize.ts` |
| Лист: форматы, поля, базовый печатный CSS | `lib/doc-templates/page.ts` |
| Схема данных и тестовые наборы | `lib/doc-templates/schema.ts` |
| Таблица данных, штрихкоды | `lib/doc-templates/data-table.ts`, `barcode.ts` |
| Серверный рендер, проверка шаблона, PDF | `lib/doc-templates/render.ts`, `pdf.ts` |
| Хранение и версии | `lib/doc-templates/store.ts`, `Backend/db/patches/2026-10-06_doc_templates.sql` |
| Системные шаблоны | `lib/doc-templates/system-templates.ts` |
| Редактор (Studio SDK + плагин) | `components/doc-designer/` |
| API | `app/api/wms/doc-templates/` |

### Jinja внутри редактора

Jinja хранится в атрибутах, на холсте показываются понятные блоки:

| Jinja | В редакторе |
|---|---|
| `{{ document.number }}` | `<span data-jinja-var="document.number">` — чип «◇ Документ · Номер» |
| `{% if c %}<p>…</p>{% endif %}` | `<p data-jinja-if="c">` — «Показывать, если …» |
| `{% for item in document.items %}<tr>…</tr>{% endfor %}` | `<tr data-jinja-for="item in document.items">` |
| if/elif/else, for/else, if вокруг нескольких элементов | обёртка `data-jinja-wrap` с ветками `data-jinja-branch` |
| `src="{{ … }}"` и другие атрибуты с Jinja | `data-jinja-attr-src="{{ … }}"` |
| всё, что нельзя разобрать без потерь (`set`, `macro`, Jinja поперёк HTML-тегов, `{%-`) | блок **Advanced Jinja** `data-jinja-raw` — исходник переносится байт-в-байт |

Импорт → правка → экспорт не меняет Jinja-выражения: `npm run test:doc-templates`.

### Данные

Поля в редакторе не зашиты: выбор переменной строится по схеме
`GET /api/wms/doc-templates/schema?kind=trade|quality|equipment|production|warehouse|labels`.
Новый вид документа добавляется в `DOCUMENT_KINDS` (схема + тестовые наборы).
Для складских документов предпросмотр может брать данные реального документа WMS
(используется существующий `getDocumentDetail`).

Режим **Данные** на холсте подставляет значения тестового набора; шаблон при этом не меняется.
Кнопки **Предпросмотр** и **PDF** — настоящий серверный рендер того же шаблона, что печатает production.

### Версии

`draft → published → archived`. Правки всегда идут в черновик: если шаблон опубликован,
первая правка создаёт новую версию-черновик, опубликованная остаётся без изменений до «Опубликовать».
Публикация запрещена, если шаблон не проходит проверку. История версий — в редакторе.

Печать из других модулей:

```
POST /api/wms/doc-templates/<id>/render?siteCode=…
{ "data": { …данные документа… }, "format": "pdf" }      # опубликованная версия
{ "documentId": "123", "format": "html" }                 # документ WMS
```

## Движок шаблонов

Backend проекта — TypeScript (Next.js API), поэтому шаблоны рендерит **Nunjucks** — JS-реализация
синтаксиса Jinja2 (включён режим совместимости: `True/False/None`, срезы, `dict.items()`).
Отличия от Python Jinja2, которые стоит знать:

- нет `namespace()`, `include`/`extends`/`import` (шаблон документа самодостаточен);
- поле данных важнее метода словаря: `document.items` — это позиции документа, а не `dict.items()`;
- свои фильтры: `date("DD.MM.YYYY" | "D MMMM YYYY")`, `number(знаков)`, `money`, `inn`;
  функция `barcode(значение, вид, коррекция, подпись, поворот)` возвращает SVG-картинку.

### Безопасность

- HTML шаблона очищается при импорте и при каждом сохранении (`<script>`, `<iframe>`, `on*=`, `javascript:` и т.п.).
- Nunjucks не песочница, поэтому перед рендером шаблон проходит проверку AST: запрещены
  `constructor`/`__proto__`/…, динамический доступ `obj[выражение]`, вызовы функций и фильтров вне белого списка.
- В шаблон попадают только JSON-данные документа (без объектов и моделей backend).
- HTML-предпросмотр отдаётся с CSP `default-src 'none'`; PDF печатается Chromium без JS и без сети.
- Блоки Advanced Jinja в редакторе меняет только администратор (роль `admin`); импорт Jinja — тоже.
  Это правило редактора; от выполнения кода защищает проверка AST выше, а не роль.

## Настройка

| Переменная | Зачем |
|---|---|
| `NEXT_PUBLIC_GRAPES_STUDIO_LICENSE_KEY` | Лицензия Studio SDK. На `localhost` подходит любой ключ; для домена production нужен ключ GrapesJS. Studio проверяет лицензию запросом к серверу GrapesJS. |
| `DOC_PDF_CHROMIUM_PATH` | Путь к Chromium/Chrome для PDF. Если не задан — Chromium, установленный Playwright (`npx playwright install chromium`). Без браузера PDF отвечает 503 с подсказкой. |

Таблицы создаются автоматически при первом обращении (как в других модулях), SQL-патч — для явных миграций.
GrapesJS и плагины подключаются из `node_modules`, CDN не нужен.

## Ограничения текущей версии

- Колонтитул «кроме первой страницы» не поддержан: Chromium печатает колонтитулы одинаково на всех листах.
  Есть режимы «на каждой странице» (с номерами страниц), «только на первой», «только на последней».
- Линейки и направляющие на холсте не сделаны.
- Формат и поля листа общие для всех страниц дизайна.
- Номера страниц (`page.number`, `page.total`) реальные только в PDF; на холсте и в HTML-предпросмотре — «1 из 1».
