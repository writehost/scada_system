package com.scadatable.wms.data.remote

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {
    // Production TSDs must talk to the public WMS host. Override from settings for local debug.
    private var baseUrl = WmsEndpointConfig.DEFAULT_BASE_URL
    @Volatile
    private var accessToken: String? = null

    private val logging: HttpLoggingInterceptor by lazy {
        HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
    }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val token = accessToken?.trim().orEmpty()
                val request = if (token.isNotBlank()) {
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                chain.proceed(request)
            }
            .addInterceptor(logging)
            .build()
    }

    @Volatile
    private var apiInstance: WmsApi? = null

    private fun buildApi(url: String): WmsApi {
        return Retrofit.Builder()
            .baseUrl(url)
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(WmsApi::class.java)
    }

    fun setBaseUrl(url: String) {
        val normalized = WmsEndpointConfig.normalizeBaseUrl(url, baseUrl)
        if (normalized == baseUrl && apiInstance != null) return
        baseUrl = normalized
        apiInstance = buildApi(baseUrl)
    }

    fun getBaseUrl(): String = baseUrl

    fun setAccessToken(token: String?) {
        accessToken = token?.trim()?.takeIf { it.isNotEmpty() }
    }

    val api: WmsApi
        get() = apiInstance ?: synchronized(this) {
            apiInstance ?: buildApi(baseUrl).also { apiInstance = it }
        }

}
