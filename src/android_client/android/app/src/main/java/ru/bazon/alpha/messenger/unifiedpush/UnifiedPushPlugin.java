package ru.bazon.alpha.messenger.unifiedpush;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.unifiedpush.android.connector.UnifiedPush;

import java.util.List;

/**
 * Capacitor плагин для UnifiedPush.
 * Предоставляет JS- API для выбора дистрибьютора и регистрации.
 */
@CapacitorPlugin(name = "UnifiedPush")
public class UnifiedPushPlugin extends Plugin {

    private static final String TAG = "UnifiedPushPlugin";

    /**
     * Возвращает список доступных UP-дистрибьюторов.
     */
    @PluginMethod
    public void getDistributors(PluginCall call) {
        try {
            List<String> distributors = UnifiedPush.getDistributors(getActivity());
            JSObject result = new JSObject();
            result.put("distributors", distributors);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getDistributors failed", e);
            call.reject("Failed to get distributors: " + e.getMessage());
        }
    }

    /**
     * Устанавливает дистрибьютора.
     */
    @PluginMethod
    public void setDistributor(PluginCall call) {
        String distributor = call.getString("distributor");
        if (distributor == null || distributor.isEmpty()) {
            call.reject("Missing 'distributor' parameter");
            return;
        }
        try {
            UnifiedPush.setDistributor(getActivity(), distributor);
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "setDistributor failed", e);
            call.reject("Failed to set distributor: " + e.getMessage());
        }
    }

    /**
     * Регистрирует приложение у выбранного дистрибьютора.
     * Возвращает endpoint URL для отправки push-уведомлений.
     */
    @PluginMethod
    public void register(PluginCall call) {
        String topic = call.getString("topic");
        if (topic == null || topic.isEmpty()) {
            call.reject("Missing 'topic' parameter");
            return;
        }

        try {
            // Генерируем уникальный token для этого клиента
            String token = java.util.UUID.randomUUID().toString();

            // Регистрируемся — endpoint будет получен через callback
            UnifiedPush.registerApp(getActivity(), topic, token);

            // Возвращаем token (endpoint будет получен позже через WebSocket)
            JSObject result = new JSObject();
            result.put("token", token);
            result.put("registered", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "register failed", e);
            call.reject("Failed to register: " + e.getMessage());
        }
    }

    /**
     * Отменяет регистрацию у дистрибьютора.
     */
    @PluginMethod
    public void unregister(PluginCall call) {
        try {
            UnifiedPush.unregisterApp(getActivity());
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "unregister failed", e);
            call.reject("Failed to unregister: " + e.getMessage());
        }
    }

    /**
     * Возвращает текущий токен (если есть).
     */
    @PluginMethod
    public void getToken(PluginCall call) {
        // UnifiedPush хранит токен внутри библиотеки — нам нужно自己的 хранение
        // Используем SharedPreferences
        String token = getActivity()
                .getSharedPreferences("unifiedpush", android.content.Context.MODE_PRIVATE)
                .getString("token", null);

        JSObject result = new JSObject();
        result.put("token", token);
        call.resolve(result);
    }

    /**
     * Сохраняет токен (вызывается после получения endpoint).
     */
    @PluginMethod
    public void saveToken(PluginCall call) {
        String token = call.getString("token");
        String endpoint = call.getString("endpoint");

        if (token != null) {
            getActivity()
                    .getSharedPreferences("unifiedpush", android.content.Context.MODE_PRIVATE)
                    .edit()
                    .putString("token", token)
                    .putString("endpoint", endpoint)
                    .apply();
        }

        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }
}
