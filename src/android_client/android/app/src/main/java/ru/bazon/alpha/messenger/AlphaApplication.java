package ru.bazon.alpha.messenger;

import android.app.Application;
import android.util.Log;

public class AlphaApplication extends Application {
    private static final String TAG = "AlphaApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "=== Application.onCreate — process started, pid=" + android.os.Process.myPid());
    }
}
