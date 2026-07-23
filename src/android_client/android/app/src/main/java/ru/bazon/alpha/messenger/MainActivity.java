package ru.bazon.alpha.messenger;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;

import java.io.FileWriter;
import java.io.IOException;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "AlphaMainActivity";
    private static final String PREFS_NAME = "alpha";
    private static final String KEY_SERVER_URL = "server_url";

    private FrameLayout overlay;
    private TextView loadingText;

    @Override
    public void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    private void updateStatus(String msg) {
        Log.d(TAG, msg);
        if (loadingText != null) {
            new Handler(Looper.getMainLooper()).post(() -> loadingText.setText(msg));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, null);
        Log.d(TAG, "=== onCreate serverUrl=" + serverUrl);

        if (serverUrl == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        registerPlugin(NotificationPlugin.class);
        super.onCreate(savedInstanceState);

        KeepAliveService.start(this);

        showLoadingOverlay();

        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        Log.d(TAG, "Cache dir: " + cacheDir.getAbsolutePath());
        Log.d(TAG, "Cache index exists: " + cacheIndex.exists());

        if (cacheIndex.exists()) {
            // Кеш есть — пишем settings.js и загружаем
            Log.d(TAG, "Loading cached client via interceptor");
            writeSettingsJs(serverUrl, cacheDir);
            installInterceptor(webView, cacheDir);
            hideLoading();
            // Фоновая проверка обновлений
            new Thread(() -> {
                try {
                    boolean updated = updater.checkAndUpdate();
                    Log.d(TAG, "Background update: " + updated);
                    if (updated) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            // Перечитываем HTML из кеша и перезагружаем
                            CachedWebViewClient client = getCachedClient(webView);
                            if (client != null) {
                                String html = client.readCachedIndexHtml();
                                if (html != null) {
                                    webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
                                }
                            }
                        });
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Update failed", e);
                }
            }).start();
        } else {
            // Кеша нет — скачиваем, потом ставим перехватчик
            updateStatus("Скачивание клиента...");

            new Thread(() -> {
                try {
                    updateStatus("Получение манифеста с " + serverUrl + "...");
                    boolean ok = updater.checkAndUpdate();
                    Log.d(TAG, "Download result: " + ok);

                    new Handler(Looper.getMainLooper()).post(() -> {
                        if (cacheIndex.exists()) {
                            writeSettingsJs(serverUrl, cacheDir);
                            installInterceptor(webView, cacheDir);
                            hideLoading();
                        } else {
                            updateStatus("Не удалось скачать клиент.\nПроверьте подключение к серверу.");
                            Log.e(TAG, "Download failed and no cache");
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Download exception", e);
                    new Handler(Looper.getMainLooper()).post(() -> {
                        updateStatus("Ошибка: " + e.getMessage());
                    });
                }
            }).start();
        }
    }

    /**
     * Ставит CachedWebViewClient (для под-ресурсов) и загружает cached HTML
     * через loadDataWithBaseURL (для главного фрейма).
     *
     * shouldInterceptRequest не работает для main frame — WebView показывает
     * HTML как текст. Вместо этого загружаем HTML напрямую, а под-ресурсы
     * (JS, CSS) перехватываются и отдаются из кеша.
     */
    private void installInterceptor(WebView webView, File cacheDir) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebViewClient original = webView.getWebViewClient();
            CachedWebViewClient cachedClient = new CachedWebViewClient(original, cacheDir);
            webView.setWebViewClient(cachedClient);

            // Загружаем cached HTML через loadDataWithBaseURL.
            // Base URL = https://localhost/ — совпадает с origin Capacitor,
            // поэтому бридж пересоздаётся в onPageStarted.
            // Под-ресурсы (./assets/...) резолвятся на https://localhost/assets/...
            // и перехватываются CachedWebViewClient → отдаются из кеша.
            String html = cachedClient.readCachedIndexHtml();
            if (html != null) {
                Log.d(TAG, "Loading cached HTML via loadDataWithBaseURL");
                webView.loadDataWithBaseURL(
                    "https://localhost/",
                    html,
                    "text/html",
                    "UTF-8",
                    null
                );
            } else {
                Log.e(TAG, "Cached index.html not found, falling back to reload");
                webView.reload();
            }
        } else {
            // API < 26: getWebViewClient() недоступен — загружаем из file://
            Log.w(TAG, "API " + Build.VERSION.SDK_INT + " < 26, using file:// fallback");
            webView.loadUrl("file://" + new File(cacheDir, "index.html").getAbsolutePath());
        }
    }

    private void showLoadingOverlay() {
        overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xFF1A1A2E);

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);

        ProgressBar bar = new ProgressBar(this);
        center.addView(bar);

        loadingText = new TextView(this);
        loadingText.setText("Загрузка...");
        loadingText.setTextColor(0xFFAAAAAA);
        loadingText.setTextSize(14);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (16 * getResources().getDisplayMetrics().density);
        center.addView(loadingText, lp);

        overlay.addView(center, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        FrameLayout root = (FrameLayout) getWindow().getDecorView().findViewById(android.R.id.content);
        root.addView(overlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void hideLoading() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (overlay != null) overlay.setVisibility(View.GONE);
        });
    }

    /** Проверяет, является ли текущий WebViewClient экземпляром CachedWebViewClient. */
    private CachedWebViewClient getCachedClient(WebView webView) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebViewClient client = webView.getWebViewClient();
            if (client instanceof CachedWebViewClient) {
                return (CachedWebViewClient) client;
            }
        }
        return null;
    }

    /**
     * Записывает settings.js в кеш-директорию.
     * HTML содержит <script src="settings.js"> — интерцептор отдаст его из кеша.
     * settings.js ставит window.__ALPHA_CONFIG__ = { serverUrl: "..." },
     * который getApiUrl() в config.ts читает как приоритетный источник.
     */
    private void writeSettingsJs(String serverUrl, File dir) {
        try {
            if (!dir.exists()) dir.mkdirs();
            String escaped = serverUrl.replace("\\", "\\\\").replace("\"", "\\\"");
            String content = "window.__ALPHA_CONFIG__ = {\"serverUrl\":\"" + escaped + "\"};\n";
            FileWriter w = new FileWriter(new File(dir, "settings.js"));
            w.write(content);
            w.close();
            Log.d(TAG, "Wrote settings.js for " + serverUrl);
        } catch (IOException e) {
            Log.e(TAG, "Failed to write settings.js", e);
        }
    }
}
