package ru.bazon.alpha.messenger.unifiedpush;

import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads per-chat notification settings from SharedPreferences.
 *
 * SharedPreferences file: "alpha_notifications"
 *
 * Structure:
 *   "settings" — JSON string with the full settings tree:
 *   {
 *     "default": { "enabled": true, "sound": "default", "vibrate": true },
 *     "chats": {
 *       "<chatId>": { "enabled": false },
 *       "<chatId2>": { "sound": "silent" },
 *       "<chatId3>": { "sound": "content://...", "vibrate": false }
 *     }
 *   }
 *
 * Sound values:
 *   "default"  — system default notification sound
 *   "silent"   — no sound
 *   "<uri>"    — custom sound URI string
 *
 * Chat-level keys that are absent fall back to the "default" block.
 */
public class NotificationSettingsHelper {

    private static final String TAG = "NotifSettingsHelper";
    private static final String PREFS_NAME = "alpha_notifications";
    private static final String KEY_SETTINGS = "settings";

    private static final String CHANNEL_PREFIX = "chat_";

    private final Context context;
    private final JSONObject settings;

    public NotificationSettingsHelper(Context context) {
        this.context = context;
        this.settings = loadSettings();
    }

    /**
     * Returns the notification channel ID to use for the given chatId.
     * Creates the channel if it doesn't exist yet.
     */
    public String getChannelForChat(NotificationManager nm, String chatId) {
        if (chatId == null || chatId.isEmpty()) {
            ensureDefaultChannel(nm);
            return AlphaPushService.CHANNEL_ID;
        }

        String channelId = CHANNEL_PREFIX + chatId;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(channelId) == null) {
                JSONObject chatSettings = getChatSettings(chatId);
                String sound = chatSettings.optString("sound", "default");
                boolean vibrate = chatSettings.optBoolean("vibrate", true);

                NotificationChannel channel = new NotificationChannel(
                        channelId,
                        "Сообщения",  // user-visible name overridden by Android
                        NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Уведомления для чата");

                if ("silent".equals(sound)) {
                    channel.setSound(null, null);
                    channel.enableVibration(vibrate);
                } else if ("default".equals(sound)) {
                    Uri defaultUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
                    channel.setSound(defaultUri, attrs);
                    channel.enableVibration(vibrate);
                } else {
                    Uri customUri = Uri.parse(sound);
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
                    channel.setSound(customUri, attrs);
                    channel.enableVibration(vibrate);
                }

                nm.createNotificationChannel(channel);
                Log.d(TAG, "Created channel " + channelId + " sound=" + sound + " vibrate=" + vibrate);
            }
        }

        return channelId;
    }

    /**
     * Returns true if notifications are enabled for the given chatId.
     */
    public boolean isEnabled(String chatId) {
        JSONObject chatSettings = getChatSettings(chatId);
        return chatSettings.optBoolean("enabled", true);
    }

    /**
     * Ensures the default (non-chat) channel exists.
     * Also handles one-time migration: deletes old channel with custom sound.
     */
    public void ensureDefaultChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            NotificationChannel existing = nm.getNotificationChannel(AlphaPushService.CHANNEL_ID);
            if (existing != null && !prefs.getBoolean("channel_recreated_v1", false)) {
                Log.d(TAG, "Deleting old channel to reset notification sound");
                nm.deleteNotificationChannel(AlphaPushService.CHANNEL_ID);
                existing = null;
            }

            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                        AlphaPushService.CHANNEL_ID,
                        "Сообщения",
                        NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Уведомления о новых сообщениях");
                nm.createNotificationChannel(channel);
                prefs.edit().putBoolean("channel_recreated_v1", true).apply();
                Log.d(TAG, "Created fresh default channel with system sound");
            }
        }
    }

    private JSONObject getChatSettings(String chatId) {
        try {
            JSONObject chats = settings.optJSONObject("chats");
            if (chats != null && chats.has(chatId)) {
                return chats.getJSONObject(chatId);
            }
        } catch (JSONException e) {
            Log.e(TAG, "Error reading chat settings", e);
        }
        // Fall back to defaults
        return settings.optJSONObject("default");
    }

    private JSONObject loadSettings() {
        try {
            String json = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getString(KEY_SETTINGS, null);
            if (json != null) {
                return new JSONObject(json);
            }
        } catch (JSONException e) {
            Log.e(TAG, "Failed to parse settings", e);
        }
        // Return sensible defaults
        try {
            JSONObject defaults = new JSONObject();
            defaults.put("default", new JSONObject()
                    .put("enabled", true)
                    .put("sound", "default")
                    .put("vibrate", true));
            defaults.put("chats", new JSONObject());
            return defaults;
        } catch (JSONException e) {
            throw new RuntimeException(e);
        }
    }
}
