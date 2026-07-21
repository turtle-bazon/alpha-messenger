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
            Log.d(TAG, "No serverUrl → SetupActivity");
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        registerPlugin(UnifiedPushPlugin.class);
        super.onCreate(savedInstanceState);

        // Проверяем, есть ли кешированный веб-клиент
        WebClientUpdater updater = new WebClientUpdater(this, serverUrl);
        File cacheIndex = new File(updater.getCacheDir(), "index.html");
        String targetUrl;
        if (cacheIndex.exists()) {
            targetUrl = "file://" + cacheIndex.getAbsolutePath();
            Log.d(TAG, "Loading cached client: " + targetUrl);
        } else {
            targetUrl = null;
            Log.d(TAG, "No cached client, will reload bundled www/");
        }

        WebView webView = getBridge().getWebView();
        String escaped = serverUrl
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r");

        String js = "localStorage.setItem('alpha.serverUrl','" + escaped + "');";
        Log.d(TAG, "evaluateJavascript: " + js);
        webView.evaluateJavascript(js, value -> {
            Log.d(TAG, "evaluateJavascript callback, value=" + value);
            // Проверяем что записалось
            webView.evaluateJavascript("localStorage.getItem('alpha.serverUrl')", v -> {
                Log.d(TAG, "localStorage verify=" + v);
            });
            if (targetUrl != null) {
                webView.loadUrl(targetUrl);
            } else {
                webView.reload();
            }
        });

        new Thread(() -> {
            try {
                updater.checkAndUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Background update check failed", e);
            }
        }).start();
    }
}
