package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

/**
 * Основная activity. Загружает bundled веб-клиент (www/).
 * URL сервера передаётся в localStorage через evaluateJavascript
 * до инициализации React (getApiUrl() читает alpha.serverUrl).
 */
public class MainActivity extends BridgeActivity {

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

        // Встраиваем URL сервера в localStorage bundled клиента.
        // WebViewClient.onPageFinished выполняется ПОСЛЕ загрузки DOM, но
        // React читает getApiUrl() в useState initializer — к этому моменту
        // localStorage уже должен быть заполнен.
        injectServerUrl(serverUrl);
    }

    private void injectServerUrl(String serverUrl) {
        WebView webView = getBridge().getWebView();

        // Сохраняем оригинальный WebViewClient
        WebViewClient originalClient = new WebViewClient();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);

                String escaped = serverUrl
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r");

                String js = "localStorage.setItem('alpha.serverUrl','" + escaped + "');";
                view.evaluateJavascript(js, value -> {
                    // Если React уже прочитал неверный URL — перезагружаем
                    Boolean needsReload = Boolean.parseBoolean(
                        view.evaluateJavascript(
                            "JSON.stringify(localStorage.getItem('alpha.serverUrl') !== '" + escaped + "')",
                            null
                        )
                    );
                    if (Boolean.TRUE.equals(needsReload)) {
                        view.reload();
                    }
                });

                // Восстанавливаем оригинальный клиент
                view.setWebViewClient(originalClient);
            }
        });
    }
}
