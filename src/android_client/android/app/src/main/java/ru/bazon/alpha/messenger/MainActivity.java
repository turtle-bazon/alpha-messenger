package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
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
            Log.d(TAG, "No server URL, launching SetupActivity");
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        Log.d(TAG, "Cache dir: " + cacheDir.getAbsolutePath());
        Log.d(TAG, "Cache index exists: " + cacheIndex.exists());
        Log.d(TAG, "Cached version: " + updater.getCachedVersion());

        // Кеш есть — загружаем сразу
        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client: " + cacheIndex.getAbsolutePath());
            writeSettingsJs(serverUrl, cacheDir);
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
            // Фоновая проверка обновлений
            new Thread(() -> {
                try {
                    Log.d(TAG, "Background update check...");
                    boolean ok = updater.checkAndUpdate();
                    Log.d(TAG, "Background update result: " + ok);
                } catch (Exception e) {
                    Log.e(TAG, "Background update failed", e);
                }
            }).start();
            return;
        }

        // Кеша нет — показываем loading и скачиваем в фоне
        showLoading();
        updateStatus("Нет кеша. Скачивание с " + serverUrl + "...");

        new Thread(() -> {
            try {
                updateStatus("Получение манифеста...");
                Log.d(TAG, "Starting download from " + serverUrl);

                boolean ok = updater.checkAndUpdate();
                Log.d(TAG, "Download result: " + ok);
                updateStatus("Результат: " + ok);

                new Handler(Looper.getMainLooper()).post(() -> {
                    if (cacheIndex.exists()) {
                        updateStatus("Клиент скачан! Загрузка...");
                        Log.d(TAG, "Cache now exists, loading");
                        writeSettingsJs(serverUrl, cacheDir);
                        webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
                    } else {
                        updateStatus("Кеш пуст, загрузка с сервера...");
                        Log.d(TAG, "Cache still missing, loading from server URL");
                        webView.loadUrl(serverUrl);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "Download exception", e);
                updateStatus("Ошибка: " + e.getMessage());
                new Handler(Looper.getMainLooper()).post(() -> {
                    webView.loadUrl(serverUrl);
                });
            }
        }).start();
    }

    private void showLoading() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(0xFF1A1A2E);

        ProgressBar bar = new ProgressBar(this);
        root.addView(bar);

        loadingText = new TextView(this);
        loadingText.setText("Загрузка...");
        loadingText.setTextColor(0xFFAAAAAA);
        loadingText.setTextSize(14);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (16 * getResources().getDisplayMetrics().density);
        root.addView(loadingText, lp);

        setContentView(root);
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
