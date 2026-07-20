package ru.bazon.alpha.messenger.unifiedpush;

import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.unifiedpush.android.connector.PushService;

/**
 * Сервис для получения push-событий от UnifiedPush дистрибьютора.
 * Дистрибьютор вызывает этот сервис когда registration готов.
 */
public class AlphaPushService extends PushService {

    private static final String TAG = "AlphaPushService";

    @Override
    protected void onNewEndpoint(String endpoint, String instance) {
        Log.d(TAG, "New endpoint: " + endpoint + " (instance=" + instance + ")");

        // Сохраняем endpoint в SharedPreferences чтобы JavaScript мог его забрать
        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences("unifiedpush", MODE_PRIVATE);
        prefs.edit()
                .putString("endpoint", endpoint)
                .putString("instance", instance)
                .apply();

        // Уведомляем JavaScript что endpoint готов
        Intent intent = new Intent("ru.bazon.alpha.messenger.UP_ENDPOINT");
        intent.putExtra("endpoint", endpoint);
        intent.putExtra("instance", instance);
        getApplicationContext().sendBroadcast(intent);
    }

    @Override
    protected void onUnregistered(String instance) {
        Log.d(TAG, "Unregistered: instance=" + instance);

        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences("unifiedpush", MODE_PRIVATE);
        prefs.edit().clear().apply();
    }

    @Override
    protected void onRegistrationFailed(String instance) {
        Log.e(TAG, "Registration failed: instance=" + instance);
    }

    @Override
    protected void onRegistrationRefused(String instance) {
        Log.e(TAG, "Registration refused: instance=" + instance);
    }
}
