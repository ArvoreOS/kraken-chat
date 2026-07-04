package br.com.oceanolivre.kraken;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

public class KrakenService extends Service {

    private static final String CHANNEL_ID = "kraken_channel";
    private static final String TAG = "KrakenService";
    private static boolean pythonServerStarted = false;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(1, buildNotification());
        acquireLocks();
        startPythonServerOnce();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireLocks() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Kraken::ServerWakeLock");
        wakeLock.acquire();

        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Kraken::WifiLock");
        wifiLock.acquire();
    }

    private synchronized void startPythonServerOnce() {
        if (pythonServerStarted) return;
        pythonServerStarted = true;

        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(getApplicationContext()));
        }
        String dataDir = getFilesDir().getAbsolutePath() + "/kraken_data";
        String deviceIp = getDeviceIp();
        Thread thread = new Thread(() -> {
            try {
                Python py = Python.getInstance();
                PyObject serverModule = py.getModule("server");
                serverModule.callAttr("configure_data_dir", dataDir);
                serverModule.callAttr("set_device_ip", deviceIp);
                serverModule.callAttr("start_server");
            } catch (Throwable t) {
                // Nunca deixa um erro do lado Python derrubar o app inteiro.
                Log.e(TAG, "Servidor Python caiu, tentando de novo em 3s", t);
                pythonServerStarted = false;
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                        this::startPythonServerOnce, 3000);
            }
        }, "kraken-python-server");
        thread.setUncaughtExceptionHandler((t, e) ->
                Log.e(TAG, "Uncaught no thread do servidor Python", e));
        thread.start();
    }

    /** IP local de verdade (WiFi/hotspot) via API do Android - mais confiável
     * do que descobrir por dentro do Python no sandbox de rede do app. */
    private String getDeviceIp() {
        try {
            android.net.ConnectivityManager cm =
                    (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.Network network = cm.getActiveNetwork();
            if (network != null) {
                android.net.LinkProperties props = cm.getLinkProperties(network);
                if (props != null) {
                    for (android.net.LinkAddress addr : props.getLinkAddresses()) {
                        java.net.InetAddress inet = addr.getAddress();
                        if (inet instanceof java.net.Inet4Address && !inet.isLoopbackAddress()) {
                            return inet.getHostAddress();
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Falha ao obter IP via ConnectivityManager", e);
        }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int ip = wm.getConnectionInfo().getIpAddress();
            if (ip != 0) {
                return Formatter.formatIpAddress(ip);
            }
        } catch (Exception e) {
            Log.e(TAG, "Falha ao obter IP via WifiManager", e);
        }
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Kraken", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantém o Kraken rodando em segundo plano");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
                this, 0, openIntent,
                android.app.PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Kraken")
                .setContentText("Rodando em segundo plano — chat sempre disponível")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
    }
}
