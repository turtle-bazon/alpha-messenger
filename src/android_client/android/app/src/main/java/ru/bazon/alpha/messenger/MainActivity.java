package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
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

        // addJavascriptInterface — синхронный мост.
        // НО: super.onCreate() уже вызвал loadUrl(bundled), страница может начать
        // загружаться ДО того, как addJavascriptInterface сработает в JS-контексте.
        String escaped = serverUrl.replace("\\", "\\\\").replace("'", "\\'");
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String getServerUrl() {
                return serverUrl;
            }
        }, "AlphaConfig");
        Log.d(TAG, "Registered AlphaConfig bridge");

        // evaluateJavascript — запасной вариант. Ставит __ALPHA_CONFIG__ напрямую.
        // Выполняется ПОСЛЕ loadUrl, но модули (type="module") — deferred,
        // поэтому evaluateJavascript попадёт в очередь раньше module scripts.
        String jsConfig = "window.__ALPHA_CONFIG__={serverUrl:'" + escaped + "'};"
            + "window.AlphaConfig={getServerUrl:function(){return'" + escaped + "'}};";
        webView.evaluateJavascript(jsConfig, value -> {
            Log.d(TAG, "evaluateJavascript result: " + value);
        });
        Log.d(TAG, "Injected config via evaluateJavascript");

        // settings.js для cached клиента (belt-and-suspenders)
        try {
            writeSettingsJs(serverUrl);
        } catch (IOException e) {
            Log.e(TAG, "Failed to write settings.js", e);
        }

        // Загружаем кеш или bundled
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheIndex = new File(updater.getCacheDir(), "index.html");

        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client: " + cacheIndex.getAbsolutePath());
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
        }
        // Если кеша нет — super.onCreate уже загрузил bundled www/

        // Фоновая проверка обновлений
        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update check failed", e);
            }
        }).start();
    }

    private void writeSettingsJs(String serverUrl) throws IOException {
        WebClientUpdater updater = new WebClientUpdater(this, null);
        File dir = updater.getCacheDir();
        if (!dir.exists()) dir.mkdirs();

        File settingsFile = new File(dir, "settings.js");
        String escaped = serverUrl.replace("\\", "\\\\").replace("\"", "\\\"");
        String content = "window.__ALPHA_CONFIG__ = {\"serverUrl\":\"" + escaped + "\"};\n";
        try (FileWriter w = new FileWriter(settingsFile)) {
            w.write(content);
        }
        Log.d(TAG, "Wrote settings.js: " + settingsFile.getAbsolutePath());
    }
}
