package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "AlphaMainActivity";
    private static final String PREFS_NAME = "alpha";
    private static final String KEY_SERVER_URL = "server_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, null);
        Log.d(TAG, "onCreate serverUrl=" + serverUrl);

        if (serverUrl == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        super.onCreate(savedInstanceState);

        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheIndex = new File(updater.getCacheDir(), "index.html");

        // Пытаемся скачать клиент СИНХРОННО, если ещё нет в кеше.
        // Это гарантирует что settings.js и index.html будут в одной папке.
        if (!cacheIndex.exists()) {
            Log.d(TAG, "No cached client, downloading...");
            boolean ok = updater.checkAndUpdate();
            Log.d(TAG, "Download result: " + ok);
        }

        // Пишем settings.js (на случай если checkAndUpdate его не создал)
        writeSettingsJs(serverUrl, updater.getCacheDir());

        WebView webView = getBridge().getWebView();

        // Загружаем кеш если есть, иначе bundled (super.onCreate уже загрузил)
        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client: " + cacheIndex.getAbsolutePath());
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
        }

        // Фоновая проверка обновлений
        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update check failed", e);
            }
        }).start();
    }

    private void writeSettingsJs(String serverUrl, File dir) {
        try {
            if (!dir.exists()) dir.mkdirs();
            File settingsFile = new File(dir, "settings.js");
            String escaped = serverUrl.replace("\\", "\\\\").replace("\"", "\\\"");
            String content = "window.__ALPHA_CONFIG__ = {\"serverUrl\":\"" + escaped + "\"};\n";
            java.io.FileWriter w = new java.io.FileWriter(settingsFile);
            w.write(content);
            w.close();
            Log.d(TAG, "Wrote settings.js: " + settingsFile.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "Failed to write settings.js", e);
        }
    }
}
