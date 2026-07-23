package ru.bazon.alpha.messenger;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AlphaNotification",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class NotificationPlugin extends Plugin {

    private static final String CHANNEL_ID = "alpha_messages";

    @PluginMethod
    public void requestPermission(PluginCall call) {
        NotificationManager nm = (NotificationManager) getContext()
                .getSystemService(Context.NOTIFICATION_SERVICE);

        // Android 13+ — runtime permission POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) {
                resolveGranted(call);
                return;
            }
            requestPermissionForAlias("notifications", call, "handlePermissionResult");
            return;
        }

        // Android 12 и ниже — проверяем, включены ли уведомления для приложения
        if (nm.areNotificationsEnabled()) {
            resolveGranted(call);
        } else {
            // Открываем настройки уведомлений приложения
            Intent intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject res = new JSObject();
            res.put("granted", false);
            res.put("settingsOpened", true);
            call.resolve(res);
        }
    }

    @PermissionCallback
    private void handlePermissionResult(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        } else {
            NotificationManager nm = (NotificationManager) getContext()
                    .getSystemService(Context.NOTIFICATION_SERVICE);
            granted = nm.areNotificationsEnabled();
        }
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @PluginMethod
    public void showNotification(PluginCall call) {
        String title = call.getString("title", "Alpha Messenger");
        String body = call.getString("body", "");

        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        // Создаём канал
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
            if (ch == null) {
                ch = new NotificationChannel(CHANNEL_ID, "Сообщения", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Уведомления о новых сообщениях");
                nm.createNotificationChannel(ch);
            }
        }

        int id = (int) (System.currentTimeMillis() % 100000);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setLargeIcon(BitmapFactory.decodeResource(ctx.getResources(), R.mipmap.ic_launcher))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setSilent(true);

        android.content.Intent intent = ctx.getPackageManager()
                .getLaunchIntentForPackage(ctx.getPackageName());
        if (intent != null) {
            intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
            builder.setContentIntent(android.app.PendingIntent.getActivity(
                    ctx, id, intent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE));
        }

        nm.notify(id, builder.build());

        JSObject res = new JSObject();
        res.put("id", id);
        call.resolve(res);
    }

    private void resolveGranted(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", true);
        call.resolve(res);
    }
}
