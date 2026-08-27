package br.com.oceanolivre.kraken;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.app.Activity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private WebView webView;
    private static final String URL = "http://127.0.0.1:5000/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        // Marca própria no User-Agent - é como o app.js (rodando dentro do
        // WebView OU num navegador comum de quem entrou via QR/convite,
        // mesmo HTML/JS pros dois) sabe se já está no app instalado (pra
        // não mostrar o aviso de "baixar o app") ou se é um convidado sem
        // instalar nada (aí mostra).
        settings.setUserAgentString(settings.getUserAgentString() + " Kraken-App/" + BuildConfig.VERSION_CODE);
        // O servidor é sempre localhost e muda a cada atualização do app -
        // cache de HTTP aqui só serve pra mostrar tela antiga depois de
        // atualizar (visto em WebView de MIUI/Xiaomi). Sem custo real
        // desabilitar, é tudo loopback.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                              FileChooserParams fileChooserParams) {
                pendingFileCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // O WebView tem seu próprio modelo de permissão pra APIs web
                // (getUserMedia) além da permissão normal do Android - sem
                // liberar aqui, o gravador de áudio/câmera do chat nunca
                // consegue acessar o hardware mesmo com a permissão do
                // Android concedida.
                runOnUiThread(() -> {
                    List<String> granted = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                                && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                        == PackageManager.PERMISSION_GRANTED) {
                            granted.add(resource);
                        }
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                                && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                        == PackageManager.PERMISSION_GRANTED) {
                            granted.add(resource);
                        }
                    }
                    if (!granted.isEmpty()) {
                        request.grant(granted.toArray(new String[0]));
                    } else {
                        request.deny();
                    }
                });
            }
        });
        webView.setWebViewClient(new WebViewClient());

        requestAudioPermissionIfNeeded();
        requestCameraPermissionIfNeeded();

        Intent serviceIntent = new Intent(this, KrakenService.class);
        ContextCompat.startForegroundService(this, serviceIntent);

        waitForServerAndLoad();
        UpdateChecker.checkForUpdate(this);
    }

    private static final int AUDIO_PERMISSION_REQUEST = 4211;
    private static final int CAMERA_PERMISSION_REQUEST = 4212;

    private void requestAudioPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
        }
    }

    private void requestCameraPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private void waitForServerAndLoad() {
        new Thread(() -> {
            boolean up = false;
            for (int i = 0; i < 40 && !up; i++) {
                up = isServerUp();
                if (!up) {
                    try { Thread.sleep(300); } catch (InterruptedException ignored) {}
                }
            }
            boolean finalUp = up;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (finalUp) {
                    webView.loadUrl(URL);
                } else {
                    Toast.makeText(this, "Kraken demorou pra subir, tentando mesmo assim…", Toast.LENGTH_LONG).show();
                    webView.loadUrl(URL);
                }
            });
        }).start();
    }

    private boolean isServerUp() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(URL).openConnection();
            conn.setConnectTimeout(300);
            conn.setReadTimeout(300);
            int code = conn.getResponseCode();
            conn.disconnect();
            return code == 200;
        } catch (IOException e) {
            return false;
        }
    }

    private static final int FILE_CHOOSER_REQUEST = 4210;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (pendingFileCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
