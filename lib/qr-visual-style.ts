/** Стили QR 1:1 с example/ react-native-qrcode-styled — форма модулей, не только цвет. */

export const QR_VISUAL_STYLE_STORAGE_KEY = "wms.qrVisualStyle"
export const QR_VISUAL_LOGO_STORAGE_KEY = "wms.qrVisualLogo"
export const QR_VISUAL_STYLE_EVENT = "wms-qr-visual-style"

export const QR_VISUAL_STYLE_IDS = [
  "classic",
  "circles",
  "glued",
  "liquid",
  "cut",
  "rain",
  "gradient",
  "eyes",
  "custom",
  "mosaic",
] as const

export type QrVisualStyleId = (typeof QR_VISUAL_STYLE_IDS)[number]

export const QR_VISUAL_LOGO_IDS = [
  "none",
  "stickers",
  "water",
  "materials",
  "gp",
  "wms",
  "scada",
] as const

export type QrVisualLogoId = (typeof QR_VISUAL_LOGO_IDS)[number]

/** Радиусы углов модуля: TL, TR, BR, BL, доля от размера клетки. */
export type QrCornerRadii = [number, number, number, number]

export type QrVisualPreset = {
  id: QrVisualStyleId
  label: string
  hint: string
  color: string
  gradientTo?: string
  radial?: boolean
  glued: boolean
  liquid: boolean
  cut: boolean
  radii: QrCornerRadii
  scale: [number, number]
  roundedEyes?: boolean
  circleEyes?: boolean
  noise?: boolean
}

export type QrVisualLogoPreset = {
  id: QrVisualLogoId
  label: string
  hint: string
  stickerFrame: boolean
}

export const QR_VISUAL_PRESETS: QrVisualPreset[] = [
  {
    id: "classic",
    label: "Классика",
    hint: "Квадратные модули",
    color: "#111111",
    glued: false,
    liquid: false,
    cut: false,
    radii: [0, 0, 0, 0],
    scale: [1, 1],
  },
  {
    id: "circles",
    label: "Круги",
    hint: "Circle Pieces — скругление 50%",
    color: "#F57F17",
    glued: false,
    liquid: false,
    cut: false,
    radii: [0.5, 0.5, 0.5, 0.5],
    scale: [1, 1],
  },
  {
    id: "glued",
    label: "Склейка",
    hint: "Glued Rounded — круги сливаются с соседями",
    color: "#1d5480",
    glued: true,
    liquid: false,
    cut: false,
    radii: [0.5, 0.5, 0.5, 0.5],
    scale: [1, 1],
  },
  {
    id: "liquid",
    label: "Жидкий",
    hint: "Liquid Pieces — перемычки в пустых клетках",
    color: "#c9a73f",
    glued: false,
    liquid: true,
    cut: false,
    radii: [0.5, 0.5, 0.5, 0.5],
    scale: [1, 1],
  },
  {
    id: "cut",
    label: "Срез углов",
    hint: "Cut Corners — скос вместо дуги",
    color: "#59387e",
    glued: true,
    liquid: false,
    cut: true,
    radii: [0.5, 0, 0.5, 0],
    scale: [1, 1],
  },
  {
    id: "rain",
    label: "Дождь",
    hint: "Rain Style — узкие высокие штрихи",
    color: "#106cb3",
    glued: false,
    liquid: false,
    cut: false,
    radii: [0.4, 0.4, 0.4, 0.4],
    scale: [0.85, 1.18],
  },
  {
    id: "gradient",
    label: "Градиент",
    hint: "Linear Gradient + скос 75%",
    color: "#da0c8b",
    gradientTo: "#00bfff",
    glued: true,
    liquid: false,
    cut: false,
    radii: [0, 0.75, 0, 0.75],
    scale: [1, 1],
  },
  {
    id: "eyes",
    label: "Глазки",
    hint: "Custom Eyes — круглые поисковые узоры",
    color: "#0f0080",
    gradientTo: "#ff7bc6",
    radial: true,
    glued: false,
    liquid: false,
    cut: false,
    radii: [0.5, 0.5, 0.5, 0.5],
    scale: [0.92, 0.92],
    roundedEyes: true,
    circleEyes: true,
  },
  {
    id: "custom",
    label: "Мозаика",
    hint: "Custom Pieces — каждый модуль своего тона",
    color: "#222222",
    glued: false,
    liquid: false,
    cut: false,
    radii: [0, 0, 0, 0],
    scale: [1.03, 1.03],
    noise: true,
  },
  {
    id: "mosaic",
    label: "Мозаика и глазки",
    hint: "Custom Pieces & Eyes",
    color: "#01fff2",
    gradientTo: "#b634e6",
    glued: false,
    liquid: false,
    cut: false,
    radii: [0, 0, 0, 0],
    scale: [1.03, 1.03],
    noise: true,
    circleEyes: true,
    roundedEyes: true,
  },
]

export const QR_VISUAL_LOGOS: QrVisualLogoPreset[] = [
  {
    id: "none",
    label: "Без логотипа",
    hint: "Только QR",
    stickerFrame: false,
  },
  {
    id: "stickers",
    label: "Стикеры",
    hint: "Рамка-стикер и значок группы",
    stickerFrame: true,
  },
  {
    id: "water",
    label: "Вода",
    hint: "Капля в центре",
    stickerFrame: false,
  },
  {
    id: "materials",
    label: "Материалы",
    hint: "Склад материалов",
    stickerFrame: false,
  },
  {
    id: "gp",
    label: "Готовая продукция",
    hint: "Склад ГП",
    stickerFrame: false,
  },
  {
    id: "wms",
    label: "WMS",
    hint: "Марка системы",
    stickerFrame: false,
  },
  {
    id: "scada",
    label: "QPass",
    hint: "Паспорт scada25",
    stickerFrame: false,
  },
]

export function isQrVisualStyleId(value: string): value is QrVisualStyleId {
  return (QR_VISUAL_STYLE_IDS as readonly string[]).includes(value)
}

export function isQrVisualLogoId(value: string): value is QrVisualLogoId {
  return (QR_VISUAL_LOGO_IDS as readonly string[]).includes(value)
}

export function getQrVisualPreset(id: QrVisualStyleId): QrVisualPreset {
  return QR_VISUAL_PRESETS.find((p) => p.id === id) ?? QR_VISUAL_PRESETS[0]
}

export function getQrVisualLogo(id: QrVisualLogoId): QrVisualLogoPreset {
  return QR_VISUAL_LOGOS.find((p) => p.id === id) ?? QR_VISUAL_LOGOS[0]
}

export function readQrVisualStyleId(): QrVisualStyleId {
  if (typeof window === "undefined") return "classic"
  try {
    const raw = window.localStorage.getItem(QR_VISUAL_STYLE_STORAGE_KEY)?.trim() ?? ""
    return isQrVisualStyleId(raw) ? raw : "classic"
  } catch {
    return "classic"
  }
}

export function readQrVisualLogoId(): QrVisualLogoId {
  if (typeof window === "undefined") return "none"
  try {
    const raw = window.localStorage.getItem(QR_VISUAL_LOGO_STORAGE_KEY)?.trim() ?? ""
    return isQrVisualLogoId(raw) ? raw : "none"
  } catch {
    return "none"
  }
}

export function writeQrVisualStyleId(id: QrVisualStyleId): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(QR_VISUAL_STYLE_STORAGE_KEY, id)
  window.dispatchEvent(new CustomEvent(QR_VISUAL_STYLE_EVENT, { detail: { styleId: id } }))
}

export function writeQrVisualLogoId(id: QrVisualLogoId): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(QR_VISUAL_LOGO_STORAGE_KEY, id)
  window.dispatchEvent(new CustomEvent(QR_VISUAL_STYLE_EVENT, { detail: { logoId: id } }))
}
