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

        // Кеш есть — загружаем сразу
        if (cacheIndex.exists()) {
            Log.d(TAG, "Loading cached client");
            writeSettingsJs(serverUrl, cacheDir);
            webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
            // Фоновая проверка обновлений
            new Thread(() -> {
                try { updater.checkAndUpdate(); } catch (Exception e) { Log.e(TAG, "Update failed", e); }
            }).start();
            return;
        }

        // Кеша нет — показываем loading и скачиваем в фоне
        showLoading();

        new Thread(() -> {
            Log.d(TAG, "Downloading client in background...");
            boolean ok = updater.checkAndUpdate();
            Log.d(TAG, "Download result: " + ok);

            new Handler(Looper.getMainLooper()).post(() -> {
                if (cacheIndex.exists()) {
                    writeSettingsJs(serverUrl, cacheDir);
                    webView.loadUrl("file://" + cacheIndex.getAbsolutePath());
                } else {
                    // Fallback: грузим с сервера (bridge не будет работать)
                    Log.d(TAG, "Download failed, loading from server");
                    webView.loadUrl(serverUrl);
                }
            });
        }).start();
    }

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
