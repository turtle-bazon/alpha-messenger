package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import ru.bazon.alpha.messenger.unifiedpush.UnifiedPushPlugin;

/**
 * Основная activity. Инициализирует Capacitor WebView и загружает
 * web-клиент с сервера (URL из SharedPreferences).
 *
 * Если URL не сохранён — запускает SetupActivity (нативный экран настройки).
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

        runOnUiThread(() -> getBridge().getWebView().loadUrl(serverUrl));
    }
}
