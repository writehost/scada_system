package com.scadatable.wms.support

import android.app.Activity
import android.graphics.Bitmap
import android.util.Base64
import android.view.View
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

object ScreenCapture {
    fun captureActivityJpegBase64(activity: Activity, maxWidth: Int = 720, quality: Int = 62): String? {
        val root = activity.window?.decorView?.rootView ?: return null
        return captureViewJpegBase64(root, maxWidth, quality)
    }

    fun captureViewJpegBase64(view: View, maxWidth: Int = 720, quality: Int = 62): String? {
        if (view.width <= 0 || view.height <= 0) return null
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.RGB_565)
        val canvas = android.graphics.Canvas(bitmap)
        view.draw(canvas)
        val scaled = scaleDown(bitmap, maxWidth)
        if (scaled !== bitmap) bitmap.recycle()
        val bytes = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(40, 85), bytes)
        scaled.recycle()
        return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    }

    private fun scaleDown(source: Bitmap, maxWidth: Int): Bitmap {
        if (source.width <= maxWidth) return source
        val ratio = maxWidth.toFloat() / source.width.toFloat()
        val h = max(1, (source.height * ratio).roundToInt())
        return Bitmap.createScaledBitmap(source, maxWidth, h, true)
    }
}
