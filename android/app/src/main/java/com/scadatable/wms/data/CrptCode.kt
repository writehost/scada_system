package com.scadatable.wms.data

/**
 * Нормализация КМ для Честного ЗНАКа.
 *
 * Скан / DataMatrix приходит **с криптохвостом** (AI 93) — так и должно быть.
 * В CRPT info уходит **без криптохвоста**: 01+GTIN+21+полный серийник.
 * Нельзя путать «93» внутри серийника с криптохвостом (напитки serial=13).
 */
object CrptCode {
    private const val GS = '\u001D'
    /** Без GS: не резать «93» внутри серийника (напитки serial=13). */
    private val trailingAi93 = Regex("""^(01\d{14}21.{6,}?)(93[\x21-\x22\x25-\x2F\x30-\x39\x41-\x5A\x5F\x61-\x7A]{4,})$""")
    private val trailingParen93 = Regex("""^(.+?)\(93\)[^()]*$""", RegexOption.IGNORE_CASE)
    private val parenUnit = Regex("""^\(01\)(\d{14})(?:\(21\)([\s\S]+))?$""", RegexOption.IGNORE_CASE)
    private val gtinHead = Regex("""^\(01\)(\d{14})""", RegexOption.IGNORE_CASE)
    private val serialAfter21 = Regex("""^\(21\)([\s\S]+?)(?:\(\d{2}\)|$)""", RegexOption.IGNORE_CASE)
    private val missingSerialAi = Regex("""^01(\d{14})(?!21)([\s\S]+)$""")

    fun normalizeScannerDecorations(code: String): String {
        var s = code.trim().trim('"', '\'')
        if (s.isEmpty()) return s
        s = s
            .removePrefix("]d2")
            .removePrefix("]D2")
            .replace(Regex("""~+\]"""), GS.toString())
            .replace(Regex("""${GS}+"""), GS.toString())
        s = s.replace(Regex("""^~+1(?=01\d{14})"""), "")
        return s
    }

    fun stripCryptoTail(code: String): String {
        val trimmed = normalizeScannerDecorations(code)
        if (trimmed.isEmpty()) return trimmed

        val gsParen93 = trimmed.indexOf("$GS(93)")
        if (gsParen93 >= 0) return trimmed.substring(0, gsParen93)

        val gs93 = trimmed.indexOf("${GS}93")
        if (gs93 >= 0) return trimmed.substring(0, gs93)

        trailingParen93.find(trimmed)?.let { return it.groupValues[1] }

        trailingAi93.find(trimmed)?.let { return it.groupValues[1] }

        return trimmed
    }

    fun compactGs1MarkedCode(code: String): String {
        val s = normalizeScannerDecorations(code)
        if (s.isEmpty()) return s

        parenUnit.find(s)?.let { m ->
            val gtin = m.groupValues[1]
            val serial = m.groupValues.getOrNull(2)?.trim().orEmpty()
            return if (serial.isNotEmpty()) "01${gtin}21$serial" else "01$gtin"
        }

        gtinHead.find(s)?.let { m ->
            val rest = s.substring(m.value.length)
            serialAfter21.find(rest)?.let { serial ->
                return "01${m.groupValues[1]}21${serial.groupValues[1].trim()}"
            }
        }

        return s
    }

    fun ensureCrptSerialAi(code: String): String {
        val m = missingSerialAi.find(code) ?: return code
        return "01${m.groupValues[1]}21${m.groupValues[2]}"
    }

    /** То же, что normalizeCrptCode на сервере WMS. */
    fun normalize(code: String): String {
        var s = normalizeScannerDecorations(code)
        if (s.isEmpty()) return s
        s = stripCryptoTail(s)
        s = compactGs1MarkedCode(s)
        s = ensureCrptSerialAi(s)
        return s
    }

    /**
     * Формат для POST /api/wms/crpt/info.
     * Скобки AI защищают серийник с «93» внутри от старого strip на проде
     * (компактный 01…21…5mH93… ошибочно резался до …5mH).
     */
    fun toUpstreamRequestCode(code: String): String {
        val normalized = normalize(code)
        val m = Regex("""^01(\d{14})21(.+)$""").find(normalized) ?: return normalized
        return "(01)${m.groupValues[1]}(21)${m.groupValues[2]}"
    }
}
