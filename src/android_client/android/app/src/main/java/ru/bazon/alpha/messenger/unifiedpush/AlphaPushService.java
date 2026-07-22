package ru.bazon.alpha.messenger.unifiedpush;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

/**
 * Сервис для получения push-событий от UnifiedPush дистрибьютора.
 * Дистрибьютор вызывает этот сервис когда registration готов.
 */
public class AlphaPushService extends PushService {

    private static final String TAG = "AlphaPushService";

    @Override
    public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        Log.d(TAG, "onNewEndpoint: " + endpoint.getUrl() + " instance=" + instance);

        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences("unifiedpush", Context.MODE_PRIVATE);
        prefs.edit()
                .putString("endpoint", endpoint.getUrl())
                .putString("instance", instance)
                .apply();
        Log.d(TAG, "Endpoint saved to SharedPreferences");
    }

    @Override
    public void onUnregistered(String instance) {
        Log.d(TAG, "Unregistered: instance=" + instance);

        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences("unifiedpush", Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
    }

    @Override
    public void onRegistrationFailed(FailedReason reason, String instance) {
        Log.e(TAG, "onRegistrationFailed: reason=" + reason + " instance=" + instance);
    }

    @Override
    public void onMessage(PushMessage message, String instance) {
        Log.d(TAG, "onMessage: instance=" + instance + " messageId=" + message.getMessageId());
    }
}
