package br.com.oceanolivre.kraken;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Verifica se há uma versão nova do Kraken publicada no GitHub Releases e,
 * se houver e o usuário aceitar, baixa e abre o instalador. Não faz nada
 * silenciosamente em segundo plano - sempre pergunta antes de baixar, e o
 * Android sempre exige o toque manual em "Instalar" (não dá pra pular isso).
 */
public class UpdateChecker {

    private static final String TAG = "UpdateChecker";
    private static final String RELEASES_API =
            "https://api.github.com/repos/ArvoreOS/kraken-chat/releases/latest";

    public static void checkForUpdate(Context context) {
        new Thread(() -> {
            try {
                int latestCode = -1;
                String downloadUrl = null;
                String tagName = null;

                HttpURLConnection conn = (HttpURLConnection) new URL(RELEASES_API).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                if (conn.getResponseCode() != 200) return;

                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                JSONObject release = new JSONObject(sb.toString());
                tagName = release.optString("tag_name", "");
                if (tagName.startsWith("v")) {
                    try {
                        latestCode = Integer.parseInt(tagName.substring(1));
                    } catch (NumberFormatException ignored) {
                    }
                }
                org.json.JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        if (asset.optString("name", "").endsWith(".apk")) {
                            downloadUrl = asset.optString("browser_download_url");
                            break;
                        }
                    }
                }

                if (latestCode <= BuildConfig.VERSION_CODE || downloadUrl == null) return;

                String finalDownloadUrl = downloadUrl;
                String finalTagName = tagName;
                if (context instanceof android.app.Activity) {
                    ((android.app.Activity) context).runOnUiThread(() ->
                            offerUpdate((android.app.Activity) context, finalTagName, finalDownloadUrl));
                }
            } catch (Exception e) {
                Log.e(TAG, "Falha ao checar atualização (provavelmente sem internet agora)", e);
            }
        }, "kraken-update-check").start();
    }

    private static void offerUpdate(android.app.Activity activity, String tagName, String downloadUrl) {
        new AlertDialog.Builder(activity)
                .setTitle("Nova versão do Kraken")
                .setMessage("Tem uma versão nova (" + tagName + ") disponível. Baixar agora?")
                .setPositiveButton("Baixar", (d, w) -> downloadAndInstall(activity, downloadUrl))
                .setNegativeButton("Depois", null)
                .show();
    }

    private static void downloadAndInstall(Context context, String url) {
        String fileName = "kraken-update.apk";
        File dest = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
        if (dest.exists()) dest.delete();

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("Kraken - baixando atualização");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationUri(Uri.fromFile(dest));

        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        long downloadId = dm.enqueue(request);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                context.unregisterReceiver(this);
                installApk(context, dest);
            }
        };
        context.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_EXPORTED);
    }

    private static void installApk(Context context, File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
                context, context.getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
