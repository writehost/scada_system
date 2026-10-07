import grapesRu from "grapesjs/locale/ru.mjs"

/**
 * Русская локализация Studio SDK (поверх локали GrapesJS).
 * Переведены разделы, которые видит пользователь редактора документов.
 */
const studioRu = {
  add: "Добавить",
  delete: "Удалить",
  duplicate: "Дублировать",
  rename: "Переименовать",
  remove: "Удалить",
  clear: "Очистить",
  select: "Выбрать",
  selectList: "Выберите из списка",
  search: "Поиск",
  update: "Обновить",
  updated: "Обновлено",
  confirm: "Подтвердить",
  cancel: "Отмена",
  enable: "Включить",
  disable: "Выключить",
  upload: "Загрузить",
  close: "Закрыть",
  load: "Загрузить",
  copy: "Копировать",
  save: "Сохранить",
  error: "Ошибка",
  current: "Текущий",
  selectTarget: "Элемент",
  noItems: "Ничего не найдено",
  notItemsFound: "Ничего не найдено",
  confirmAction: "Подтверждаете действие?",
  actions: {
    componentOutline: { title: "Границы блоков" },
    preview: { title: "Просмотр" },
    fullscreen: { title: "Во весь экран" },
    undo: { title: "Отменить" },
    redo: { title: "Повторить" },
  },
  pageManager: {
    pages: "Страницы",
    page: "Страница",
    newPage: "Новая страница",
    add: "Добавить страницу",
    rename: "Переименовать",
    duplicate: "Дублировать",
    copy: "Копия",
    delete: "Удалить",
    deletePage: "Удалить страницу",
    confirmDelete: "Удалить страницу дизайна?",
    homePage: "Первая страница",
    settings: { label: "Настройки", title: "Настройки страницы", global: "Общие настройки", fields: { name: { label: "Название" } } },
  },
  templates: { notFound: "Шаблоны не найдены" },
  storageManager: { errorLoad: "Не удалось загрузить шаблон", errorStore: "Не удалось сохранить шаблон" },
  assetManager: {
    addUrl: "Добавить по ссылке",
    projectAssets: "Изображения шаблона",
    userAssets: "Все изображения",
    errorLoad: "Не удалось загрузить изображения",
    errorUpload: "Не удалось загрузить файл",
    errorDelete: "Не удалось удалить",
    deleteConfirmQuestion: "Удалить изображение?",
    deleteConfirmExplanation: "Изображение исчезнет из шаблонов, где используется.",
    assetTypes: { all: "Все", image: "Изображения" },
    noProvider: "Изображения шаблона",
  },
  fontManager: { addFontToProject: "Добавить шрифт", projectFonts: "Шрифты шаблона", emptyProjectFonts: "Шрифтов нет", selectFont: "Выберите шрифт" },
  blockManager: {
    notFound: "Блоки не найдены",
    blocks: "Блоки",
    add: "Добавить блоки",
    search: "Найти блок…",
    types: { regular: "Блоки", symbols: "Повторно используемые" },
  },
  traitManager: { empty: "Выберите элемент документа", notFound: "Нет свойств", panelLabel: "Свойства" },
  selectorManager: {
    noSelecton: "Ничего не выбрано",
    selectFromCanvas: "Выберите элемент на листе",
    selection: "Выделение",
    selector: "Селектор",
    addNewSelector: "Добавить класс",
    removeSelector: "Убрать класс",
    target: "Элемент",
    state: "Состояние",
    deleteStyle: "Сбросить оформление",
    showCSS: "Показать CSS",
    applyOnSelector: "Применять к классам",
    applyOnComponents: "Применять к элементу",
    noSelectors: "Классов нет",
    noComponents: "Элементы не выбраны",
    currentSelection: "Оформление для",
  },
  layerManager: { layers: "Структура" },
  styleManager: {
    empty: "Выберите элемент, чтобы изменить оформление",
    notFound: "Нет параметров оформления",
    panelLabel: "Оформление",
    properties: {
      "margin-top": "Сверху",
      "margin-right": "Справа",
      "margin-bottom": "Снизу",
      "margin-left": "Слева",
      "padding-top": "Сверху",
      "padding-right": "Справа",
      "padding-bottom": "Снизу",
      "padding-left": "Слева",
      "border-top-left-radius": "Слева сверху",
      "border-top-right-radius": "Справа сверху",
      "border-bottom-right-radius": "Справа снизу",
      "border-bottom-left-radius": "Слева снизу",
      "font-family": "Шрифт",
      "font-size": "Размер",
      "font-weight": "Насыщенность",
      "letter-spacing": "Трекинг",
      "text-align": "Выравнивание",
      "text-decoration": "Линия",
      "text-transform": "Регистр",
      "border-width": "Толщина",
      "border-style": "Стиль",
      "border-color": "Цвет",
      "row-gap": "Строки",
      "column-gap": "Колонки",
    },
  },
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isObj(out[k]) && isObj(v) ? merge(out[k] as Record<string, unknown>, v) : v
  return out
}

export const RU_LOCALE = merge(grapesRu as unknown as Record<string, unknown>, studioRu)
