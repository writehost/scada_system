package com.scadatable.wms.data.remote

object WmsEndpointConfig {
    const val DEFAULT_BASE_URL = "https://scada25.ru/"

    fun normalizeBaseUrl(raw: String, fallback: String = DEFAULT_BASE_URL): String {
        var s = raw.trim()
        if (s.isEmpty()) return fallback
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = if (isPrivateOrLocalHost(s.substringBefore('/').substringBefore(':'))) "http://$s" else "https://$s"
        }
        if (!s.endsWith("/")) s += "/"
        return s
    }

    fun isLikelyWrongForPhysicalTsd(url: String): Boolean {
        val s = url.trim().lowercase()
        return s.contains("10.0.2.2") || s.contains("127.0.0.1") || s.contains("localhost")
    }

    /** Частая опечатка: scada.ru вместо рабочего scada25.ru */
    fun isKnownMisconfiguredProductionHost(url: String): Boolean {
        val s = url.trim().lowercase()
        return s.contains("scada.ru") && !s.contains("scada25.ru")
    }

    /** URL сервера OTA-обновлений (/api/v1/tsd/check, /packages/). Не путать с WMS API :3001. */
    fun resolveUpdateServerBaseUrl(apiBaseUrl: String): String {
        val normalized = normalizeBaseUrl(apiBaseUrl)
        return try {
            val uri = java.net.URI(normalized)
            val host = uri.host?.lowercase().orEmpty()
            val port = if (uri.port > 0) uri.port else -1
            when {
                host == "scada25.ru" || host.endsWith(".scada25.ru") -> "https://scada25.ru/"
                port == 3001 -> {
                    val scheme = uri.scheme?.ifBlank { "http" } ?: "http"
                    "$scheme://$host/"
                }
                else -> normalized
            }
        } catch (_: Exception) {
            DEFAULT_BASE_URL
        }
    }

    private fun isPrivateOrLocalHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h.endsWith(".local")) return true
        if (Regex("""127\.\d+\.\d+\.\d+""").matches(h)) return true
        if (Regex("""10\.\d+\.\d+\.\d+""").matches(h)) return true
        if (Regex("""192\.168\.\d+\.\d+""").matches(h)) return true
        val m = Regex("""172\.(\d+)\.\d+\.\d+""").matchEntire(h) ?: return false
        val second = m.groupValues[1].toIntOrNull() ?: return false
        return second in 16..31
    }
}
