package ru.bazon.alpha.messenger;

import android.graphics.Bitmap;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.LinkedHashMap;

/**
 * WebViewClient, который перехватывает запросы и отдаёт файлы из кеша.
 * Оригинальный Capacitor WebViewClient делегируется для сохранения бриджа.
 */
public class CachedWebViewClient extends WebViewClient {

    private static final String TAG = "CachedWebViewClient";
    private static final Map<String, String> MIME_MAP = new HashMap<>();

    static {
        MIME_MAP.put(".html", "text/html; charset=utf-8");
        MIME_MAP.put(".js", "application/javascript; charset=utf-8");
        MIME_MAP.put(".css", "text/css; charset=utf-8");
        MIME_MAP.put(".json", "application/json; charset=utf-8");
        MIME_MAP.put(".svg", "image/svg+xml");
        MIME_MAP.put(".png", "image/png");
        MIME_MAP.put(".jpg", "image/jpeg");
        MIME_MAP.put(".jpeg", "image/jpeg");
        MIME_MAP.put(".gif", "image/gif");
        MIME_MAP.put(".ico", "image/x-icon");
        MIME_MAP.put(".woff", "font/woff");
        MIME_MAP.put(".woff2", "font/woff2");
        MIME_MAP.put(".ttf", "font/ttf");
        MIME_MAP.put(".map", "application/json");
    }

    private final WebViewClient originalClient;
    private final File cacheDir;

    public CachedWebViewClient(WebViewClient originalClient, File cacheDir) {
        this.originalClient = originalClient;
        this.cacheDir = cacheDir;
    }

    @Nullable
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String path = request.getUrl().getPath();
        boolean isMainPage = request.isForMainFrame();
        Log.d(TAG, "shouldInterceptRequest: " + request.getUrl() + " mainFrame=" + isMainPage);

        if (path == null || path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }

        // Убираем ведущий слеш
        if (path.startsWith("/")) {
            path = path.substring(1);
        }

        File cachedFile = new File(cacheDir, path);

        if (cachedFile.exists() && cachedFile.isFile()) {
            try {
                String mimeType = getMimeType(path);
                InputStream stream = new FileInputStream(cachedFile);
                Map<String, String> headers = new LinkedHashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                Log.d(TAG, "Serving from cache: " + path + " (" + mimeType + ")");
                return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, stream);
            } catch (IOException e) {
                Log.e(TAG, "Failed to read cached file: " + path, e);
            }
        }

        Log.d(TAG, "Not in cache, delegating: " + path);
        // Файла нет в кеше — делегируем оригинальному клиенту (Capacitor assets)
        return originalClient.shouldInterceptRequest(view, request);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        originalClient.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        originalClient.onPageFinished(view, url);
    }

    @Override
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
        super.onReceivedError(view, errorCode, description, failingUrl);
        originalClient.onReceivedError(view, errorCode, description, failingUrl);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return originalClient.shouldOverrideUrlLoading(view, request);
    }

    private String getMimeType(String path) {
        int dot = path.lastIndexOf('.');
        if (dot >= 0) {
            String ext = path.substring(dot).toLowerCase();
            String mime = MIME_MAP.get(ext);
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }
}
