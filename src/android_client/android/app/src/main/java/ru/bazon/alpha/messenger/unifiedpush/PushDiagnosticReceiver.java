package ru.bazon.alpha.messenger.unifiedpush;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Diagnostic receiver with priority -400 (higher than MessagingReceiverImpl's -500).
 * Logs if the broadcast is delivered to our app at all.
 * Should be removed after diagnosing the push issue.
 */
public class PushDiagnosticReceiver extends BroadcastReceiver {
    private static final String TAG = "PushDiagnostic";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "=== Broadcast received! action=" + intent.getAction());
        Log.d(TAG, "Extras: token=" + intent.getStringExtra("token")
                + ", package=" + intent.getPackage());
    }
}
