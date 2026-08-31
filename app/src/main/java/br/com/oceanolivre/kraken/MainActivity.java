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
    private static final int WEB_PERMISSION_REQUEST = 4213;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Debug remoto via chrome://inspect no PC (cabo USB + Depuração USB
        // ligada no celular) - achado real 2026-08-31: até aqui não tinha
        // como ver o console/DevTools de verdade do WebView rodando dentro
        // do app, só o texto de alert()/confirm() - isso escondia o erro
        // técnico completo em vários bugs investigados essa semana. Só em
        // build debug (BuildConfig.DEBUG) - nunca em release, por segurança
        // (exporia o conteúdo do WebView pra qualquer um com acesso USB).
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

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

                // Achado real (2026-08-27): o atributo HTML "capture" funciona
                // bem pra foto/vídeo (abre a câmera direto), mas pra áudio o
                // Chromium/WebView não tem esse mapeamento confiável em todo
                // aparelho - testado no Kraken e caiu no seletor de
                // arquivo/pastas comum em vez de abrir o gravador de som.
                // Corrigido detectando esse caso na mão e disparando o intent
                // nativo de gravação de som (RECORD_SOUND_ACTION) direto, sem
                // depender do Chromium adivinhar certo.
                boolean querAudio = false;
                for (String tipo : fileChooserParams.getAcceptTypes()) {
                    if (tipo != null && tipo.startsWith("audio/")) {
                        querAudio = true;
                        break;
                    }
                }
                if (fileChooserParams.isCaptureEnabled() && querAudio) {
                    Intent gravador = new Intent(android.provider.MediaStore.Audio.Media.RECORD_SOUND_ACTION);
                    try {
                        startActivityForResult(gravador, FILE_CHOOSER_REQUEST);
                        return true;
                    } catch (Exception e) {
                        // Nenhum app de gravar som instalado que atenda esse
                        // intent - cai pro seletor de arquivo comum abaixo.
                    }
                }

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
                    List<String> androidPermsFaltando = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                    == PackageManager.PERMISSION_GRANTED) {
                                granted.add(resource);
                            } else {
                                androidPermsFaltando.add(Manifest.permission.RECORD_AUDIO);
                            }
                        }
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                    == PackageManager.PERMISSION_GRANTED) {
                                granted.add(resource);
                            } else {
                                androidPermsFaltando.add(Manifest.permission.CAMERA);
                            }
                        }
                    }
                    if (androidPermsFaltando.isEmpty()) {
                        // Tudo que foi pedido já estava liberado no Android -
                        // caminho de sempre, sem novidade.
                        if (!granted.isEmpty()) {
                            request.grant(granted.toArray(new String[0]));
                        } else {
                            request.deny();
                        }
                        return;
                    }
                    // Achado real (2026-08-27): antes disso, se a permissão do
                    // Android não tinha sido concedida na hora de abrir o app
                    // (onCreate), nunca mais existia outra chance de pedir -
                    // negava pra sempre, mesmo clicando em "Live" de novo.
                    // Agora pede o pedido de verdade do Android bem na hora
                    // que o recurso é usado (ex: botão Live), guarda esse
                    // pedido do WebView pendente, e completa ele em
                    // onRequestPermissionsResult quando a pessoa responder.
                    pendingWebPermissionRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            androidPermsFaltando.toArray(new String[0]), WEB_PERMISSION_REQUEST);
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
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != WEB_PERMISSION_REQUEST || pendingWebPermissionRequest == null) return;
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        List<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                granted.add(resource);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                granted.add(resource);
            }
        }
        if (!granted.isEmpty()) {
            request.grant(granted.toArray(new String[0]));
        } else {
            request.deny();
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
