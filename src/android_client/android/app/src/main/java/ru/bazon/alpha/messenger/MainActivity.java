package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import android.webkit.WebView;

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

        // Записываем settings.js в кеш-директорию клиентского bundle.
        // Скаченный index.html загружает <script src="settings.js"> перед основным кодом.
        // Web client читает window.__ALPHA_CONFIG__.serverUrl — синхронно, без таймингов.
        try {
            writeSettingsJs(serverUrl);
        } catch (IOException e) {
            Log.e(TAG, "Failed to write settings.js", e);
        }

        // Загружаем кеш или bundled
        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client: " + cacheIndex.getAbsolutePath());
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
        }
        // Если кеша нет — super.onCreate уже загрузил bundled www/

        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update check failed", e);
            }
        }).start();
    }

    private void writeSettingsJs(String serverUrl) throws IOException {
        // Пишем в кеш-директорию (getFilesDir()/web_client/)
        // WebClientUpdater.getCacheDir() = getFilesDir()/web_client/
        WebClientUpdater updater = new WebClientUpdater(this, null);
        File dir = updater.getCacheDir();
        if (!dir.exists()) dir.mkdirs();

        File settingsFile = new File(dir, "settings.js");
        String content = "window.__ALPHA_CONFIG__ = " + jsonString("serverUrl", serverUrl) + ";\n";
        try (FileWriter w = new FileWriter(settingsFile)) {
            w.write(content);
        }
        Log.d(TAG, "Wrote settings.js: " + settingsFile.getAbsolutePath());
    }

    private static String jsonString(String key, String value) {
        return "{\"" + key + "\":\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
    }
}
