package ru.bazon.alpha.messenger;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Проверяет наличие обновлений веб-клиента на сервере и скачивает их.
 *
 * Поток обновления:
 * 1. GET /client/manifest.json — получаем версию и список файлов
 * 2. Сравниваем с кешированной версией (SharedPreferences)
 * 3. Если версия отличается — скачиваем все файлы из манифеста
 * 4. Сохраняем в getFilesDir()/web_client/
 * 5. Запоминаем версию в SharedPreferences
 *
 * Используется простой HttpURLConnection без доп. зависимостей.
 */
public class WebClientUpdater {

    private static final String TAG = "WebClientUpdater";
    private static final String PREFS_NAME = "alpha";
    private static final String KEY_CACHED_VERSION = "web_client_version";
    private static final String CACHE_DIR = "web_client";
    private static final int CONNECT_TIMEOUT = 10_000;
    private static final int READ_TIMEOUT = 30_000;

    private final Context context;
    private final String serverUrl;

    public WebClientUpdater(Context context, String serverUrl) {
        this.context = context;
        this.serverUrl = serverUrl;
    }

    /** Каталог кеша веб-клиента. */
    public File getCacheDir() {
        return new File(context.getFilesDir(), CACHE_DIR);
    }

    /** Версия в кеше (git hash) или null. */
    public String getCachedVersion() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_CACHED_VERSION, null);
    }

    /** Есть ли закешированный index.html. */
    public boolean hasCachedClient() {
        File index = new File(getCacheDir(), "index.html");
        return index.exists() && getCachedVersion() != null;
    }

    /** Проверяет наличие обновления и скачивает файлы. Вызывать из фонового потока. */
    public boolean checkAndUpdate() {
        try {
            JSONObject manifest = fetchManifest();
            if (manifest == null) return false;

            String serverVersion = manifest.getString("version");
            String cachedVersion = getCachedVersion();

            if (serverVersion.equals(cachedVersion)) {
                Log.d(TAG, "Web client up to date: " + serverVersion);
                return true;
            }

            Log.d(TAG, "Updating web client: " + cachedVersion + " → " + serverVersion);

            JSONArray files = manifest.getJSONArray("files");
            File cacheDir = getCacheDir();

            // Скачиваем все файлы во временную папку, потом перемещаем
            File tmpDir = new File(cacheDir, ".tmp_update");
            if (tmpDir.exists()) deleteRecursive(tmpDir);
            tmpDir.mkdirs();

            for (int i = 0; i < files.length(); i++) {
                String path = files.getString(i);
                if (!downloadFile(path, new File(tmpDir, path))) {
                    Log.w(TAG, "Failed to download: " + path);
                    deleteRecursive(tmpDir);
                    return false;
                }
            }

            // Удаляем старую версию
            if (cacheDir.exists()) deleteRecursive(cacheDir);

            // Переименовываем tmp → cache
            tmpDir.renameTo(cacheDir);

            // Запоминаем версию
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_CACHED_VERSION, serverVersion).apply();

            Log.d(TAG, "Web client updated to " + serverVersion + " (" + files.length() + " files)");
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Update failed", e);
            return false;
        }
    }

    private JSONObject fetchManifest() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + "/client/manifest.json");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);

            if (conn.getResponseCode() != 200) {
                Log.w(TAG, "Manifest fetch failed: " + conn.getResponseCode());
                return null;
            }

            String body = readStream(conn.getInputStream());
            return new JSONObject(body);
        } catch (Exception e) {
            Log.w(TAG, "Manifest fetch error", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean downloadFile(String path, File dest) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + "/client/" + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);

            if (conn.getResponseCode() != 200) return false;

            dest.getParentFile().mkdirs();
            InputStream is = conn.getInputStream();
            FileOutputStream fos = new FileOutputStream(dest);
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                fos.write(buf, 0, n);
            }
            fos.close();
            is.close();
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Download failed: " + path, e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readStream(InputStream is) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(is));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }
}
