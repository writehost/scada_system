package com.scadatable.wms.data.remote

class WmsHttpException(
    val status: Int,
    val code: String? = null,
    message: String,
) : RuntimeException(message)
