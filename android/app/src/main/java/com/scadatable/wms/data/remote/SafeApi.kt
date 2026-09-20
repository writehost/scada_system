package com.scadatable.wms.data.remote

import retrofit2.HttpException
import java.io.IOException
import com.scadatable.wms.support.SupportTelemetry
import org.json.JSONObject

suspend fun <T> safeApi(block: suspend () -> T): Result<T> {
    return try {
        Result.success(block())
    } catch (e: HttpException) {
        val body = e.response()?.errorBody()?.string().orEmpty()
        val parsed = parseErrorBody(body)
        val message = parsed.message ?: fallbackHttpMessage(e.code(), body, e.message())
        if (SupportTelemetry.activeSessionId != null) {
            SupportTelemetry.logApiError(e.code(), parsed.code, message)
        }
        Result.failure(
            WmsHttpException(
                status = e.code(),
                code = parsed.code,
                message = message,
            )
        )
    } catch (e: java.io.IOException) {
        val base = RetrofitClient.getBaseUrl()
        val detail = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
        Result.failure(RuntimeException("Ошибка сети ($base): $detail", e))
    } catch (e: com.google.gson.JsonSyntaxException) {
        val base = RetrofitClient.getBaseUrl()
        Result.failure(
            RuntimeException(
                "Сервер вернул не JSON ($base). Часто это редирект на страницу входа: " +
                    "обновите WMS на сервере (proxy.ts должен пропускать /api/wms) или войдите по логину/паролю перед PIN.",
                e,
            ),
        )
    } catch (e: Exception) {
        val msg = e.message.orEmpty()
        if (msg.contains("malformed JSON", ignoreCase = true) || msg.contains("JsonReader", ignoreCase = true)) {
            val base = RetrofitClient.getBaseUrl()
            Result.failure(
                RuntimeException(
                    "Сервер вернул не JSON ($base). Проверьте, что на scada25.ru открыт /api/wms без редиректа на /login.",
                    e,
                ),
            )
        } else {
            Result.failure(e)
        }
    }
}

private data class ParsedApiError(
    val code: String? = null,
    val message: String? = null,
)

private fun parseErrorBody(body: String): ParsedApiError {
    if (body.isBlank()) return ParsedApiError()
    return try {
        val root = JSONObject(body)
        val code = root.optString("code").takeIf { it.isNotBlank() }
        var message = when {
            root.optString("error").isNotBlank() -> root.optString("error")
            root.optString("message").isNotBlank() -> root.optString("message")
            root.optString("detail").isNotBlank() -> root.optString("detail")
            else -> null
        }
        // Иногда error = сырой JSON-массив ответа ЧЗ.
        if (!message.isNullOrBlank() && message.trimStart().startsWith("[")) {
            val err = Regex(""""errorMessage"\s*:\s*"([^"]+)"""").find(message)?.groupValues?.getOrNull(1)
            val ec = Regex(""""errorCode"\s*:\s*"([^"]+)"""").find(message)?.groupValues?.getOrNull(1)
            message = when {
                !err.isNullOrBlank() && !ec.isNullOrBlank() -> "$err ($ec)"
                !err.isNullOrBlank() -> err
                else -> message.take(160)
            }
        }
        ParsedApiError(code = code, message = message)
    } catch (_: Exception) {
        ParsedApiError()
    }
}

private fun fallbackHttpMessage(status: Int, body: String, retrofitMessage: String?): String {
    val trimmed = body.trim()
    if (trimmed.startsWith("<!DOCTYPE", ignoreCase = true) || trimmed.startsWith("<html", ignoreCase = true)) {
        val title = Regex("<title>(.*?)</title>", RegexOption.IGNORE_CASE)
            .find(trimmed)
            ?.groupValues
            ?.getOrNull(1)
            ?.replace("&quot;", "\"")
            ?.trim()
        return buildString {
            append("HTTP $status")
            if (!title.isNullOrBlank()) append(": ").append(title)
            append(". Проверьте Base URL: Android должен смотреть на WMS API с маршрутами /api/wms/*.")
        }
    }
    // CRPT иногда отдаёт массив [{...,"errorMessage":"..."}] — не светить сырой JSON в UI.
    if (trimmed.startsWith("[")) {
        val err = Regex(""""errorMessage"\s*:\s*"([^"]+)"""").find(trimmed)?.groupValues?.getOrNull(1)
        val code = Regex(""""errorCode"\s*:\s*"([^"]+)"""").find(trimmed)?.groupValues?.getOrNull(1)
        when {
            !err.isNullOrBlank() && !code.isNullOrBlank() -> return "$err ($code)"
            !err.isNullOrBlank() -> return err
        }
    }
    if (status == 404) return "КМ/КИ не найден"
    return trimmed.take(280).ifBlank { retrofitMessage ?: "HTTP $status" }
}
