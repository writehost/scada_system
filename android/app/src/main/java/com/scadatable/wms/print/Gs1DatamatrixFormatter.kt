package com.scadatable.wms.print

/** Формат GS1 DataMatrix для TSPL: DMATRIX …,"~1…" (FNC1 + элементная строка). */
object Gs1DatamatrixFormatter {
    private const val GS = '\u001D'
    private val parenthesizedAi = Regex("""\((\d{2,4})\)""")
    private val variableLengthAis = setOf(
        "10", "21", "22", "240", "241", "242", "250", "251", "30",
        "37", "400", "401", "403", "420", "421", "423",
        "90", "91", "92", "93", "94", "95", "96", "97", "98", "99",
    )

    fun format(raw: String): String {
        val trimmed = raw.trim().trim('"', '\'')
        if (trimmed.isEmpty()) return trimmed

        val elementString = toElementString(normalizeLegacyTsplEscapes(trimmed))
        val escaped = StringBuilder()
        for (ch in elementString) {
            when (ch) {
                '~' -> escaped.append("~~")
                GS -> escaped.append("~]") // GS — разделитель GS1
                '"' -> escaped.append("'")
                else -> escaped.append(ch)
            }
        }
        var out = escaped.toString()
        if (out.startsWith("01") && !out.startsWith("~1")) {
            out = "~1$out"
        }
        return out
    }

    private fun toElementString(raw: String): String {
        val withoutScannerPrefix = raw.removePrefix("]d2").removePrefix("]D2")
        val matches = parenthesizedAi.findAll(withoutScannerPrefix).toList()
        if (matches.isEmpty()) return withoutScannerPrefix

        val out = StringBuilder()
        matches.forEachIndexed { index, match ->
            val ai = match.groupValues[1]
            val next = matches.getOrNull(index + 1)
            val valueStart = match.range.last + 1
            val valueEndExclusive = next?.range?.first ?: withoutScannerPrefix.length
            val value = withoutScannerPrefix.substring(valueStart, valueEndExclusive)
            out.append(ai).append(value)
            if (next != null && isVariableLength(ai)) {
                out.append(GS)
            }
        }
        return out.toString()
    }

    private fun isVariableLength(ai: String): Boolean =
        ai in variableLengthAis

    private fun normalizeLegacyTsplEscapes(raw: String): String {
        var s = raw
            .removePrefix("]d2")
            .removePrefix("]D2")
            .replace(Regex("""~+\]"""), GS.toString())
            .replace(Regex("""${GS}+"""), GS.toString())

        // Старые плохие наклейки могли попасть в БД как literal "~1..." или "~~1...".
        // Для форматтера это не данные, а попытка обозначить FNC1, поэтому убираем маркер.
        s = s.replace(Regex("""^~+1(?=\d{2})"""), "")

        return s
    }
}
