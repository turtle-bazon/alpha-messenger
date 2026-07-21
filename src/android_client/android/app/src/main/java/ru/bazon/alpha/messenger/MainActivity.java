package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;

/**
 * Основная activity. Загружает веб-клиент:
 * 1. Если есть кешированная версия — загружает её
 * 2. Иначе — bundled www/
 *
 * alpha.serverUrl инжектируется в localStorage после super.onCreate(),
 * затем WebView перезагружается, чтобы React прочитал правильный URL.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";
    private static final String PREFS_NAME = "alpha";
    private static final String KEY_SERVER_URL = "server_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String serverUrl = prefs.getString(KEY_SERVER_URL, null);

        if (serverUrl == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        super.onCreate(savedInstanceState);

        // Определяем целевой URL: кеш или bundled
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheIndex = new File(updater.getCacheDir(), "index.html");
        String targetUrl;
        if (cacheIndex.exists()) {
            targetUrl = "file://" + cacheIndex.getAbsolutePath();
            Log.d(TAG, "Will load cached client: " + targetUrl);
        } else {
            // super.onCreate уже загрузил bundled www/, но нам нужно перезагрузить
            // после инжектирования localStorage.
            targetUrl = null;
        }

        // Инжектируем URL и перезагружаем — garantizado после super.onCreate.
        // evaluateJavascript + callback гарантирует, что localStorage записан
        // до начала загрузки новой страницы.
        WebView webView = getBridge().getWebView();
        String escaped = serverUrl
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r");

        String js = "localStorage.setItem('alpha.serverUrl','" + escaped + "');";
        webView.evaluateJavascript(js, value -> {
            // localStorage записан. Перезагружаем целевую страницу.
            if (targetUrl != null) {
                webView.loadUrl(targetUrl);
            } else {
                webView.reload();
            }
        });

        // Фоновая проверка обновлений
        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update check failed", e);
            }
        }).start();
    }
}
