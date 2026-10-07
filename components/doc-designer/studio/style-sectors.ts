import { FONT_FAMILIES } from "@/lib/doc-templates/page"

/**
 * Панель оформления для документов: печатные единицы (pt, мм), без анимаций,
 * трансформаций и прочего «сайтового». Абсолютное позиционирование — отдельно и свёрнуто.
 */
export const DOC_STYLE_SECTORS = [
  {
    id: "doc-typography",
    name: "Типографика",
    open: true,
    properties: [
      { extend: "font-family", name: "Шрифт", full: true, options: FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label })) },
      { extend: "font-size", name: "Размер", units: ["pt", "mm", "px"], unit: "pt", default: "10pt", min: 4 },
      {
        extend: "font-weight",
        name: "Насыщенность",
        options: [
          { id: "300", label: "Светлый" },
          { id: "400", label: "Обычный" },
          { id: "600", label: "Полужирный" },
          { id: "700", label: "Жирный" },
        ],
      },
      { extend: "line-height", name: "Межстрочный", units: ["", "pt", "mm"], unit: "", default: "1.35", step: 0.05 },
      { extend: "letter-spacing", name: "Трекинг", units: ["pt", "em"], unit: "pt", default: "0" },
      {
        extend: "font-style",
        name: "Начертание",
        type: "radio",
        options: [
          { id: "normal", label: "Прямой" },
          { id: "italic", label: "Курсив" },
        ],
      },
      {
        extend: "text-align",
        name: "Выравнивание",
        full: true,
        type: "radio",
        options: [
          { id: "left", label: "Слева" },
          { id: "center", label: "Центр" },
          { id: "right", label: "Справа" },
          { id: "justify", label: "По ширине" },
        ],
      },
      { extend: "color", name: "Цвет текста", full: true },
      {
        extend: "text-decoration",
        name: "Линия",
        type: "radio",
        options: [
          { id: "none", label: "Нет" },
          { id: "underline", label: "Подчёркнуто" },
          { id: "line-through", label: "Зачёркнуто" },
        ],
      },
      {
        extend: "text-transform",
        name: "Регистр",
        type: "radio",
        options: [
          { id: "none", label: "Как есть" },
          { id: "uppercase", label: "ПРОПИСНЫЕ" },
        ],
      },
    ],
  },
  {
    id: "doc-space",
    name: "Отступы",
    open: false,
    properties: [
      { extend: "margin", name: "Внешние", units: ["mm", "pt"], unit: "mm", detached: true },
      { extend: "padding", name: "Внутренние", units: ["mm", "pt"], unit: "mm", detached: true },
    ],
  },
  {
    id: "doc-size",
    name: "Размеры",
    open: false,
    properties: [
      { extend: "width", name: "Ширина", units: ["mm", "%"], unit: "mm" },
      { extend: "max-width", name: "Макс. ширина", units: ["mm", "%"], unit: "mm" },
      { extend: "min-height", name: "Мин. высота", units: ["mm"], unit: "mm" },
      { extend: "height", name: "Высота", units: ["mm"], unit: "mm" },
    ],
  },
  {
    id: "doc-border",
    name: "Рамка и фон",
    open: false,
    properties: [
      { extend: "border", name: "Рамка" },
      { extend: "border-radius", name: "Скругление", units: ["mm", "pt"], unit: "mm" },
      { extend: "background-color", name: "Фон", full: true },
    ],
  },
  {
    id: "doc-layout",
    name: "Расположение",
    open: false,
    properties: [
      {
        extend: "display",
        name: "Отображение",
        full: true,
        options: [
          { id: "block", label: "Блок" },
          { id: "flex", label: "Строка/колонка (flex)" },
          { id: "inline-block", label: "В строке" },
          { id: "none", label: "Скрыто" },
        ],
      },
      {
        extend: "flex-direction",
        name: "Направление",
        options: [
          { id: "row", label: "В строку" },
          { id: "column", label: "В колонку" },
        ],
      },
      {
        extend: "justify-content",
        name: "По главной оси",
        options: [
          { id: "flex-start", label: "В начале" },
          { id: "center", label: "По центру" },
          { id: "flex-end", label: "В конце" },
          { id: "space-between", label: "По краям" },
        ],
      },
      {
        extend: "align-items",
        name: "По поперечной оси",
        options: [
          { id: "stretch", label: "Растянуть" },
          { id: "flex-start", label: "В начале" },
          { id: "center", label: "По центру" },
          { id: "flex-end", label: "В конце" },
        ],
      },
      { property: "gap", name: "Промежуток", type: "number", units: ["mm", "pt"], unit: "mm", default: "0" },
      { extend: "flex-basis", name: "Ширина в строке", units: ["mm", "%"], unit: "%" },
    ],
  },
  {
    id: "doc-print",
    name: "Печать и страницы",
    open: false,
    properties: [
      {
        property: "break-inside",
        name: "Разрыв внутри",
        type: "select",
        default: "auto",
        options: [
          { id: "auto", label: "Можно разрывать" },
          { id: "avoid", label: "Не разрывать блок" },
        ],
      },
      {
        property: "break-before",
        name: "Перед блоком",
        type: "select",
        default: "auto",
        options: [
          { id: "auto", label: "Как получится" },
          { id: "page", label: "С новой страницы" },
          { id: "avoid", label: "Не отрывать от предыдущего" },
        ],
      },
      {
        property: "break-after",
        name: "После блока",
        type: "select",
        default: "auto",
        options: [
          { id: "auto", label: "Как получится" },
          { id: "page", label: "Новая страница" },
          { id: "avoid", label: "Не отрывать от следующего" },
        ],
      },
    ],
  },
  {
    id: "doc-position",
    name: "Позиционирование (особые случаи)",
    open: false,
    properties: [
      {
        extend: "position",
        name: "Режим",
        full: true,
        options: [
          { id: "static", label: "В потоке документа" },
          { id: "relative", label: "Со смещением" },
          { id: "absolute", label: "Абсолютно (печать, подпись)" },
        ],
      },
      { extend: "top", name: "Сверху", units: ["mm"], unit: "mm" },
      { extend: "left", name: "Слева", units: ["mm"], unit: "mm" },
      { extend: "z-index", name: "Слой" },
    ],
  },
]
