package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.webkit.WebView;
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

    private void updateStatus(String msg) {
        Log.d(TAG, msg);
        if (loadingText != null) {
            new Handler(Looper.getMainLooper()).post(() -> loadingText.setText(msg));
        }
    }

    private void hideLoading() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (overlay != null) overlay.setVisibility(View.GONE);
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, null);
        Log.d(TAG, "=== onCreate serverUrl=" + serverUrl);

        if (serverUrl == null) {
            Log.d(TAG, "No server URL, launching SetupActivity");
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        super.onCreate(savedInstanceState);

        // Показываем overlay поверх WebView (WebView создаётся super.onCreate)
        showLoadingOverlay();

        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        Log.d(TAG, "Cache dir: " + cacheDir.getAbsolutePath());
        Log.d(TAG, "Cache index exists: " + cacheIndex.exists());

        if (cacheIndex.exists()) {
            // Кеш есть — загружаем сразу
            Log.d(TAG, "Loading cached client");
            writeSettingsJs(serverUrl, cacheDir);
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
            hideLoading();
            // Фоновая проверка обновлений
            new Thread(() -> {
                try {
                    boolean ok = updater.checkAndUpdate();
                    Log.d(TAG, "Background update: " + ok);
                } catch (Exception e) {
                    Log.e(TAG, "Update failed", e);
                }
            }).start();
        } else {
            // Кеша нет — скачиваем в фоне
            updateStatus("Скачивание клиента...");

            new Thread(() -> {
                try {
                    updateStatus("Получение манифеста...");
                    boolean ok = updater.checkAndUpdate();
                    Log.d(TAG, "Download result: " + ok);
                    updateStatus("Результат: " + ok);

                    new Handler(Looper.getMainLooper()).post(() -> {
                        if (cacheIndex.exists()) {
                            updateStatus("Загрузка клиента...");
                            writeSettingsJs(serverUrl, cacheDir);
                            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
                            hideLoading();
                        } else {
                            // Fallback: грузим с сервера
                            updateStatus("Загрузка с сервера...");
                            Log.d(TAG, "Fallback: loading from server URL");
                            webView.loadUrl(serverUrl);
                            hideLoading();
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Download exception", e);
                    updateStatus("Ошибка: " + e.getMessage());
                    new Handler(Looper.getMainLooper()).post(() -> {
                        webView.loadUrl(serverUrl);
                        hideLoading();
                    });
                }
            }).start();
        }
    }

    /** Overlay поверх WebView — не заменяет ContentView. */
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

        // Добавляем overlay в корневой FrameLayout поверх WebView
        FrameLayout root = (FrameLayout) getWindow().getDecorView().findViewById(android.R.id.content);
        root.addView(overlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void writeSettingsJs(String serverUrl, File dir) {
        try {
            if (!dir.exists()) dir.mkdirs();
            String escaped = serverUrl.replace("\\", "\\\\").replace("\"", "\\\"");
            String content = "window.__ALPHA_CONFIG__ = {\"serverUrl\":\"" + escaped + "\"};\n";
            FileWriter w = new FileWriter(new File(dir, "settings.js"));
            w.write(content);
            w.close();
            Log.d(TAG, "Wrote settings.js");
        } catch (IOException e) {
            Log.e(TAG, "Failed to write settings.js", e);
        }
    }
}
