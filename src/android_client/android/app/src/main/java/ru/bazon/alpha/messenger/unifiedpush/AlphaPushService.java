package ru.bazon.alpha.messenger.unifiedpush;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
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
    private static final String CHANNEL_ID = "alpha_messages";
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
        Log.d(TAG, "Message content: " + new String(message.getContent()));

        showNotification();
    }

    private void showNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        createChannel(nm);

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Alpha Messenger")
                .setContentText("Новое сообщение")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);

        nm.notify(notificationId++, builder.build());
        Log.d(TAG, "Notification shown");
    }

    private void createChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Сообщения",
                        NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Уведомления о новых сообщениях");
                nm.createNotificationChannel(channel);
            }
        }
    }
}
