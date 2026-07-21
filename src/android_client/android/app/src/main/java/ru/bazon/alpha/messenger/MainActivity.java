package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

import java.io.File;

/**
 * Основная activity. Загружает веб-клиент:
 * 1. Если есть кешированная версия в internal storage — загружает её (свежая)
 * 2. Иначе — bundled www/ (старая, но рабочая)
 *
 * В фоне проверяет обновления на сервере и скачивает новый бандл.
 * При следующем запуске будет загружена свежая версия.
 *
 * Capacitor bridge инжектируется автоматически для любого URL,
 * загружаемого через WebView (включая file://).
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

        // Регистрируем локальный плагин UnifiedPush (ДО super.onCreate)
        registerPlugin(UnifiedPushPlugin.class);

        super.onCreate(savedInstanceState);

        // Инжектируем URL сервера в localStorage ДО загрузки страницы,
        // чтобы getApiUrl() в config.ts прочитал правильный адрес.
        injectServerUrl(serverUrl);

        // Проверяем, есть ли кешированный веб-клиент
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheIndex = new File(updater.getCacheDir(), "index.html");

        if (cacheIndex.exists()) {
            // Загружаем кешированную версию (свежую)
            Log.d(TAG, "Loading cached web client: " + cacheIndex.getAbsolutePath());
            getBridge().getWebView().loadUrl("file://" + cacheIndex.getAbsolutePath());
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

    /**
     * Встраивает alpha.serverUrl в localStorage через evaluateJavascript.
     * Вызывается до/после загрузки страницы — localStorage персистентен
     * и будет доступен при инициализации React.
     */
    private void injectServerUrl(String serverUrl) {
        WebView webView = getBridge().getWebView();

        String escaped = serverUrl
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r");

        String js = "localStorage.setItem('alpha.serverUrl','" + escaped + "');";
        webView.evaluateJavascript(js, null);
    }
}
