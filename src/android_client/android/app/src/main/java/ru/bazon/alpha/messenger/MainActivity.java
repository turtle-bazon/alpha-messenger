package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
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
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "AlphaMainActivity";
    private static final String PREFS_NAME = "alpha";
    private static final String KEY_SERVER_URL = "server_url";

    private FrameLayout overlay;
    private TextView loadingText;

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
        super.onCreate(savedInstanceState);

        showLoadingOverlay();

        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        Log.d(TAG, "Cache dir: " + cacheDir.getAbsolutePath());
        Log.d(TAG, "Cache index exists: " + cacheIndex.exists());

        if (cacheIndex.exists()) {
            // Кеш есть — ставим перехватчик и перезагружаем
            Log.d(TAG, "Loading cached client via interceptor");
            installInterceptor(webView, cacheDir);
            hideLoading();
            // Фоновая проверка обновлений
            new Thread(() -> {
                try {
                    boolean updated = updater.checkAndUpdate();
                    Log.d(TAG, "Background update: " + updated);
                    if (updated) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            String url = webView.getUrl();
                            if (url != null) webView.loadUrl(url);
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
     * Ставит CachedWebViewClient на WebView и перезагружает страницу.
     * На API < 26 (Android 7.x и ниже) — фолбэк на file:// (мост Capacitor теряется).
     */
    private void installInterceptor(WebView webView, File cacheDir) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebViewClient original = webView.getWebViewClient();
            webView.setWebViewClient(new CachedWebViewClient(original, cacheDir));
            // reload() может не вызвать shouldInterceptRequest для главного фрейма.
            // Используем loadUrl() с текущим URL — это гарантированно пройдёт через interceptor.
            String currentUrl = webView.getUrl();
            Log.d(TAG, "Installing interceptor, reloading: " + currentUrl);
            if (currentUrl != null) {
                webView.loadUrl(currentUrl);
            } else {
                webView.loadUrl("https://localhost/");
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
}
