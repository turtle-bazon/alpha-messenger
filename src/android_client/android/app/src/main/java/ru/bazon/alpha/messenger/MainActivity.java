package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
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

        WebView webView = getBridge().getWebView();
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);

        // Приоритет загрузки web-клиента:
        // 1. Кеш (getFilesDir/web_client/) — быстрый, settings.js рядом с index.html
        // 2. Сервер (serverUrl) — если кеша нет, грузим напрямую (как на десктопе)
        // 3. Bundled (assets/www/) — только если и кеш, и сервер недоступны

        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        if (cacheIndex.exists()) {
            // Кеш есть — загружаем из него
            Log.d(TAG, "Loading cached client: " + cacheIndex.getAbsolutePath());
            writeSettingsJs(serverUrl, cacheDir);
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
        } else {
            // Кеша нет — грузим с сервера (settings.js не нужен, origin = serverUrl)
            Log.d(TAG, "No cache, loading from server: " + serverUrl);
            webView.loadUrl(serverUrl);
        }

        // Фоновая скачка/обновление клиента для следующего запуска
        new Thread(() -> {
            try {
                boolean ok = updater.checkAndUpdate();
                Log.d(TAG, "Background update: " + ok);
            } catch (Exception e) {
                Log.e(TAG, "Background update failed", e);
            }
        }).start();
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
