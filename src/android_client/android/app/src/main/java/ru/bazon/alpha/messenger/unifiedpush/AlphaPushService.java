package ru.bazon.alpha.messenger.unifiedpush;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

import ru.bazon.alpha.messenger.MainActivity;
import ru.bazon.alpha.messenger.R;

public class AlphaPushService extends PushService {

    private static final String TAG = "AlphaPushService";
    static final String CHANNEL_ID = "alpha_messages";
    private static int notificationId = 0;

    static {
        Log.d(TAG, "=== AlphaPushService class loaded ===");
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "=== AlphaPushService onCreate ===");
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "=== AlphaPushService onDestroy ===");
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "=== AlphaPushService onStartCommand intent=" + intent + " flags=" + flags + " startId=" + startId);
        return super.onStartCommand(intent, flags, startId);
    }

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
        Log.d(TAG, "=== onMessage called === instance=" + instance);
        String content = new String(message.getContent());
        Log.d(TAG, "Message content: " + content);

        String chatId = null;
        try {
            org.json.JSONObject json = new org.json.JSONObject(content);
            chatId = json.optString("chatId", null);
        } catch (Exception e) {
            Log.d(TAG, "No chatId in message, using default channel");
        }

        showNotification(chatId);
    }

    private void showNotification(String chatId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationSettingsHelper settings = new NotificationSettingsHelper(this);

        if (chatId != null && !settings.isEnabled(chatId)) {
            Log.d(TAG, "Notifications disabled for chat " + chatId + ", skipping");
            return;
        }

        String channelId = settings.getChannelForChat(nm, chatId);

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Alpha Messenger")
                .setContentText("Новое сообщение")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);

        nm.notify(notificationId++, builder.build());
        Log.d(TAG, "Notification shown on channel=" + channelId);
    }

}
