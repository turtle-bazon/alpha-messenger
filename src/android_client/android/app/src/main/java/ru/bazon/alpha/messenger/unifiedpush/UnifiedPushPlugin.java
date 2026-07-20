package ru.bazon.alpha.messenger.unifiedpush;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import static org.unifiedpush.android.connector.ConstantsKt.INSTANCE_DEFAULT;

import org.unifiedpush.android.connector.UnifiedPush;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor плагин для UnifiedPush.
 * Предоставляет JS- API для выбора дистрибьютора и регистрации.
 */
@CapacitorPlugin(name = "UnifiedPush")
public class UnifiedPushPlugin extends Plugin {

    private static final String TAG = "UnifiedPushPlugin";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getDistributors(PluginCall call) {
        executor.execute(() -> {
            try {
                List<String> distributors = UnifiedPush.getDistributors(getActivity());
                JSObject result = new JSObject();
                result.put("distributors", distributors);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "getDistributors failed", e);
                call.reject("Failed to get distributors: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void saveDistributor(PluginCall call) {
        String distributor = call.getString("distributor");
        if (distributor == null || distributor.isEmpty()) {
            call.reject("Missing 'distributor' parameter");
            return;
        }
        try {
            UnifiedPush.saveDistributor(getActivity(), distributor);
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "saveDistributor failed", e);
            call.reject("Failed to save distributor: " + e.getMessage());
        }
    }

    @PluginMethod
    public void register(PluginCall call) {
        executor.execute(() -> {
            try {
                getActivity().getSharedPreferences("unifiedpush", Context.MODE_PRIVATE)
                        .edit().remove("endpoint").apply();

                UnifiedPush.register(
                        getActivity(),
                        INSTANCE_DEFAULT,
                        null,
                        null
                );

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "register failed", e);
                call.reject("Failed to register: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void waitForEndpoint(PluginCall call) {
        int timeoutMs = call.getInt("timeout", 15000);

        executor.execute(() -> {
            SharedPreferences prefs = getActivity()
                    .getSharedPreferences("unifiedpush", Context.MODE_PRIVATE);
            long start = System.currentTimeMillis();

            while (System.currentTimeMillis() - start < timeoutMs) {
                String endpoint = prefs.getString("endpoint", null);
                if (endpoint != null) {
                    JSObject result = new JSObject();
                    result.put("endpoint", endpoint);
                    call.resolve(result);
                    return;
                }
                try {
                    Thread.sleep(300);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    call.reject("Interrupted while waiting for endpoint");
                    return;
                }
            }

            call.reject("Timeout waiting for endpoint");
        });
    }

    @PluginMethod
    public void getEndpoint(PluginCall call) {
        try {
            SharedPreferences prefs = getActivity()
                    .getSharedPreferences("unifiedpush", Context.MODE_PRIVATE);
            String endpoint = prefs.getString("endpoint", null);
            JSObject result = new JSObject();
            result.put("endpoint", endpoint);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getEndpoint failed", e);
            call.reject("Failed to get endpoint: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unregister(PluginCall call) {
        executor.execute(() -> {
            try {
                UnifiedPush.unregister(getActivity(), INSTANCE_DEFAULT);

                getActivity().getSharedPreferences("unifiedpush", Context.MODE_PRIVATE)
                        .edit().clear().apply();

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "unregister failed", e);
                call.reject("Failed to unregister: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getAckDistributor(PluginCall call) {
        try {
            String distributor = UnifiedPush.getAckDistributor(getActivity());
            JSObject result = new JSObject();
            result.put("distributor", distributor);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getAckDistributor failed", e);
            call.reject("Failed to get distributor: " + e.getMessage());
        }
    }
}
