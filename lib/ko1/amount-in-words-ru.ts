/** Сумма прописью для КО-1 (рубли + копейки), классическое согласование. */

const UNITS_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
const UNITS_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
]
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"]
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"]

type Gender = "m" | "f"

function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}

function tripleLessThan1000(n: number, gender: Gender): string {
  if (n === 0) return ""
  const u = gender === "f" ? UNITS_F : UNITS_M
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (h > 0) parts.push(HUNDREDS[h])
  if (rest >= 10 && rest <= 19) {
    parts.push(TEENS[rest - 10])
  } else {
    const t = Math.floor(rest / 10)
    const o = rest % 10
    if (t > 0) parts.push(TENS[t])
    if (o > 0) parts.push(u[o])
  }
  return parts.join(" ").trim()
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Целые рубли 0 … 999 999 999 999 в строку без названия валюты. */
function integerRublesToPhrase(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError("rubles must be non-negative finite")
  if (n === 0) return "ноль"

  let rest = Math.floor(n)
  const chunks: string[] = []

  const bil = Math.floor(rest / 1_000_000_000)
  rest %= 1_000_000_000
  if (bil > 0) {
    chunks.push(tripleLessThan1000(bil, "m"))
    chunks.push(plural(bil, ["миллиард", "миллиарда", "миллиардов"]))
  }

  const mil = Math.floor(rest / 1_000_000)
  rest %= 1_000_000
  if (mil > 0) {
    chunks.push(tripleLessThan1000(mil, "m"))
    chunks.push(plural(mil, ["миллион", "миллиона", "миллионов"]))
  }

  const thou = Math.floor(rest / 1000)
  rest %= 1000
  if (thou > 0) {
    chunks.push(tripleLessThan1000(thou, "f"))
    chunks.push(plural(thou, ["тысяча", "тысячи", "тысяч"]))
  }

  if (rest > 0) {
    chunks.push(tripleLessThan1000(rest, "m"))
  }

  return chunks.filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
}

function rubleWord(n: number): string {
  return plural(n, ["рубль", "рубля", "рублей"])
}

function kopeckPhrase(k: number): string {
  if (!Number.isFinite(k) || k < 0 || k > 99) throw new RangeError("kopecks must be 0-99")
  const words = tripleLessThan1000(k, "f")
  const kopWord = plural(k, ["копейка", "копейки", "копеек"])
  return `${words || "ноль"} ${kopWord}`.trim()
}

/**
 * Полная фраза для КО-1: «Сто двадцать три рубля 45 копеек».
 * Копейки допускают округление до целого 0–99.
 */
export function rublesAndKopecksToWords(rubles: number, kopecks: number): string {
  const r = Math.max(0, Math.floor(rubles))
  let k = Math.round(kopecks)
  if (k >= 100) {
    const carry = Math.floor(k / 100)
    k %= 100
    return rublesAndKopecksToWords(r + carry, k)
  }

  const rubPhrase = r === 0 ? `ноль ${rubleWord(0)}` : `${integerRublesToPhrase(r)} ${rubleWord(r)}`
  const kopPhrase = kopeckPhrase(k)
  return capitalize(`${rubPhrase} ${kopPhrase}`)
}
