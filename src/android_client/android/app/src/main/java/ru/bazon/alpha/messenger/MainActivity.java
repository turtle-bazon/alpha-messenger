package ru.bazon.alpha.messenger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
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
        File cacheDir = updater.getCacheDir();
        File cacheIndex = new File(cacheDir, "index.html");

        // Показываем loading-экран пока скачиваем клиент
        showLoading();

        // Скачиваем клиент синхронно (блокирует main thread, но это
        // необходимо чтобы кеш был готов ДО загрузки WebView).
        // Без этого загрузка с сервера ломает Capacitor bridge.
        if (!cacheIndex.exists()) {
            Log.d(TAG, "No cached client, downloading...");
            boolean ok = updater.checkAndUpdate();
            Log.d(TAG, "Download result: " + ok);
        }

        // Пишем settings.js в ту же папку что и index.html
        writeSettingsJs(serverUrl, cacheDir);

        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client");
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
        } else {
            // Fallback: грузим с сервера (bridge не будет работать, но логин доступен)
            Log.d(TAG, "Cache missing, falling back to server URL");
            webView.loadUrl(serverUrl);
        }

        // Фоновая проверка обновлений
        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update failed", e);
            }
        }).start();
    }

    /** Показывает простой loading-экран поверх WebView пока скачивается клиент. */
    private void showLoading() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(0xFF1A1A2E);

        ProgressBar bar = new ProgressBar(this);
        root.addView(bar);

        TextView text = new TextView(this);
        text.setText("Загрузка...");
        text.setTextColor(0xFFAAAAAA);
        text.setTextSize(14);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (16 * getResources().getDisplayMetrics().density);
        root.addView(text, lp);

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
