(function () {
  // ✅ RESTAURADO (2026-09-07) - chave de API pras rotas de escrita
  // (/api/send*, /api/upload, /api/send_gift_message), achado que tinha
  // sumido do código numa avaliação de segurança pedida pelo Gilcimar
  // (confirmado ao vivo: dava pra postar mensagem forjada sem
  // credencial nenhuma). Vem embutida na própria página pela rota "/" -
  // vazia em Android/PC locais (nunca tiveram essa checagem), só tem
  // valor de verdade quando servida pelo nó-semente de internet.
  const KRAKEN_KEY = (document.querySelector('meta[name="kraken-key"]') || {}).content || "";
  function krakenKeyHeaders() {
    return KRAKEN_KEY ? { "X-Kraken-Key": KRAKEN_KEY } : {};
  }
  // /debug é aberto navegando direto (sem cabeçalho custom possível) -
  // leva a chave por query string quando existir (checklist de
  // segurança 2026-09-07 item 4).
  if (KRAKEN_KEY) {
    document.addEventListener("DOMContentLoaded", () => {
      const link = document.getElementById("btn-debug-link");
      if (link) link.href = "/debug?key=" + encodeURIComponent(KRAKEN_KEY);
    });
  }

  // Captura de erro do próprio motor (2026-09-07, pedido do Gilcimar: "não
  // tem como criar debug pra mostrar o que está com erro?"). Guarda em
  // localStorage (sobrevive a reload/crash) pra aparecer na página 🩺
  // /debug, sem precisar de console remoto nenhum - só abrir a página no
  // próprio celular. Registrado o mais cedo possível no arquivo, antes de
  // qualquer outro código que possa falhar.
  const JS_ERROR_KEY = "kraken_js_errors";
  function logClientError(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(JS_ERROR_KEY) || "[]");
      arr.push({ t: new Date().toISOString(), ...entry });
      while (arr.length > 30) arr.shift();
      localStorage.setItem(JS_ERROR_KEY, JSON.stringify(arr));
    } catch (e) {
      // localStorage indisponível - não tem onde guardar, ignora
    }
  }
  window.addEventListener("error", (e) => {
    logClientError({ tipo: "error", msg: e.message, origem: (e.filename || "") + ":" + e.lineno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const msg = reason && reason.message ? reason.message : String(reason);
    logClientError({ tipo: "promise rejeitada sem tratamento", msg });
  });

  const STORAGE_NAME = "kraken_name";
  const STORAGE_ID = "kraken_sender_id";
  // Marca separada de "fez login de verdade" - versões antigas (antes do
  // login existir) já deixavam kraken_name gravado com o nome livre de
  // sempre, e atualizar o app NUNCA limpa o localStorage (mesma origem
  // 127.0.0.1:5000 em toda versão). Sem essa marca própria, quem já tinha
  // testado o Kraken antes nunca via a tela de login nova - pulava direto
  // pro chat com o nome antigo, achando que sumiu sozinha. Achado real
  // reportado pelo Gilcimar.
  const STORAGE_LOGGED_IN = "kraken_logged_in";
  // Token da carteira Exaguinon (Estágio 1, 2026-09-07) - gerado pelo
  // nó-semente no login/cadastro, guardado aqui pra não precisar pedir
  // e-mail/senha de novo toda vez que a pessoa quiser presentear.
  const STORAGE_WALLET_TOKEN = "kraken_wallet_token";
  // Foto de perfil vinculada à conta (checklist 2026-09-07, item 6) -
  // guarda só o ID aqui, os bytes de verdade ficam só no nó-semente.
  const STORAGE_FOTO_ID = "kraken_foto_id";

  const nameScreen = document.getElementById("name-screen");
  const chatScreen = document.getElementById("chat-screen");
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginName = document.getElementById("login-name");
  const loginError = document.getElementById("login-error");
  const loginSubmit = document.getElementById("login-submit");
  const loginToggleMode = document.getElementById("login-toggle-mode");
  const loginForgotPassword = document.getElementById("login-forgot-password");
  const loginTagline = document.getElementById("login-tagline");
  const messagesEl = document.getElementById("messages");
  const sendForm = document.getElementById("send-form");
  const textInput = document.getElementById("text-input");
  const fileInput = document.getElementById("file-input");
  const audioCaptureInput = document.getElementById("audio-capture-input");
  const recordBtn = document.getElementById("record-btn");
  const recordBar = document.getElementById("record-bar");
  const recordWave = document.getElementById("record-wave");
  const recordTimer = document.getElementById("record-timer");
  const recordCancelBtn = document.getElementById("record-cancel");
  const recordStopBtn = document.getElementById("record-stop");
  const previewBar = document.getElementById("preview-bar");
  const previewAudio = document.getElementById("preview-audio");
  const previewCancelBtn = document.getElementById("preview-cancel");
  const previewSendBtn = document.getElementById("preview-send");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const tabsEl = document.getElementById("tabs");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalContent = document.getElementById("modal-content");
  const appBanner = document.getElementById("app-banner");
  const appBannerDownload = document.getElementById("app-banner-download");
  const appBannerDismiss = document.getElementById("app-banner-dismiss");

  // ---------- perfil / galeria (2026-08-31) ----------
  const btnAvatar = document.getElementById("btn-avatar");
  const profileScreen = document.getElementById("profile-screen");
  const profileBack = document.getElementById("profile-back");
  const profileAvatarBig = document.getElementById("profile-avatar-big");
  const profileFotoInput = document.getElementById("profile-foto-input");
  const profileNameEl = document.getElementById("profile-name");
  const profileModeBadge = document.getElementById("profile-mode-badge");
  const profileModeBadgeText = document.getElementById("profile-mode-badge-text");
  const profileStats = document.getElementById("profile-stats");
  const profileTabs = document.querySelectorAll(".profile-tab");
  const profileTabGaleria = document.getElementById("profile-tab-galeria");
  const profileTabSobre = document.getElementById("profile-tab-sobre");
  const galleryGrid = document.getElementById("gallery-grid");
  const aboutName = document.getElementById("about-name");
  const aboutNodeId = document.getElementById("about-node-id");
  const btn2faToggle = document.getElementById("btn-2fa-toggle");
  const profile2faSection = document.getElementById("profile-2fa-section");
  const mediaViewer = document.getElementById("media-viewer");
  const mediaViewerClose = document.getElementById("media-viewer-close");
  const mediaViewerContent = document.getElementById("media-viewer-content");

  // Parâmetros de URL só para simulação/teste (?demo_name=Ana&demo_id=phoneA).
  // Não afetam o uso normal, que continua guardando tudo em localStorage.
  const demoParams = new URLSearchParams(location.search);
  const demoName = demoParams.get("demo_name");
  const demoId = demoParams.get("demo_id");

  let messagesCache = []; // todas as mensagens carregadas/recebidas nesta sessão
  let groupsCache = [];
  let currentConv = { type: "global" };

  function senderId() {
    if (demoId) return demoId;
    let id = localStorage.getItem(STORAGE_ID);
    if (!id) {
      id = "u" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(STORAGE_ID, id);
    }
    return id;
  }

  function myName() {
    if (demoName) return demoName;
    return localStorage.getItem(STORAGE_NAME);
  }

  function fmtTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // ---------- aviso "baixar o app" pra quem entra pelo navegador comum ----------
  // O app instalado marca o próprio User-Agent com "Kraken-App" (ver
  // MainActivity.java) - quem abriu pelo navegador normal (ex: escaneou o
  // QR do /join e nunca instalou nada) não tem essa marca, então mostra o
  // aviso. Lembra se a pessoa já dispensou, pra não ficar repetindo toda
  // vez que ela voltar nesse mesmo navegador.
  const STORAGE_BANNER_DISMISSED = "kraken_banner_dismissed";

  function maybeShowAppBanner() {
    if (navigator.userAgent.includes("Kraken-App")) return; // já é o app instalado
    if (localStorage.getItem(STORAGE_BANNER_DISMISSED)) return;
    const isAndroid = /Android/i.test(navigator.userAgent);
    appBannerDownload.href = isAndroid
      ? "https://github.com/ArvoreOS/kraken-chat/releases/latest/download/app-debug.apk"
      : "https://github.com/ArvoreOS/kraken-chat/releases/latest/download/Kraken.exe";
    appBanner.classList.remove("hidden");
  }
  appBannerDismiss.addEventListener("click", () => {
    localStorage.setItem(STORAGE_BANNER_DISMISSED, "1");
    appBanner.classList.add("hidden");
  });

  // ---------- modal genérico ----------
  function openModal(html) {
    modalContent.innerHTML = html;
    modalOverlay.classList.remove("hidden");
  }
  function closeModal() {
    modalOverlay.classList.add("hidden");
    modalContent.innerHTML = "";
  }
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ---------- chamada de vídeo (WebRTC P2P) ----------
  // O servidor só repassa a "sinalização" (oferta/resposta SDP) - o vídeo
  // em si nunca passa por ele, vai direto de celular pra celular. Sem ICE
  // "trickle": espera juntar os candidatos ANTES de mandar a oferta/
  // resposta, pra não precisar de um segundo canal de tempo real só pra
  // isso - mais simples, custa só um pouco de atraso na hora de conectar.
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  const callScreen = document.getElementById("call-screen");
  const callRemoteVideo = document.getElementById("call-remote-video");
  const callLocalVideo = document.getElementById("call-local-video");
  const callStatusText = document.getElementById("call-status-text");
  const callAcceptBtn = document.getElementById("call-accept-btn");
  const callRejectBtn = document.getElementById("call-reject-btn");
  const callHangupBtn = document.getElementById("call-hangup-btn");
  const callMuteBtn = document.getElementById("call-mute-btn");
  const callSwitchCamBtn = document.getElementById("call-switch-cam-btn");
  const btnCall = document.getElementById("btn-call");
  const btnGift = document.getElementById("btn-gift");
  const btnBroadcast = document.getElementById("btn-broadcast");
  const btnGroupInvite = document.getElementById("btn-group-invite");
  const liveScreen = document.getElementById("live-screen");
  const liveVideo = document.getElementById("live-video");
  const liveStatusText = document.getElementById("live-status-text");
  const mosaicScreen = document.getElementById("mosaic-screen");
  const mosaicGrid = document.getElementById("mosaic-grid");
  const mosaicSizeLabel = document.getElementById("mosaic-size-label");
  const mosaicSizeMinus = document.getElementById("mosaic-size-minus");
  const mosaicSizePlus = document.getElementById("mosaic-size-plus");
  const mosaicCloseBtn = document.getElementById("mosaic-close-btn");
  const liveStopBtn = document.getElementById("live-stop-btn");
  const liveSwitchCamBtn = document.getElementById("live-switch-cam-btn");

  let callState = null; // {call_id, role, pc, localStream, peer:{id,name,via,ip?,port?}, pendingOffer?}
  let myNodeId = null;
  let seedHttpUrl = null;

  function callReset() {
    if (callState && callState.pc) {
      try { callState.pc.close(); } catch (e) {}
    }
    if (callState && callState.localStream) {
      callState.localStream.getTracks().forEach((t) => t.stop());
    }
    callState = null;
    callScreen.classList.add("hidden");
    callRemoteVideo.srcObject = null;
    callRemoteVideo.classList.add("esperando");
    callLocalVideo.srcObject = null;
    callAcceptBtn.classList.add("hidden");
    callRejectBtn.classList.add("hidden");
    callHangupBtn.classList.add("hidden");
    callMuteBtn.classList.add("hidden");
    callMuteBtn.classList.remove("muted");
    callMuteBtn.textContent = "🎤";
    callSwitchCamBtn.classList.add("hidden");
    callSwitchCamBtn.disabled = false;
  }

  // Mostra o botão de mutar só quando existe uma faixa de áudio de verdade
  // pra controlar - numa chamada que caiu no modo "só vídeo" (microfone
  // ocupado por outro app), não tem o que mutar.
  function updateMuteBtnVisibility() {
    const hasAudio = callState && callState.localStream && callState.localStream.getAudioTracks().length > 0;
    callMuteBtn.classList.toggle("hidden", !hasAudio);
  }
  callMuteBtn.addEventListener("click", () => {
    if (!callState || !callState.localStream) return;
    const tracks = callState.localStream.getAudioTracks();
    if (tracks.length === 0) return;
    const novoEstado = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = novoEstado));
    callMuteBtn.classList.toggle("muted", !novoEstado);
    callMuteBtn.textContent = novoEstado ? "🎤" : "🔇";
  });

  // Mostra o botão de trocar câmera só quando existe uma faixa de vídeo
  // de verdade pra trocar (ex: se a câmera nem abriu, a chamada já teria
  // sido abortada antes de chegar aqui, então isso cobre o caso normal).
  function updateSwitchCamBtnVisibility() {
    const hasVideo = callState && callState.localStream && callState.localStream.getVideoTracks().length > 0;
    callSwitchCamBtn.classList.toggle("hidden", !hasVideo);
  }

  // Achado real do Gilcimar (2026-09-08): nem a chamada de vídeo nem o
  // modo live tinham como trocar entre câmera frontal e traseira. Pega
  // uma faixa de vídeo NOVA da câmera oposta e troca ela no lugar da
  // antiga - tanto no envio pro outro lado (RTCRtpSender.replaceTrack,
  // API padrão de WebRTC) quanto no preview local (reconstrói a
  // MediaStream com a faixa nova).
  async function trocarCameraChamada() {
    if (!callState || !callState.localStream || !callState.pc) return;
    const oldTrack = callState.localStream.getVideoTracks()[0];
    if (!oldTrack) return;
    const novoFacing = callState.facingMode === "environment" ? "user" : "environment";
    callSwitchCamBtn.disabled = true;
    try {
      const novaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: novoFacing }, audio: false });
      const novoTrack = novaStream.getVideoTracks()[0];
      if (!novoTrack) throw new Error("sem faixa de vídeo nova");
      const sender = callState.pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(novoTrack);
      oldTrack.stop();
      callState.localStream.removeTrack(oldTrack);
      callState.localStream.addTrack(novoTrack);
      callLocalVideo.srcObject = callState.localStream;
      callState.facingMode = novoFacing;
    } catch (e) {
      console.warn("não consegui trocar de câmera na chamada:", e);
    } finally {
      callSwitchCamBtn.disabled = false;
    }
  }
  callSwitchCamBtn.addEventListener("click", trocarCameraChamada);

  function newCallId() {
    return "call-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  // Achado real (2026-08-27): se uma chamada anterior ficar "pra trás" sem
  // passar por callReset() - ex: o app foi pro segundo plano no meio de
  // uma chamada que nunca conectou, ou o usuário saiu sem apertar
  // Encerrar - a câmera/microfone fica presa naquela stream antiga. A
  // PRÓXIMA tentativa de getUserMedia (mesmo o gravador de áudio antigo,
  // recurso separado) falha com NotReadableError, mesmo com a permissão
  // certinha, porque o hardware já está em uso pela stream que nunca foi
  // liberada. Duas camadas de proteção:
  function ensureCallStateClean() {
    if (callState) callReset();
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || !callState) return;
    const pc = callState.pc;
    if (!pc || pc.connectionState !== "connected") {
      // Ainda chamando/tocando, nunca conectou de verdade - libera a
      // câmera/microfone se o app foi pro segundo plano nesse meio tempo,
      // em vez de deixar presa até o Android matar o processo.
      callReset();
    }
  });

  function waitIceGatheringComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      function check() {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      }
      pc.addEventListener("icegatheringstatechange", check);
      // segurança: nunca trava esperando ICE pra sempre - depois de 3s
      // manda o que já tiver (ainda costuma funcionar, só com menos
      // candidatos pra tentar).
      setTimeout(resolve, 3000);
    });
  }

  function makePeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.ontrack = (e) => {
      callRemoteVideo.srcObject = e.streams[0];
      callRemoteVideo.classList.remove("esperando");
    };
    return pc;
  }

  // Pega câmera/microfone e devolve {stream, semAudio?} ou {error} com o
  // motivo real - a mensagem genérica de antes ("confere a permissão")
  // escondia se o problema era permissão negada de verdade
  // (NotAllowedError), câmera não encontrada (NotFoundError), câmera/mic
  // ocupado por OUTRO app (NotReadableError - achado real: um gravador de
  // tela com "gravar microfone" ligado prende o microfone inteiro,
  // impedindo qualquer outro app de usar, mesmo com permissão certa) ou a
  // API nem existir nesse navegador/contexto (TypeError - ex: página
  // carregada por http:// num IP, não localhost).
  //
  // Como "abrir a câmera" é o pedido de verdade (a pessoa quer SE VER e
  // ser vista, áudio é secundário), tenta vídeo+áudio primeiro e, se
  // falhar, tenta só vídeo antes de desistir - assim um microfone preso
  // por outro app (gravador de tela, assistente de voz, etc.) não
  // impede mais a câmera de abrir. A chamada continua sem áudio nesse
  // caso, mas não fica travada.
  async function getCallMediaStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { error: "getUserMedia indisponível nesse navegador (a API só existe em contexto seguro - localhost/https)." };
    }
    try {
      // facingMode "ideal" (não "exact") - continua funcionando normal em
      // aparelhos sem câmera frontal reconhecida como tal, só prefere ela
      // quando existe. Torna o ponto de partida determinístico (sempre
      // frontal), condição pra trocarCameraChamada() saber com certeza
      // qual câmera trocar DE e PRA.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      return { stream };
    } catch (eComAudio) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        return { stream, semAudio: true, motivoSemAudio: `${eComAudio.name || "Erro"}: ${eComAudio.message || "sem detalhe"}` };
      } catch (eSoVideo) {
        return { error: `${eSoVideo.name || "Erro"}: ${eSoVideo.message || "sem detalhe"}` };
      }
    }
  }

  // Chamada local (mesma rede): fala direto com o ip:port do outro nó.
  // Chamada à distância: os dois só se alcançam de dentro pra fora do
  // nó-semente (mesmo truque do modo híbrido do chat) - fala com o
  // /api/call/relay/* do nó-semente em vez de bater direto no outro
  // celular, usando o node_id (peer.id) como endereço em vez de ip:port.
  async function callSignal(peer, path, body) {
    let url;
    if (peer.via === "relay") {
      url = `${seedHttpUrl}/api/call/relay/${path}`;
      body = { ...body, to_id: peer.id };
    } else {
      url = `http://${peer.ip}:${peer.port}/api/call/${path}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("resposta " + res.status);
  }

  async function openPeerPicker() {
    ensureCallStateClean();
    let data;
    try {
      const res = await fetch("/api/peers");
      data = await res.json();
    } catch (e) {
      openModal("<h3>Chamada de vídeo</h3><p class='muted'>Não deu pra ver quem está na malha agora.</p>");
      return;
    }
    myNodeId = data.node_id;
    seedHttpUrl = data.seed_http;
    const me = { node_id: data.node_id, my_ip: data.my_ip, my_port: data.my_port };

    // Nós-semente (bootstrap) não têm ninguém de verdade atendendo do outro
    // lado - ligar pra eles só ficaria chamando pra sempre sem resposta.
    // Achado real 2026-08-31: p.port aqui é a porta de SINCRONIZAÇÃO
    // (gossip, 8892) - a chamada usa HTTP de verdade, então precisa de
    // p.http_port (novo campo no /api/peers, servidor manda desde a
    // descoberta agora). Fallback pro padrão do Android (5000) se for um
    // peer antigo que ainda não anuncia http_port.
    const lanPeers = (data.peers || [])
      .filter((p) => !p.id.startsWith("bootstrap-"))
      .map((p) => ({ id: p.id, name: p.name || "Nó", via: "lan", ip: p.ip, port: p.http_port || 5000 }));

    let relayPeers = [];
    try {
      const res2 = await fetch(`${seedHttpUrl}/api/call/relay/who_is_online?my_id=${encodeURIComponent(myNodeId)}`);
      const data2 = await res2.json();
      relayPeers = (data2.online || []).map((p) => ({ id: p.id, name: p.name || "Nó", via: "relay" }));
    } catch (e) {
      // sem internet agora, ou nó-semente fora do ar - segue só com quem
      // está na mesma rede, sem travar o resto da lista por causa disso.
    }

    // Um peer pode aparecer nos dois caminhos ao mesmo tempo (achado pela
    // rede local E com presença no relay) - mostra só uma vez, preferindo
    // o caminho local (mais rápido, sem depender da Oracle).
    const porId = new Map();
    for (const p of lanPeers) porId.set(p.id, p);
    for (const p of relayPeers) if (!porId.has(p.id)) porId.set(p.id, p);
    const peers = Array.from(porId.values());
    if (peers.length === 0) {
      openModal("<h3>Chamada de vídeo</h3><p class='muted'>Ninguém pra chamar agora - nem na mesma rede, nem à distância.</p>");
      return;
    }
    const rows = peers.map((p, i) => `
      <button type="button" class="call-pick-btn" data-i="${i}">${p.via === "relay" ? "🌍" : "🎥"} ${p.name}${p.via === "relay" ? " <span class=\"muted\">(à distância)</span>" : ""}</button>
    `).join("");
    openModal(`<h3>Chamar quem?</h3><div class="call-pick-list">${rows}</div>`);
    modalContent.querySelectorAll(".call-pick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = peers[Number(btn.dataset.i)];
        closeModal();
        startCall(p, me);
      });
    });
  }

  async function startCall(peer, me) {
    ensureCallStateClean();
    const callId = newCallId();
    const { stream, error, semAudio, motivoSemAudio } = await getCallMediaStream();
    if (error) {
      openModal(`<h3>Chamada de vídeo</h3><p class='muted'>Não consegui acessar câmera/microfone.</p><p class='muted' style="font-size:11px">${error}</p>`);
      return;
    }
    if (semAudio) {
      console.warn("Chamada sem áudio - microfone indisponível:", motivoSemAudio);
    }
    const pc = makePeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    callState = { call_id: callId, role: "caller", pc, localStream: stream, peer, semAudio, facingMode: "user" };

    callScreen.classList.remove("hidden");
    callLocalVideo.srcObject = stream;
    callStatusText.textContent = semAudio
      ? `Chamando ${peer.name}… (sem áudio - microfone ocupado)`
      : `Chamando ${peer.name}…`;
    callHangupBtn.classList.remove("hidden");
    updateMuteBtnVisibility();
    updateSwitchCamBtnVisibility();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGatheringComplete(pc);

    try {
      await callSignal(peer, "offer", {
        call_id: callId,
        from_id: me.node_id,
        from_name: myName() || "Alguém",
        from_ip: me.my_ip,
        from_port: me.my_port,
        sdp: pc.localDescription,
      });
    } catch (e) {
      callStatusText.textContent = "Não consegui alcançar esse nó agora.";
      setTimeout(callReset, 2500);
    }
  }

  // ---------- presença + fila de eventos no nó-semente (chamada à distância) ----------
  async function ensureMyIdentity() {
    if (myNodeId && seedHttpUrl) return;
    try {
      const res = await fetch("/api/peers");
      const data = await res.json();
      myNodeId = data.node_id;
      seedHttpUrl = data.seed_http;
    } catch (e) {
      // sem rede nenhuma agora - tenta de novo no próximo ciclo
    }
  }

  async function callRelayHeartbeat() {
    // Modo OFF (interruptor 2026-08-31) ignora a internet de propósito,
    // mesmo se disponível - chamada é recurso só do modo ON.
    if (window.KrakenMode && window.KrakenMode.get() === "off") return;
    await ensureMyIdentity();
    if (!myNodeId || !seedHttpUrl) return;
    try {
      await fetch(`${seedHttpUrl}/api/call/relay/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: myNodeId, name: myName() || "Alguém" }),
      });
    } catch (e) {
      // sem internet agora - a malha local continua funcionando normal
    }
  }

  async function callRelayPoll() {
    if (window.KrakenMode && window.KrakenMode.get() === "off") return;
    await ensureMyIdentity();
    if (!myNodeId || !seedHttpUrl) return;
    try {
      const res = await fetch(`${seedHttpUrl}/api/call/relay/poll?my_id=${encodeURIComponent(myNodeId)}`);
      const data = await res.json();
      for (const ev of data.events || []) {
        if (ev.kind === "incoming_call") handleIncomingCall(ev.data);
        else if (ev.kind === "call_answered") handleCallAnswered(ev.data);
        else if (ev.kind === "call_rejected") handleCallRejected(ev.data);
        else if (ev.kind === "call_hangup") handleCallHangup(ev.data);
      }
    } catch (e) {
      // sem internet agora
    }
  }

  // Reforço de segurança pra chamada LOCAL (2026-08-31, achado real): até
  // aqui só existia o "empurrão" via Socket.IO (socket.on abaixo) - se
  // esse aviso passasse batido por qualquer motivo (conexão reconectando
  // bem naquele instante, por exemplo), ninguém perguntava de novo depois
  // e a chamada nunca aparecia pra quem ia atender, mesmo com o app
  // aberto. Mesmo princípio que já protege a chamada à distância
  // (callRelayPoll) - consulta o próprio servidor local (sempre a mesma
  // origem, "/api/call/local_poll") a cada 1,5s.
  async function callLocalPoll() {
    if (window.KrakenMode && window.KrakenMode.get() === "off") return;
    try {
      const res = await fetch("/api/call/local_poll");
      const data = await res.json();
      for (const ev of data.events || []) {
        if (ev.kind === "incoming_call") handleIncomingCall(ev.data);
        else if (ev.kind === "call_answered") handleCallAnswered(ev.data);
        else if (ev.kind === "call_rejected") handleCallRejected(ev.data);
        else if (ev.kind === "call_hangup") handleCallHangup(ev.data);
      }
    } catch (e) {
      // falha momentânea - tenta de novo no próximo ciclo
    }
  }

  function startCallRelayLoop() {
    callRelayHeartbeat();
    callRelayPoll();
    callLocalPoll();
    setInterval(callRelayHeartbeat, 5000);
    setInterval(callRelayPoll, 2000);
    setInterval(callLocalPoll, 1500);
  }

  function handleIncomingCall(data) {
    // Já tem uma chamada rolando (ligando ou recebendo outra) - recusa a
    // nova sem perguntar. Simples de propósito: sem "chamada em espera"
    // nessa primeira versão.
    if (callState) return;
    callState = {
      call_id: data.call_id,
      role: "callee",
      pc: null,
      localStream: null,
      peer: {
        id: data.from_id,
        name: data.from_name || "Alguém",
        via: data.via === "relay" ? "relay" : "lan",
        ip: data.from_ip,
        port: data.from_port,
      },
      pendingOffer: data.sdp,
    };
    callScreen.classList.remove("hidden");
    callStatusText.textContent = `${callState.peer.name} está te chamando…`;
    callAcceptBtn.classList.remove("hidden");
    callRejectBtn.classList.remove("hidden");
  }

  async function acceptCall() {
    if (!callState || !callState.pendingOffer) return;
    const { call_id, peer, pendingOffer } = callState;
    const { stream, error, semAudio, motivoSemAudio } = await getCallMediaStream();
    if (error) {
      openModal(`<h3>Chamada de vídeo</h3><p class='muted'>Não consegui acessar câmera/microfone.</p><p class='muted' style="font-size:11px">${error}</p>`);
      rejectCall();
      return;
    }
    if (semAudio) {
      console.warn("Chamada sem áudio - microfone indisponível:", motivoSemAudio);
    }
    const pc = makePeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    callState.pc = pc;
    callState.localStream = stream;
    callState.semAudio = semAudio;
    callState.facingMode = "user";
    callLocalVideo.srcObject = stream;
    callAcceptBtn.classList.add("hidden");
    callRejectBtn.classList.add("hidden");
    callHangupBtn.classList.remove("hidden");
    updateMuteBtnVisibility();
    updateSwitchCamBtnVisibility();
    callStatusText.textContent = semAudio
      ? `Em chamada com ${peer.name} (sem áudio - microfone ocupado)`
      : `Em chamada com ${peer.name}`;

    await pc.setRemoteDescription(pendingOffer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceGatheringComplete(pc);

    try {
      await callSignal(peer, "answer", { call_id, sdp: pc.localDescription });
    } catch (e) {
      callStatusText.textContent = "Não consegui responder - conexão falhou.";
      setTimeout(callReset, 2500);
    }
  }

  async function rejectCall() {
    if (!callState) return;
    const { call_id, peer } = callState;
    try { await callSignal(peer, "reject", { call_id }); } catch (e) {}
    callReset();
  }

  async function hangupCall() {
    if (!callState) return;
    const { call_id, peer } = callState;
    try { await callSignal(peer, "hangup", { call_id }); } catch (e) {}
    callReset();
  }

  async function handleCallAnswered(data) {
    if (!callState || callState.call_id !== data.call_id || !callState.pc) return;
    // Achado real 2026-08-31: com o reforço de consulta local (mesmo
    // evento podendo chegar 2x, uma via Socket.IO e outra via poll de
    // segurança), setRemoteDescription() na 2ª vez lançaria
    // InvalidStateError (já tem descrição remota) - ignora em silêncio,
    // já processou a resposta certa na 1ª chegada.
    if (callState.pc.currentRemoteDescription) return;
    await callState.pc.setRemoteDescription(data.sdp);
    callStatusText.textContent = callState.semAudio
      ? `Em chamada com ${callState.peer.name} (sem áudio - microfone ocupado)`
      : `Em chamada com ${callState.peer.name}`;
  }

  function handleCallRejected(data) {
    if (!callState || callState.call_id !== data.call_id) return;
    callStatusText.textContent = "Chamada recusada.";
    setTimeout(callReset, 1500);
  }

  function handleCallHangup(data) {
    if (!callState || callState.call_id !== data.call_id) return;
    callStatusText.textContent = "A pessoa encerrou a chamada.";
    setTimeout(callReset, 1500);
  }

  // ---------- Live (transmissão pra plateia, via Janus Gateway/SFU) ----------
  // Diferente da chamada acima (P2P puro, vídeo nunca passa pelo servidor),
  // transmitir pra VÁRIOS espectadores ao mesmo tempo precisa de um servidor
  // de mídia de verdade (Janus, rodando à parte na mesma VM do nó-semente,
  // 2026-08-31) - recebe a transmissão 1 vez e retransmite pra todo mundo.
  // O server.py só ajuda a achar "quem está ao vivo agora" e qual sala usar
  // (/api/live/*, mesmo princípio do relay de chamada à distância) - a
  // sinalização WebRTC de verdade (SDP/ICE) e o vídeo em si acontecem direto
  // entre o navegador e o Janus, nunca passam pelo server.py.
  //
  // janus.js (biblioteca oficial, MIT, baixada direto do Janus compilado que
  // roda na Oracle - mesma versão, sem risco de incompatibilidade) depende
  // de um "webRTCAdapter" só pra tratar peculiaridades de Firefox/Safari -
  // como o Kraken só roda em WebView/Chrome (Chromium), um stub simples no
  // lugar do adapter.js de verdade (~200KB, mais uma dependência externa pra
  // vendorizar) é suficiente e evita carregar peso à toa.
  let liveState = null; // {role:"broadcaster"|"viewer", room, janusInstance, handle, localStream?, remoteStream?}
  let liveHeartbeatTimerId = null;
  let janusLibReady = null;

  function ensureJanusInit() {
    if (janusLibReady) return janusLibReady;
    janusLibReady = new Promise((resolve, reject) => {
      if (typeof Janus === "undefined") {
        reject(new Error("Biblioteca do Janus não carregou"));
        return;
      }
      Janus.init({
        debug: false,
        dependencies: Janus.useDefaultDependencies({
          adapter: { browserDetails: { browser: "chrome", version: 999 } },
        }),
        callback: resolve,
      });
    });
    return janusLibReady;
  }

  function liveReset() {
    if (liveHeartbeatTimerId) {
      clearInterval(liveHeartbeatTimerId);
      liveHeartbeatTimerId = null;
    }
    if (liveState && liveState.role === "broadcaster" && myNodeId && seedHttpUrl) {
      fetch(`${seedHttpUrl}/api/live/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: myNodeId }),
      }).catch(() => {});
    }
    if (liveState && liveState.localStream) {
      liveState.localStream.getTracks().forEach((t) => t.stop());
    }
    if (liveState && liveState.janusInstance) {
      try { liveState.janusInstance.destroy(); } catch (e) {}
    }
    if (liveState && liveState.sub) {
      liveState.sub.teardown();
    }
    liveState = null;
    liveScreen.classList.add("hidden");
    liveVideo.srcObject = null;
    liveVideo.muted = false;
    liveStopBtn.classList.add("hidden");
    liveSwitchCamBtn.classList.add("hidden");
    liveSwitchCamBtn.disabled = false;
  }

  // Mesma ideia do trocarCameraChamada() (achado real do Gilcimar,
  // 2026-09-08), mas troca a faixa dentro do Janus (SFU) em vez de um
  // RTCPeerConnection direto - replaceTracks() já existe vendorizado no
  // janus.js oficial, faz exatamente o replaceTrack() padrão do WebRTC
  // por baixo dos panos, escondido atrás da API própria do plugin.
  async function trocarCameraLive() {
    if (!liveState || liveState.role !== "broadcaster" || !liveState.localStream || !liveState.handle) return;
    const oldTrack = liveState.localStream.getVideoTracks()[0];
    if (!oldTrack) return;
    const novoFacing = liveState.facingMode === "environment" ? "user" : "environment";
    liveSwitchCamBtn.disabled = true;
    try {
      const novaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: novoFacing }, audio: false });
      const novoTrack = novaStream.getVideoTracks()[0];
      if (!novoTrack) throw new Error("sem faixa de vídeo nova");
      await new Promise((resolve, reject) => {
        liveState.handle.replaceTracks({
          tracks: [{ type: "video", capture: novoTrack, replace: true }],
          success: resolve,
          error: reject,
        });
      });
      oldTrack.stop();
      liveState.localStream.removeTrack(oldTrack);
      liveState.localStream.addTrack(novoTrack);
      liveVideo.srcObject = liveState.localStream;
      liveState.facingMode = novoFacing;
    } catch (e) {
      console.warn("não consegui trocar de câmera na live:", e);
    } finally {
      liveSwitchCamBtn.disabled = false;
    }
  }
  liveSwitchCamBtn.addEventListener("click", trocarCameraLive);

  function liveFail(msg) {
    liveReset();
    openModal(`<h3>🔴 Live</h3><p class="muted">${msg}</p>`);
  }

  // Mesmo achado real do v21 (chamada de vídeo) - se o app for pro segundo
  // plano com a câmera presa numa transmissão, o hardware fica ocupado pra
  // sempre até o Android matar o processo. Encerra sozinho, tanto pra quem
  // transmite quanto pra quem assiste.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (liveState) liveReset();
    if (mosaicCells.length) closeMosaic();
  });

  function joinAsPublisher(handle, room) {
    handle.send({ message: { request: "join", room, ptype: "publisher", display: myName() || "Alguém" } });
  }

  function publishOwnFeed() {
    if (!liveState || !liveState.handle || !liveState.localStream) return;
    const handle = liveState.handle;
    const tracks = [];
    if (liveState.localStream.getAudioTracks().length > 0) {
      tracks.push({ type: "audio", capture: liveState.localStream.getAudioTracks()[0], recv: false });
    }
    if (liveState.localStream.getVideoTracks().length > 0) {
      tracks.push({ type: "video", capture: liveState.localStream.getVideoTracks()[0], recv: false });
    }
    handle.createOffer({
      tracks,
      success: (jsep) => {
        handle.send({ message: { request: "configure", audio: true, video: true }, jsep });
        liveGoLive();
      },
      error: (err) => liveFail("Erro ao publicar a transmissão: " + (err && err.message ? err.message : err)),
    });
  }

  function liveGoLive() {
    if (!liveState) return;
    liveStatusText.textContent = "🔴 Você está ao vivo";
    liveStopBtn.classList.remove("hidden");
    liveHeartbeatTimerId = setInterval(() => {
      if (!myNodeId || !seedHttpUrl) return;
      fetch(`${seedHttpUrl}/api/live/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: myNodeId, name: myName() || "Alguém" }),
      }).catch(() => {});
    }, 5000);
  }

  async function startLiveBroadcast() {
    if (liveState) liveReset();
    if (!Janus || !Janus.isWebrtcSupported || !Janus.isWebrtcSupported()) {
      openModal("<h3>🔴 Live</h3><p class='muted'>Esse navegador não suporta transmissão ao vivo.</p>");
      return;
    }
    await ensureMyIdentity();
    if (!myNodeId || !seedHttpUrl) {
      openModal("<h3>🔴 Live</h3><p class='muted'>Sem internet agora - não dá pra transmitir sem alcançar o nó-semente.</p>");
      return;
    }
    let hb;
    try {
      const res = await fetch(`${seedHttpUrl}/api/live/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: myNodeId, name: myName() || "Alguém" }),
      });
      hb = await res.json();
    } catch (e) {
      openModal("<h3>🔴 Live</h3><p class='muted'>Não consegui falar com o servidor de transmissão agora.</p>");
      return;
    }
    if (!hb || !hb.ok) {
      openModal(`<h3>🔴 Live</h3><p class='muted'>${(hb && hb.error) || "Não deu pra começar a transmissão."}</p>`);
      return;
    }
    const room = hb.room;
    const janusUrl = hb.janus;

    let stream;
    try {
      // facingMode "ideal" - mesmo motivo do getCallMediaStream(): ponto de
      // partida determinístico (sempre frontal), pra trocarCameraLive()
      // saber com certeza qual câmera trocar DE e PRA.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
    } catch (e) {
      openModal(`<h3>🔴 Live</h3><p class='muted'>Não consegui acessar câmera/microfone.</p><p class='muted' style="font-size:11px">${e.name || "Erro"}: ${e.message || "sem detalhe"}</p>`);
      return;
    }

    await ensureJanusInit();

    liveState = { role: "broadcaster", room, janusInstance: null, handle: null, localStream: stream, facingMode: "user" };
    liveScreen.classList.remove("hidden");
    liveVideo.muted = true;
    liveVideo.srcObject = stream;
    liveStatusText.textContent = "Preparando transmissão…";
    liveSwitchCamBtn.classList.remove("hidden");

    const opaqueId = "kraken-live-" + Janus.randomString(12);
    const janusInstance = new Janus({
      server: janusUrl,
      iceServers: ICE_SERVERS,
      success: () => {
        if (!liveState) return; // cancelado (liveReset) antes da sessão abrir
        liveState.janusInstance = janusInstance;
        janusInstance.attach({
          plugin: "janus.plugin.videoroom",
          opaqueId,
          success: (handle) => {
            if (!liveState) return;
            liveState.handle = handle;
            handle.send({
              message: {
                request: "create",
                room,
                description: "Kraken Live - " + (myName() || "Alguém"),
                is_private: true,
                publishers: 1,
                bitrate: 300000,
                fir_freq: 10,
              },
              // Achado real testando direto contra o Janus (curl, antes de
              // buildar): "create"/"listparticipants" são requisições
              // SÍNCRONAS - mesmo um erro do plugin (ex: 427 "sala já
              // existe") chega aqui dentro de success(data), com
              // data.error_code preenchido, e NÃO pelo callback error()
              // (esse só dispara pra erro de transporte/protocolo, tipo
              // sessão inválida). 427 é o caso normal de alguém que já
              // transmitiu antes (a sala não é apagada sozinha) - trata
              // como sucesso, segue pro join do mesmo jeito que uma sala
              // recém-criada.
              success: (data) => {
                if (data && data.error_code && data.error_code !== 427) {
                  liveFail("Não consegui criar a sala de transmissão: " + data.error);
                  return;
                }
                joinAsPublisher(handle, room);
              },
              error: (err) => liveFail("Não consegui criar a sala de transmissão: " + err),
            });
          },
          error: (err) => liveFail("Não consegui conectar no servidor de transmissão: " + err),
          onmessage: (msg, jsep) => {
            if (!liveState || liveState.role !== "broadcaster") return;
            if (msg.videoroom === "joined") {
              publishOwnFeed();
            } else if (msg.videoroom === "event" && msg.error_code) {
              liveFail(msg.error || "Erro ao transmitir");
            }
            if (jsep && liveState.handle) liveState.handle.handleRemoteJsep({ jsep });
          },
          onlocaltrack: () => {}, // já mostramos o preview com a stream original (getUserMedia nosso)
          oncleanup: () => {},
        });
      },
      error: (err) => liveFail("Não consegui conectar no servidor de transmissão: " + err),
      destroyed: () => {},
    });
  }

  // Assinatura Janus de UMA live, extraída do watchLive original
  // (2026-09-07) pra reusar no Mosaico (várias assinaturas simultâneas,
  // uma por quadrado) sem duplicar a lógica de WebRTC/Janus. Devolve um
  // objeto com `teardown()` - quem chama é responsável por chamá-lo
  // quando não precisar mais dessa assinatura específica.
  function janusSubscribe(broadcaster, videoEl, onStatus, onFail) {
    const sub = { janusInstance: null, handle: null, remoteStream: null, alive: true };
    const opaqueId = "kraken-live-" + Janus.randomString(12);
    const janusInstance = new Janus({
      server: broadcaster.janus,
      iceServers: ICE_SERVERS,
      success: () => {
        if (!sub.alive) return;
        sub.janusInstance = janusInstance;
        janusInstance.attach({
          plugin: "janus.plugin.videoroom",
          opaqueId,
          success: (handle) => {
            if (!sub.alive) return;
            sub.handle = handle;
            handle.send({
              message: { request: "listparticipants", room: broadcaster.room },
              // Erro do plugin (sala não existe mais etc) chega aqui
              // dentro de success(data), não em error() - achado real
              // testando direto contra o Janus de produção (v43).
              success: (data) => {
                if (!sub.alive) return;
                if (data && data.error_code) {
                  onFail(`${broadcaster.name} não está mais ao vivo (${data.error}).`);
                  return;
                }
                const pub = (data.participants || []).find((p) => p.publisher);
                if (!pub) {
                  onFail(`${broadcaster.name} não está mais ao vivo.`);
                  return;
                }
                handle.send({ message: { request: "join", room: broadcaster.room, ptype: "subscriber", streams: [{ feed: pub.id }] } });
              },
              error: (err) => onFail("Não consegui entrar na transmissão: " + err),
            });
          },
          error: (err) => onFail("Não consegui conectar no servidor de transmissão: " + err),
          onmessage: (msg, jsep) => {
            if (!sub.alive || !sub.handle) return;
            if (msg.videoroom === "event" && msg.error_code) {
              onFail(msg.error || "Erro ao assistir a transmissão");
              return;
            }
            if (jsep) {
              sub.handle.createAnswer({
                jsep,
                tracks: [{ type: "data" }], // recvonly de áudio/vídeo (sem capturar nada nosso)
                success: (answerJsep) => {
                  if (!sub.alive || !sub.handle) return;
                  sub.handle.send({ message: { request: "start", room: broadcaster.room }, jsep: answerJsep });
                },
                error: (err) => onFail("Erro ao assistir a transmissão: " + (err && err.message ? err.message : err)),
              });
            }
          },
          onremotetrack: (track, mid, on) => {
            if (!sub.alive) return;
            if (on) {
              if (!sub.remoteStream) sub.remoteStream = new MediaStream();
              sub.remoteStream.addTrack(track);
              videoEl.srcObject = sub.remoteStream;
              onStatus();
            } else if (sub.remoteStream) {
              sub.remoteStream.removeTrack(track);
            }
          },
          oncleanup: () => {},
        });
      },
      error: (err) => onFail("Não consegui conectar no servidor de transmissão: " + err),
      destroyed: () => {},
    });
    sub.teardown = () => {
      sub.alive = false;
      try { if (sub.handle) sub.handle.detach(); } catch (e) {}
      try { if (sub.janusInstance) sub.janusInstance.destroy(); } catch (e) {}
      videoEl.srcObject = null;
    };
    return sub;
  }

  async function watchLive(broadcaster) {
    if (!broadcaster) return;
    if (liveState) liveReset();
    if (!Janus || !Janus.isWebrtcSupported || !Janus.isWebrtcSupported()) {
      openModal("<h3>🔴 Live</h3><p class='muted'>Esse navegador não suporta assistir transmissão ao vivo.</p>");
      return;
    }
    await ensureJanusInit();

    liveState = { role: "viewer", room: broadcaster.room, sub: null };
    liveScreen.classList.remove("hidden");
    liveVideo.muted = false;
    liveStatusText.textContent = `Conectando com a transmissão de ${broadcaster.name}…`;

    liveState.sub = janusSubscribe(
      broadcaster,
      liveVideo,
      () => {
        if (!liveState) return;
        liveStatusText.textContent = `🔴 Assistindo ${broadcaster.name}`;
        liveStopBtn.classList.remove("hidden");
      },
      (msg) => liveFail(msg)
    );
  }

  // Extraído de openLivePicker (2026-09-07) pra reusar no seletor de cada
  // quadrado do Mosaico, sem duplicar o fetch.
  async function fetchLiveList() {
    await ensureMyIdentity();
    if (!myNodeId || !seedHttpUrl) return [];
    try {
      const res = await fetch(`${seedHttpUrl}/api/live/who_is_live?my_id=${encodeURIComponent(myNodeId)}`);
      const data = await res.json();
      return (data.live || []).map((p) => ({ ...p, janus: data.janus }));
    } catch (e) {
      return []; // sem conexão com o nó-semente agora
    }
  }

  async function openLivePicker() {
    if (window.KrakenMode && window.KrakenMode.get() === "off") {
      openModal("<h3>🔴 Live</h3><p class='muted'>Ligue o modo online pra usar o Live.</p>");
      return;
    }
    await ensureMyIdentity();
    if (!myNodeId || !seedHttpUrl) {
      openModal("<h3>🔴 Live</h3><p class='muted'>Sem internet agora - Live precisa do nó-semente pra achar quem está transmitindo.</p>");
      return;
    }
    const liveList = await fetchLiveList();
    const rows = liveList.map((p, i) => `
      <button type="button" class="call-pick-btn" data-i="${i}">🔴 Assistir ${p.name}</button>
    `).join("");
    openModal(`
      <h3>🔴 Live</h3>
      <button type="button" id="live-start-btn" class="btn vermelho" style="width:100%;margin-bottom:10px">🔴 Transmitir agora</button>
      <button type="button" id="live-mosaic-btn" class="btn roxo" style="width:100%;margin-bottom:10px">🔲 Mosaico (várias ao mesmo tempo)</button>
      ${rows ? `<div class="call-pick-list">${rows}</div>` : "<p class='muted'>Ninguém transmitindo agora.</p>"}
    `);
    document.getElementById("live-start-btn").addEventListener("click", () => {
      closeModal();
      startLiveBroadcast();
    });
    document.getElementById("live-mosaic-btn").addEventListener("click", () => {
      closeModal();
      openMosaic();
    });
    modalContent.querySelectorAll(".call-pick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = liveList[Number(btn.dataset.i)];
        closeModal();
        watchLive(p);
      });
    });
  }

  // ---------- Mosaico de Lives (2026-09-07, pedido do Gilcimar) ----------
  // Assistir de 1 a 9 transmissões ao mesmo tempo, tipo parede de câmeras
  // de segurança - cada quadrado é uma assinatura Janus INDEPENDENTE
  // (janusSubscribe, mesma função usada pelo watchLive de 1 tela só),
  // escolhida livremente (dá pra repetir a mesma live em 2 quadrados, ou
  // deixar quadrado vazio). Nada disso mexe no watchLive/liveState de
  // tela cheia - são sistemas paralelos, só compartilham a função de
  // assinatura.
  let mosaicSize = 4;
  let mosaicCells = []; // [{broadcaster, videoEl, labelEl, emptyEl, sub}]

  // ✅ CORRIGIDO (2026-09-07): era Math.ceil(Math.sqrt(n)) - bom pra tela
  // larga, mas o celular é retrato (mais alto que largo). Pra n=2, isso
  // dava 2 colunas lado a lado = 2 faixas bem estreitas e altíssimas
  // ("esticada", achado real testando com o Gilcimar). Tabela pensada
  // pra retrato: menos colunas quando dá, deixando cada quadrado mais
  // perto de um retângulo normal em vez de uma faixa fina.
  const MOSAIC_COLS = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3 };
  function mosaicColumnsFor(n) {
    return MOSAIC_COLS[n] || Math.ceil(Math.sqrt(n));
  }

  function mosaicTeardownCell(cell) {
    if (cell.sub) {
      cell.sub.teardown();
      cell.sub = null;
    }
    cell.broadcaster = null;
    if (cell.labelEl) cell.labelEl.textContent = "";
    if (cell.emptyEl) {
      cell.emptyEl.textContent = "toque pra escolher";
      cell.emptyEl.classList.remove("hidden");
    }
  }

  async function assignMosaicCell(cell) {
    const liveList = await fetchLiveList();
    const rows = liveList.map((p, i) => `
      <button type="button" class="call-pick-btn" data-i="${i}">🔴 ${p.name}</button>
    `).join("");
    openModal(`
      <h3>Escolher live pro quadrado</h3>
      <button type="button" id="mosaic-cell-clear-btn" class="btn amarelo" style="width:100%;margin-bottom:10px">Deixar vazio</button>
      ${rows ? `<div class="call-pick-list">${rows}</div>` : "<p class='muted'>Ninguém transmitindo agora.</p>"}
    `);
    document.getElementById("mosaic-cell-clear-btn").addEventListener("click", () => {
      closeModal();
      mosaicTeardownCell(cell);
    });
    modalContent.querySelectorAll(".call-pick-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const broadcaster = liveList[Number(btn.dataset.i)];
        closeModal();
        mosaicTeardownCell(cell); // troca limpo se já tinha algo nesse quadrado
        if (!Janus || !Janus.isWebrtcSupported || !Janus.isWebrtcSupported()) {
          alert("Esse navegador não suporta assistir transmissão ao vivo.");
          return;
        }
        await ensureJanusInit();
        cell.broadcaster = broadcaster;
        cell.emptyEl.textContent = `conectando com ${broadcaster.name}…`;
        cell.sub = janusSubscribe(
          broadcaster,
          cell.videoEl,
          () => {
            cell.emptyEl.classList.add("hidden");
            cell.labelEl.textContent = "🔴 " + broadcaster.name;
          },
          (msg) => {
            cell.emptyEl.textContent = msg;
            cell.emptyEl.classList.remove("hidden");
          }
        );
      });
    });
  }

  function buildMosaicGrid() {
    // Mantém as assinaturas dos quadrados que sobrevivem à mudança de
    // tamanho (ex: ir de 6 pra 9 preserva os 6 já conectados) - só
    // derruba quadrados que deixaram de existir (ex: ir de 9 pra 4).
    mosaicCells.slice(mosaicSize).forEach(mosaicTeardownCell);
    mosaicGrid.innerHTML = "";
    const cols = mosaicColumnsFor(mosaicSize);
    mosaicGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const novasCells = [];
    for (let i = 0; i < mosaicSize; i++) {
      const antiga = mosaicCells[i];
      const cellDiv = document.createElement("div");
      cellDiv.className = "mosaic-cell";
      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false;
      const label = document.createElement("div");
      label.className = "mosaic-cell-label";
      const empty = document.createElement("div");
      empty.className = "mosaic-cell-empty";
      empty.textContent = "toque pra escolher";
      cellDiv.appendChild(video);
      cellDiv.appendChild(label);
      cellDiv.appendChild(empty);
      mosaicGrid.appendChild(cellDiv);
      const cell = { broadcaster: antiga ? antiga.broadcaster : null, videoEl: video, labelEl: label, emptyEl: empty, sub: antiga ? antiga.sub : null };
      if (cell.sub && cell.broadcaster) {
        // reconecta o <video> novo à mesma stream que já estava rolando
        video.srcObject = cell.sub.remoteStream || null;
        label.textContent = "🔴 " + cell.broadcaster.name;
        empty.classList.add("hidden");
      }
      empty.addEventListener("click", () => assignMosaicCell(cell));
      novasCells.push(cell);
    }
    mosaicCells = novasCells;
  }

  function closeMosaic() {
    mosaicCells.forEach(mosaicTeardownCell);
    mosaicCells = [];
    mosaicGrid.innerHTML = "";
    mosaicScreen.classList.add("hidden");
  }

  async function openMosaic() {
    if (!Janus || !Janus.isWebrtcSupported || !Janus.isWebrtcSupported()) {
      openModal("<h3>🔲 Mosaico</h3><p class='muted'>Esse navegador não suporta assistir transmissão ao vivo.</p>");
      return;
    }
    await ensureJanusInit();
    mosaicSizeLabel.textContent = String(mosaicSize);
    mosaicScreen.classList.remove("hidden");
    buildMosaicGrid();
  }

  mosaicSizeMinus.addEventListener("click", () => {
    if (mosaicSize <= 1) return;
    mosaicSize -= 1;
    mosaicSizeLabel.textContent = String(mosaicSize);
    buildMosaicGrid();
  });
  mosaicSizePlus.addEventListener("click", () => {
    if (mosaicSize >= 9) return;
    mosaicSize += 1;
    mosaicSizeLabel.textContent = String(mosaicSize);
    buildMosaicGrid();
  });
  mosaicCloseBtn.addEventListener("click", closeMosaic);

  liveStopBtn.addEventListener("click", liveReset);

  btnCall.addEventListener("click", openPeerPicker);
  btnBroadcast.addEventListener("click", openLivePicker);

  // ---------- carteira Exaguinon (Estágio 1, 2026-09-07) ----------
  // Pedido do Gilcimar: testar a lógica de presentear usando o Exaguinon
  // ("on") como moeda interna, unificando Kraken e Oceano Livre - sem
  // blockchain nenhuma ainda, só o livro-razão do nó-semente (ver
  // server.py, seção "carteira Exaguinon"). Sempre precisa de internet
  // (mesma limitação que login já tem - não dá pra inventar saldo
  // offline), o resto do Kraken continua 100% offline-first normal.

  // Quem já tinha feito login ANTES dessa versão existir não tem token
  // guardado (login só acontece 1x na vida, por design) - pede e-mail/
  // senha só nessa hora, sem reconstruir a tela de login inteira.
  async function ensureWalletToken() {
    let token = localStorage.getItem(STORAGE_WALLET_TOKEN);
    if (token) return token;
    await ensureMyIdentity();
    const email = prompt("Pra usar a carteira Exaguinon, confirma seu e-mail de login:");
    if (!email) return null;
    const password = prompt("E sua senha:");
    if (!password) return null;
    try {
      const res = await fetch(`${seedHttpUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "não deu certo entrar na carteira");
        return null;
      }
      localStorage.setItem(STORAGE_WALLET_TOKEN, data.token);
      return data.token;
    } catch (e) {
      alert("precisa de internet pra usar a carteira: " + (e && e.message ? e.message : e));
      return null;
    }
  }

  async function sendGift() {
    const token = await ensureWalletToken();
    if (!token) return;
    const valorStr = prompt("Quanto de 'on' (Exaguinon de teste, não é dinheiro real) quer mandar?");
    if (!valorStr) return;
    const valor = parseFloat(valorStr.replace(",", "."));
    if (!valor || valor <= 0) {
      alert("valor inválido");
      return;
    }
    const mensagem = prompt("Mensagem junto do presente (opcional):") || "";
    try {
      const res = await fetch(`${seedHttpUrl}/api/wallet/send_gift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, valor, mensagem }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "não deu pra mandar o presente");
        return;
      }
      const body2 = {
        gift_id: data.gift_id, valor: data.valor, mensagem: data.mensagem,
        sender_id: senderId(), sender_name: myName(),
      };
      if (currentConv.type === "direct") {
        body2.scope = "direct";
        body2.recipient_id = currentConv.peer_id;
      } else if (currentConv.type === "group") {
        body2.scope = "group";
        body2.group_id = currentConv.group_id;
      } else {
        body2.scope = "global";
      }
      const res2 = await fetch("/api/send_gift_message", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...krakenKeyHeaders() },
        body: JSON.stringify(body2),
      });
      const data2 = await res2.json();
      if (data2.ok) addMessage(data2.message);
      else alert(data2.error || "presente debitado mas a mensagem não apareceu - avisa quem programou");
    } catch (e) {
      alert("erro ao presentear: " + (e && e.message ? e.message : e));
    }
  }

  async function redeemGift(giftId, btnEl) {
    const token = await ensureWalletToken();
    if (!token) return;
    btnEl.disabled = true;
    btnEl.textContent = "resgatando…";
    try {
      const res = await fetch(`${seedHttpUrl}/api/wallet/redeem_gift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, gift_id: giftId }),
      });
      const data = await res.json();
      if (data.ok) {
        btnEl.textContent = "✅ resgatado! +" + data.valor + " on";
        alert("Você recebeu " + data.valor + " on (Exaguinon de teste)!");
      } else {
        btnEl.disabled = false;
        btnEl.textContent = "🎁 resgatar";
        alert(data.error || "não deu pra resgatar");
      }
    } catch (e) {
      btnEl.disabled = false;
      btnEl.textContent = "🎁 resgatar";
      alert("erro ao resgatar: " + (e && e.message ? e.message : e));
    }
  }

  btnGift.addEventListener("click", sendGift);
  callAcceptBtn.addEventListener("click", acceptCall);
  callRejectBtn.addEventListener("click", rejectCall);
  callHangupBtn.addEventListener("click", hangupCall);

  // ---------- convite de grupo (token colável) ----------
  function encodeInvite(invite) {
    return "kraken-group:" + btoa(unescape(encodeURIComponent(JSON.stringify(invite))));
  }
  function decodeInvite(token) {
    token = (token || "").trim();
    if (token.startsWith("kraken-group:")) token = token.slice("kraken-group:".length);
    try {
      return JSON.parse(decodeURIComponent(escape(atob(token))));
    } catch (e) {
      return null;
    }
  }

  // ---------- conversa ativa (Geral / grupo / direta) ----------
  function setConversation(conv) {
    currentConv = conv;
    renderTabs();
    redrawMessages();
    // Botão de reexibir convite (2026-08-31) só faz sentido dentro de um
    // grupo - em Geral/direta não existe "convite" pra mostrar.
    btnGroupInvite.classList.toggle("hidden", conv.type !== "group");
  }

  function isActiveChip(c) {
    if (c.type === "global") return currentConv.type === "global";
    if (c.type === "group") return currentConv.type === "group" && currentConv.group_id === c.group_id;
    if (c.type === "direct") return currentConv.type === "direct" && currentConv.peer_id === c.peer_id;
    return false;
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    const chips = [{ type: "global", label: "Geral" }];
    groupsCache.forEach((g) =>
      chips.push({ type: "group", group_id: g.id, label: (g.kind === "private" ? "🔒 " : "🌐 ") + g.name })
    );
    if (currentConv.type === "direct") {
      chips.push({ type: "direct", peer_id: currentConv.peer_id, name: currentConv.name, label: "💬 " + (currentConv.name || "conversa") });
    }
    chips.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tab-chip" + (isActiveChip(c) ? " active" : "");
      chip.textContent = c.label;
      chip.addEventListener("click", () => setConversation(c));
      tabsEl.appendChild(chip);
    });

    const plusChip = document.createElement("button");
    plusChip.type = "button";
    plusChip.className = "tab-chip ghost";
    plusChip.textContent = "+ Grupo";
    plusChip.addEventListener("click", openGroupModal);
    tabsEl.appendChild(plusChip);

    const dmChip = document.createElement("button");
    dmChip.type = "button";
    dmChip.className = "tab-chip ghost";
    dmChip.textContent = "Diretas";
    dmChip.addEventListener("click", openDirectsModal);
    tabsEl.appendChild(dmChip);
  }

  async function loadGroups() {
    const res = await fetch("/api/groups");
    groupsCache = await res.json();
    renderTabs();
  }

  function openGroupModal() {
    openModal(`
      <h3>Novo grupo</h3>
      <input id="group-name-input" maxlength="80" placeholder="Nome do grupo">
      <div class="modal-row">
        <label><input type="radio" name="group-kind" value="private" checked> Privado (só quem tiver o convite)</label>
        <label><input type="radio" name="group-kind" value="open"> Aberto (qualquer um vê)</label>
      </div>
      <button id="group-create-btn" class="btn verde">Criar</button>
      <hr>
      <h3>Entrar com convite</h3>
      <textarea id="invite-input" rows="3" placeholder="Cole aqui o código de convite"></textarea>
      <button id="group-join-btn" class="btn roxo">Entrar</button>
    `);
    document.getElementById("group-create-btn").addEventListener("click", async () => {
      const name = document.getElementById("group-name-input").value.trim();
      const kind = document.querySelector('input[name="group-kind"]:checked').value;
      if (!name) return;
      await createGroup(name, kind);
    });
    document.getElementById("group-join-btn").addEventListener("click", async () => {
      const token = document.getElementById("invite-input").value;
      await joinGroupFromToken(token);
    });
  }

  async function createGroup(name, kind) {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || "erro ao criar grupo");
      return;
    }
    await loadGroups();
    showInviteModal(data.invite, "Grupo criado!");
    setConversation({ type: "group", group_id: data.group.id, name: data.group.name });
  }

  // QR code do convite (pedido do Gilcimar, 2026-08-31): mesma técnica já
  // usada no /join (SVG embutido, sem precisar de internet nem lib nova).
  // A pessoa que vai entrar ainda precisa colar o texto (o app não tem
  // leitor de QR ainda, só gerador) - mas já facilita bastante pra quem
  // tira print/mostra a tela em vez de copiar o texto gigante. Usada tanto
  // na hora de criar o grupo quanto pra reexibir o convite depois
  // (btn-group-invite) - antes disso o convite só aparecia 1 vez, na
  // criação, e sumia pra sempre se ninguém salvasse em outro lugar.
  function showInviteModal(invite, titulo) {
    const token = encodeInvite(invite);
    openModal(`
      <h3>${titulo}</h3>
      <p>Mostre este QR pra pessoa fotografar, ou copie o código de texto
      (WhatsApp, e-mail, etc):</p>
      <div id="invite-qr" style="width:200px;margin:12px auto"></div>
      <textarea id="invite-out" rows="4" readonly></textarea>
      <button id="modal-close-btn" class="btn verde">Entendi</button>
    `);
    const out = document.getElementById("invite-out");
    out.value = token;
    out.addEventListener("click", () => out.select());
    document.getElementById("modal-close-btn").addEventListener("click", closeModal);
    fetch("/api/qr?text=" + encodeURIComponent(token))
      .then((r) => r.text())
      .then((svg) => { document.getElementById("invite-qr").innerHTML = svg; })
      .catch(() => {}); // sem QR não impede o convite por texto de funcionar
  }

  btnGroupInvite.addEventListener("click", async () => {
    if (currentConv.type !== "group") return;
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(currentConv.group_id)}/invite`);
      const data = await res.json();
      if (!data.ok) { alert(data.error || "erro ao buscar convite"); return; }
      showInviteModal(data.invite, "Convite do grupo");
    } catch (e) {
      alert("erro ao buscar convite: " + (e.message || e));
    }
  });

  async function joinGroupFromToken(token) {
    const invite = decodeInvite(token);
    if (!invite || !invite.group_id) {
      alert("convite inválido");
      return;
    }
    const res = await fetch("/api/groups/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || "erro ao entrar no grupo");
      return;
    }
    await loadGroups();
    closeModal();
    setConversation({ type: "group", group_id: data.group.id, name: data.group.name });
  }

  async function openDirectsModal() {
    const res = await fetch("/api/known_nodes");
    const nodes = await res.json();
    const items = nodes.length
      ? nodes
          .map(
            (n) =>
              `<div class="modal-list-item" data-id="${n.node_id}" data-name="${n.name || n.node_id}">${
                n.name || "Nó " + n.node_id.slice(0, 4)
              }</div>`
          )
          .join("")
      : `<p class="muted">Nenhum nó conhecido ainda — ele precisa aparecer na malha (mesma rede) pelo menos uma vez antes de dar pra mandar direto.</p>`;
    openModal(`<h3>Conversa direta</h3>${items}`);
    modalContent.querySelectorAll(".modal-list-item").forEach((el) => {
      el.addEventListener("click", () => {
        setConversation({ type: "direct", peer_id: el.dataset.id, name: el.dataset.name });
        closeModal();
      });
    });
  }

  // ---------- mensagens ----------
  function matchesConv(msg) {
    const scope = msg.scope || "global";
    if (currentConv.type === "global") return scope === "global";
    if (currentConv.type === "group") return scope === "group" && msg.group_id === currentConv.group_id;
    if (currentConv.type === "direct") {
      return scope === "direct" && (msg.sender_id === currentConv.peer_id || msg.recipient_id === currentConv.peer_id);
    }
    return false;
  }

  function redrawMessages() {
    messagesEl.innerHTML = "";
    messagesCache.filter(matchesConv).forEach(paintMessage);
  }

  function addMessage(msg) {
    if (messagesCache.some((m) => m.id === msg.id)) return;
    messagesCache.push(msg);
    if (matchesConv(msg)) paintMessage(msg);
  }

  // Ícone "salvando.../salvo no nó-semente" em arquivo/áudio que EU mandei
  // (2026-09-07, pedido do Gilcimar) - achado real: o metadado podia
  // sincronizar (bolha aparece) sem os bytes nunca terem chegado no
  // nó-semente (corrida no push), e isso era invisível até alguém tentar
  // tocar/baixar dias depois. Mostra o estado de verdade sem bloquear o
  // envio nem esconder a mensagem do remetente (Kraken continua
  // funcionando 100% offline - o ícone só reflete o que já aconteceu).
  function setAckIcon(el, ack) {
    el.textContent = ack ? "☁️ salvo no nó-semente" : "☁️ salvando no nó-semente…";
    el.classList.toggle("ack-done", !!ack);
    el.classList.toggle("ack-pending", !ack);
  }

  function updateSeedAckStatus(id, ack) {
    const cached = messagesCache.find((m) => m.id === id);
    if (cached) cached.seed_ack = ack;
    const el = messagesEl.querySelector(`[data-ack-for="${id}"]`);
    if (el) setAckIcon(el, ack);
  }

  // Reforço além do socket "file_ack" (2026-09-07, achado real testando com
  // o Gilcimar): socketio.emit() sozinho é "empurrão único" - se a conexão
  // Socket.IO não estiver viva bem naquele instante (mesmo padrão de bug já
  // resolvido antes pra chamada de vídeo local, v37), o aviso passa batido
  // pra sempre e o ícone fica preso em "salvando..." mesmo o nó-semente já
  // tendo confirmado de verdade minutos antes. Consulta leve: só busca
  // /api/messages quando existe pelo menos 1 mensagem minha ainda pendente,
  // e só atualiza o ícone das que mudaram - nunca redesenha a tela toda.
  async function syncPendingAcks() {
    const pending = messagesCache.filter(
      (m) => m.sender_id === senderId() && (m.kind === "audio" || m.kind === "file") && !m.seed_ack
    );
    if (pending.length === 0) return;
    try {
      const res = await fetch("/api/messages");
      const msgs = await res.json();
      for (const m of msgs) {
        if (m.seed_ack) updateSeedAckStatus(m.id, 1);
      }
    } catch (e) {
      // ignora falha de rede momentânea - tenta de novo no próximo ciclo
    }
  }

  // Baixa o arquivo via Blob em vez de navegar a página pra URL dele - o
  // WebView não tem DownloadListener registrado (`MainActivity.java`),
  // então um <a href download> comum navega a tela do Kraken pra fora da
  // conversa (achado real 2026-09-07, ver comentários em paintMessage).
  async function triggerBlobDownload(url, filename) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename || "arquivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (e) {
      alert("erro ao baixar: " + (e && e.message ? e.message : e));
    }
  }

  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || "");
  }

  function isVideoName(name) {
    return /\.(mp4|webm|mov|mkv|m4v|3gp)$/i.test(name || "");
  }

  // ---------- perfil / galeria (2026-08-31, pedido do Gilcimar) ----------
  // Sem rota nova no servidor: a galeria é derivada do que já está em
  // messagesCache (o mesmo /api/messages que já alimenta as conversas) -
  // filtrando só as mensagens de arquivo que EU mandei (sender_id ===
  // senderId()) e que são imagem ou vídeo pelo nome do arquivo. Dado
  // real, sem inventar nada.
  // profileTarget = null → é o SEU próprio perfil. {id, name} → perfil de
  // outra pessoa, aberto tocando no nome dela numa mensagem (pedido do
  // Gilcimar, 2026-08-31). Sem rota nova: filtra messagesCache pelo
  // sender_id de quem estiver sendo visto - mesma mecânica de sempre.
  let profileTarget = null;

  function avatarInitial(name) {
    const n = (name || "?").trim();
    return n ? n[0].toUpperCase() : "?";
  }

  // Checklist 2026-09-07 (item 6) - renderiza o avatar com foto de
  // verdade quando existe, caindo pra inicial do nome quando não (mesmo
  // comportamento de sempre). `fotoId` null/undefined = sem foto.
  function renderAvatar(el, name, fotoId) {
    el.innerHTML = "";
    el.textContent = "";
    if (fotoId && seedHttpUrl) {
      const img = document.createElement("img");
      img.className = "avatar-foto";
      img.src = `${seedHttpUrl}/api/profile/foto/${fotoId}`;
      img.alt = name || "";
      img.onerror = () => { el.innerHTML = ""; el.textContent = avatarInitial(name); };
      el.appendChild(img);
    } else {
      el.textContent = avatarInitial(name);
    }
  }

  function myFotoId() {
    return localStorage.getItem(STORAGE_FOTO_ID);
  }

  function syncProfileModeBadge() {
    // O modo ON/OFF é um estado só local (localStorage), nunca anunciado
    // pra outros nós - não tem como saber de verdade se OUTRA pessoa está
    // ON ou OFF agora. Mostrar um selo aqui pra ela seria inventar dado
    // que não existe, então o selo só aparece no SEU próprio perfil.
    const viewingOther = !!profileTarget;
    profileModeBadge.classList.toggle("hidden", viewingOther);
    if (viewingOther) return;
    const on = !(window.KrakenMode && window.KrakenMode.get() === "off");
    profileModeBadge.classList.toggle("on", on);
    profileModeBadge.classList.toggle("off", !on);
    profileModeBadgeText.textContent = on ? "ON" : "OFF";
  }

  function renderGallery() {
    const targetId = profileTarget ? profileTarget.id : senderId();
    const viewingOther = !!profileTarget;
    const items = messagesCache.filter(
      (m) => m.sender_id === targetId && m.kind === "file" &&
        (isImageName(m.file_name) || isVideoName(m.file_name))
    );
    galleryGrid.innerHTML = "";
    const nFotos = items.filter((m) => isImageName(m.file_name)).length;
    const nVideos = items.length - nFotos;
    profileStats.textContent = items.length
      ? `${nFotos} foto${nFotos === 1 ? "" : "s"} · ${nVideos} vídeo${nVideos === 1 ? "" : "s"}`
      : "Nada na galeria ainda";

    // Ordena mais recente primeiro.
    items.slice().sort((a, b) => b.ts - a.ts).forEach((msg) => {
      const tile = document.createElement("div");
      tile.className = "gallery-tile";
      const isVideo = isVideoName(msg.file_name);
      const media = document.createElement(isVideo ? "video" : "img");
      media.src = "/files/" + msg.id + "/view";
      if (isVideo) {
        media.muted = true;
        media.preload = "metadata"; // mostra o 1º quadro como miniatura, sem baixar o vídeo todo
      }
      tile.appendChild(media);
      if (isVideo) {
        const badge = document.createElement("div");
        badge.className = "gallery-video-badge";
        badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 21,12 5,21"></polygon></svg>';
        tile.appendChild(badge);
      }
      tile.addEventListener("click", () => openMediaViewer(msg, isVideo));
      galleryGrid.appendChild(tile);
    });

    // "Adicionar" só faz sentido na SUA própria galeria - na de outra
    // pessoa não tem como (nem deveria) postar por ela.
    if (!viewingOther) {
      const addTile = document.createElement("div");
      addTile.className = "gallery-add-tile";
      addTile.title = "Adicionar à galeria";
      addTile.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7B2CBF" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
      addTile.addEventListener("click", () => {
        closeProfile();
        fileInput.click();
      });
      galleryGrid.appendChild(addTile);
    }

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent = viewingOther
        ? `${profileTarget.name} ainda não mandou foto ou vídeo em nenhuma conversa com você.`
        : "As fotos e vídeos que você enviar em qualquer conversa aparecem aqui.";
      galleryGrid.insertBefore(empty, galleryGrid.firstChild);
    }
  }

  function openMediaViewer(msg, isVideo) {
    mediaViewerContent.innerHTML = "";
    const media = document.createElement(isVideo ? "video" : "img");
    media.src = "/files/" + msg.id + "/view";
    if (isVideo) { media.controls = true; media.autoplay = true; }
    mediaViewerContent.appendChild(media);
    mediaViewer.classList.remove("hidden");
  }

  function closeMediaViewer() {
    mediaViewer.classList.add("hidden");
    mediaViewerContent.innerHTML = "";
  }

  function switchProfileTab(tab) {
    profileTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    profileTabGaleria.classList.toggle("hidden", tab !== "galeria");
    profileTabSobre.classList.toggle("hidden", tab !== "sobre");
  }

  async function openProfile(target) {
    profileTarget = target || null;
    const displayName = profileTarget ? profileTarget.name : (myName() || "Alguém");
    profileNameEl.textContent = displayName;
    aboutName.textContent = displayName;
    if (profileTarget) {
      // Foto de perfil por conta (item 6) só existe pra MIM mesmo hoje -
      // não tem como saber a conta/e-mail de outra pessoa só pelo
      // NODE_ID dela (são coisas separadas de propósito). Mantém a
      // inicial pra perfil de terceiros, sem inventar dado que não existe.
      profileAvatarBig.textContent = avatarInitial(displayName);
      aboutNodeId.textContent = profileTarget.id || "—";
      profile2faSection.classList.add("hidden"); // 2FA só existe pro PRÓPRIO perfil
    } else {
      await ensureMyIdentity();
      renderAvatar(profileAvatarBig, displayName, myFotoId());
      aboutNodeId.textContent = myNodeId || "—";
      profile2faSection.classList.remove("hidden");
      refresh2faButton();
    }
    syncProfileModeBadge();
    switchProfileTab("galeria");
    renderGallery();
    profileScreen.classList.remove("hidden");
  }

  // Checklist 2026-09-07 (item 8) - 2FA por e-mail. Consulta o estado
  // real no nó-semente toda vez que abre o próprio perfil (não confia
  // em cache local - é config de segurança, quer sempre o dado atual).
  let duploFatorAtivo = false;
  async function refresh2faButton() {
    btn2faToggle.textContent = "…";
    btn2faToggle.disabled = true;
    const token = await ensureWalletToken();
    if (!token) { btn2faToggle.textContent = "indisponível offline"; return; }
    try {
      const res = await fetch(`${seedHttpUrl}/api/profile/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      duploFatorAtivo = !!data.duplo_fator;
      btn2faToggle.textContent = duploFatorAtivo ? "Desativar" : "Ativar";
      btn2faToggle.disabled = false;
    } catch (e) {
      btn2faToggle.textContent = "erro ao consultar";
    }
  }

  btn2faToggle.addEventListener("click", async () => {
    const token = await ensureWalletToken();
    if (!token) return;
    const acaoTexto = duploFatorAtivo ? "desativar" : "ativar";
    const senha = prompt(`Confirma sua senha pra ${acaoTexto} a verificação em duas etapas:`);
    if (!senha) return;
    btn2faToggle.disabled = true;
    try {
      const res = await fetch(`${seedHttpUrl}/api/profile/2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: senha, ativo: !duploFatorAtivo }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || `não deu pra ${acaoTexto}`);
        refresh2faButton();
        return;
      }
      duploFatorAtivo = data.duplo_fator;
      btn2faToggle.textContent = duploFatorAtivo ? "Desativar" : "Ativar";
      btn2faToggle.disabled = false;
      alert(duploFatorAtivo
        ? "Verificação em duas etapas ativada - a partir de agora, todo login vai pedir um código mandado pro seu e-mail."
        : "Verificação em duas etapas desativada.");
    } catch (e) {
      alert("erro: " + (e && e.message ? e.message : e));
      refresh2faButton();
    }
  });

  function closeProfile() {
    profileScreen.classList.add("hidden");
    profileTarget = null;
  }

  btnAvatar.addEventListener("click", () => {
    openProfile(null);
  });
  profileBack.addEventListener("click", closeProfile);

  // ---------- editar foto/nome do perfil (checklist 2026-09-07, item 6) ----------
  // Só faz sentido no PRÓPRIO perfil (profileTarget null) - não dá pra
  // editar a foto/nome de outra pessoa, óbvio, mas o clique só faz
  // alguma coisa nesse caso (em perfil de terceiro, é só um avatar
  // normal, sem affordance nenhuma de edição).
  profileAvatarBig.addEventListener("click", () => {
    if (profileTarget) return;
    profileFotoInput.click();
  });

  profileFotoInput.addEventListener("change", async () => {
    const file = profileFotoInput.files[0];
    profileFotoInput.value = "";
    if (!file) return;
    const token = await ensureWalletToken();
    if (!token) return;
    const form = new FormData();
    form.append("token", token);
    form.append("foto", file);
    try {
      const res = await fetch(`${seedHttpUrl}/api/profile/foto`, { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "não deu pra trocar a foto");
        return;
      }
      localStorage.setItem(STORAGE_FOTO_ID, data.foto_id);
      renderAvatar(profileAvatarBig, myName(), data.foto_id);
      renderAvatar(btnAvatar, myName(), data.foto_id);
    } catch (e) {
      alert("erro ao trocar a foto: " + (e && e.message ? e.message : e));
    }
  });

  // Nome também vinculado à conta agora - clicar no nome (só o SEU
  // próprio) deixa trocar, refletindo pra qualquer aparelho que logar
  // nessa mesma conta depois.
  profileNameEl.addEventListener("click", async () => {
    if (profileTarget) return;
    const novoNome = prompt("Novo nome:", myName() || "");
    if (!novoNome || !novoNome.trim()) return;
    const token = await ensureWalletToken();
    if (!token) return;
    try {
      const res = await fetch(`${seedHttpUrl}/api/profile/update_name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: novoNome.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "não deu pra trocar o nome");
        return;
      }
      localStorage.setItem(STORAGE_NAME, data.name);
      profileNameEl.textContent = data.name;
      aboutName.textContent = data.name;
      renderAvatar(btnAvatar, data.name, myFotoId());
    } catch (e) {
      alert("erro ao trocar o nome: " + (e && e.message ? e.message : e));
    }
  });
  profileTabs.forEach((btn) => btn.addEventListener("click", () => switchProfileTab(btn.dataset.tab)));
  mediaViewerClose.addEventListener("click", closeMediaViewer);
  mediaViewer.addEventListener("click", (e) => { if (e.target === mediaViewer) closeMediaViewer(); });

  function paintMessage(msg) {
    if (messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
    const mine = msg.sender_id === senderId();
    const div = document.createElement("div");
    div.dataset.id = msg.id;
    div.className = "msg " + (mine ? "mine" : "other");
    const sender = document.createElement("span");
    sender.className = "sender";
    sender.textContent = mine ? "Você" : msg.sender_name || "Alguém";
    sender.classList.add("sender-clickable");
    sender.addEventListener("click", () => {
      openProfile(mine ? null : { id: msg.sender_id, name: msg.sender_name || "Alguém" });
    });
    div.appendChild(sender);

    const body = document.createElement("div");
    if (msg.hidden) {
      body.className = "locked";
      body.textContent = "🔒 mensagem cifrada — não é pra você";
    } else if (msg.kind === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none"; // ver comentário grande na criação do <video>, mesmo motivo
      audio.src = "/files/" + msg.id + "/view";
      body.appendChild(audio);
      // Baixar o arquivo bruto - além de ser útil em geral (levar o áudio
      // pra outro app), foi o jeito real de conseguir inspecionar um áudio
      // que gravava mas não tocava (investigação 2026-08-29). ✅ CORRIGIDO
      // (2026-09-07): era um <a href download> puro - o WebView do Android
      // não tem DownloadListener nenhum registrado (`MainActivity.java`),
      // então esse link NAVEGAVA a própria tela do Kraken pra fora da
      // conversa em vez de baixar (o atributo `download` é ignorado sem
      // esse listener). Mesmo bug que quebrava vídeo/imagem, achado
      // testando com o Gilcimar (clicar num vídeo enviado e apertar
      // voltar deixava a página num estado que não mandava mais nada -
      // a navegação embaralhava o socket/estado da SPA). Trocado por
      // download via Blob (busca os bytes com fetch, nunca navega a
      // página de verdade).
      const dl = document.createElement("a");
      dl.href = "#";
      dl.className = "audio-download-link";
      dl.textContent = "⬇ baixar áudio";
      dl.addEventListener("click", (e) => {
        e.preventDefault();
        triggerBlobDownload("/files/" + msg.id, msg.file_name || "audio");
      });
      body.appendChild(dl);
    } else if (msg.kind === "file" && isImageName(msg.file_name)) {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = "/files/" + msg.id + "/view";
      img.alt = msg.file_name || "imagem";
      img.loading = "lazy";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => openMediaViewer(msg, false));
      img.onerror = () => {
        // Arquivo ainda não chegou nesse nó (ex: peer de origem só
        // alcançável na rede local dele, não pela internet) - cai pra
        // texto em vez de deixar o ícone de imagem quebrada.
        const fallback = document.createElement("span");
        fallback.className = "file-link";
        fallback.textContent = "📎 " + (msg.file_name || "imagem") + " (ainda não disponível aqui)";
        img.replaceWith(fallback);
      };
      body.appendChild(img);
    } else if (msg.kind === "file" && isVideoName(msg.file_name)) {
      // Antes era um <a target="_blank"> pro arquivo bruto - achado real
      // (2026-09-07, testando com o Gilcimar): sem suporte a nova janela
      // no WebView (`MainActivity.java` não implementa onCreateWindow), o
      // clique navegava a PRÓPRIA tela do Kraken pra fora da conversa;
      // voltar com o gesto do Android deixava a página num estado onde
      // nada mais enviava (socket/JS não sobrevive a essa ida-e-volta).
      // Vídeo agora toca embutido na conversa (mesmo <video> já usado na
      // Galeria) - nunca navega pra fora da página.
      // ✅ CORRIGIDO (2026-09-07, mesma sessão): preload="none" - achado
      // real testando com o Gilcimar. Por padrão o navegador busca
      // metadado (e às vezes bytes) de TODO elemento <audio>/<video> assim
      // que ele entra na tela, mesmo sem apertar play - com um histórico
      // de dezenas de áudios (ver galeria de mensagens), abrir o chat
      // disparava uma rajada de requisições simultâneas pro servidor local
      // (SQLite + decifra em memória por arquivo) - contenção real que
      // explicava "nada carrega" mesmo tocando manualmente. preload="none"
      // só busca o arquivo quando a pessoa realmente aperta play.
      const video = document.createElement("video");
      video.className = "msg-image";
      video.controls = true;
      video.preload = "none";
      video.src = "/files/" + msg.id + "/view";
      body.appendChild(video);
    } else if (msg.kind === "file") {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "file-link";
      a.textContent = "📎 " + (msg.file_name || "arquivo");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        triggerBlobDownload("/files/" + msg.id + "/view", msg.file_name || "arquivo");
      });
      body.appendChild(a);
    } else if (msg.kind === "gift") {
      // Carteira Exaguinon, Estágio 1 (2026-09-07) - card de presente.
      // O texto guarda um JSON {gift_id, valor, mensagem} - a mensagem em
      // si só sincroniza pela malha normal (mesmo mecanismo de
      // texto/áudio/arquivo), mas resgatar sempre fala direto com o
      // nó-semente (única autoridade sobre saldo de verdade).
      let gift = null;
      try { gift = JSON.parse(msg.text); } catch (e) { /* mensagem antiga/quebrada */ }
      const card = document.createElement("div");
      card.className = "gift-card";
      if (!gift) {
        card.textContent = "🎁 presente (dados corrompidos)";
      } else {
        const titulo = document.createElement("div");
        titulo.className = "gift-titulo";
        titulo.textContent = "🎁 " + gift.valor + " on (Exaguinon de teste)";
        card.appendChild(titulo);
        if (gift.mensagem) {
          const msgEl = document.createElement("div");
          msgEl.className = "gift-mensagem";
          msgEl.textContent = gift.mensagem;
          card.appendChild(msgEl);
        }
        if (mine) {
          const status = document.createElement("div");
          status.className = "gift-status";
          status.textContent = "enviado";
          card.appendChild(status);
        } else {
          const btn = document.createElement("button");
          btn.className = "btn roxo small gift-resgatar";
          btn.textContent = "🎁 resgatar";
          btn.addEventListener("click", () => redeemGift(gift.gift_id, btn));
          card.appendChild(btn);
        }
      }
      body.appendChild(card);
    } else {
      body.textContent = msg.text || "";
    }
    if (mine && (msg.kind === "audio" || msg.kind === "file")) {
      const ack = document.createElement("span");
      ack.className = "seed-ack";
      ack.dataset.ackFor = msg.id;
      setAckIcon(ack, msg.seed_ack);
      body.appendChild(ack);
    }
    div.appendChild(body);

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = fmtTime(msg.ts);
    div.appendChild(time);

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showChat() {
    nameScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    btnAvatar.textContent = avatarInitial(myName());
    // Foto de perfil (checklist 2026-09-07 item 6) - fallback imediato
    // pra inicial (acima), atualiza pra foto de verdade assim que a
    // identidade/seedHttpUrl estiver pronta (não bloqueia a tela).
    ensureMyIdentity().then(() => renderAvatar(btnAvatar, myName(), myFotoId()));
    loadHistory();
    loadGroups();
    connectSocket();
    pollPeers();
    setInterval(pollPeers, 5000);
    setInterval(syncPendingAcks, 10000);
    startCallRelayLoop();
    renderTabs();
    // mesh.display_name (o nome anunciado pra quem te acha na rede local)
    // é só de memória - reseta pro genérico "Nó XXXX" toda vez que o app
    // reinicia. Manda de novo toda vez que entra no chat, não só no login.
    if (myName()) {
      fetch("/api/set_display_name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: myName() }),
      }).catch(() => {});
    }
  }

  // ---------- login / criar conta ----------
  // Só funciona com internet (bate no nó-semente, única "autoridade" que
  // existe pra verificar senha) - mas isso é só na 1ª vez. Depois de
  // logar uma vez, o nome fica salvo local e o app volta a funcionar
  // 100% offline como sempre funcionou (ver "inicialização" no fim do
  // arquivo: só mostra essa tela se ainda não tiver nome salvo).
  let loginMode = "login"; // "login" | "register"

  function setLoginMode(mode) {
    loginMode = mode;
    if (mode === "register") {
      loginName.classList.remove("hidden");
      loginPassword.setAttribute("autocomplete", "new-password");
      loginSubmit.textContent = "Criar conta";
      loginTagline.textContent = "Cria sua conta pra continuar";
      loginToggleMode.textContent = "Já tem conta? Entrar";
      loginForgotPassword.classList.add("hidden");
    } else {
      loginName.classList.add("hidden");
      loginPassword.setAttribute("autocomplete", "current-password");
      loginSubmit.textContent = "Entrar";
      loginTagline.textContent = "Entre com sua conta pra continuar";
      loginToggleMode.textContent = "Não tem conta? Criar agora";
      loginForgotPassword.classList.remove("hidden");
    }
    loginError.classList.add("hidden");
  }

  loginToggleMode.addEventListener("click", () => {
    setLoginMode(loginMode === "login" ? "register" : "login");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("hidden");
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    const name = loginName.value.trim();
    if (loginMode === "register" && !name) {
      loginError.textContent = "Escreve como quer ser chamado.";
      loginError.classList.remove("hidden");
      return;
    }
    loginSubmit.disabled = true;
    const textoOriginal = loginSubmit.textContent;
    loginSubmit.textContent = "Um momento…";
    try {
      // /api/peers é sempre local (funciona sem internet) - só usado aqui
      // pra descobrir o endereço do nó-semente antes de tentar de verdade.
      const peersRes = await fetch("/api/peers");
      const peersData = await peersRes.json();
      seedHttpUrl = peersData.seed_http;
      myNodeId = peersData.node_id;

      const path = loginMode === "register" ? "register" : "login";
      const body = loginMode === "register" ? { email, password, name } : { email, password };
      const res = await fetch(`${seedHttpUrl}/api/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = await res.json();
      if (!res.ok || !data.ok) {
        loginError.textContent = data.error || "Não deu certo. Tenta de novo.";
        loginError.classList.remove("hidden");
        return;
      }
      // Checklist 2026-09-07 (item 8) - conta com 2FA por e-mail ligado:
      // login com senha certa não devolve token ainda, só avisa que um
      // código foi mandado. Pede o código e troca pela resposta de
      // verdade (token/nome/foto) antes de seguir com o fluxo normal.
      if (data.precisa_2fa) {
        const codigo = prompt("Mandamos um código de 6 dígitos pro seu e-mail. Digite ele aqui:");
        if (!codigo) return;
        const res2 = await fetch(`${seedHttpUrl}/api/auth/verify_2fa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, codigo }),
        });
        data = await res2.json();
        if (!res2.ok || !data.ok) {
          loginError.textContent = data.error || "Código incorreto.";
          loginError.classList.remove("hidden");
          return;
        }
      }
      // Checklist 2026-09-07 (item 6) - nome/foto agora vêm da CONTA, não
      // do aparelho. Login/cadastro sempre devolvem o nome/foto atuais
      // de verdade (mesmo se essa conta já tiver logado em outro
      // celular antes e trocado o nome/foto por lá).
      localStorage.setItem(STORAGE_NAME, data.name);
      localStorage.setItem(STORAGE_LOGGED_IN, "1");
      if (data.token) localStorage.setItem(STORAGE_WALLET_TOKEN, data.token);
      if (data.foto_id) localStorage.setItem(STORAGE_FOTO_ID, data.foto_id);
      else localStorage.removeItem(STORAGE_FOTO_ID);
      showChat();
    } catch (e) {
      loginError.textContent = "Precisa de internet pra entrar (ou criar conta) pela primeira vez.";
      loginError.classList.remove("hidden");
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = textoOriginal;
    }
  });

  // ---------- esqueci minha senha (achado real do Gilcimar, 2026-09-07) ----------
  // Mesmo padrão de diálogo simples (prompt/alert) já usado no código de
  // 2FA acima, em vez de construir uma tela nova - a MainActivity já
  // implementa onJsPrompt/onJsAlert (corrigido nesta mesma sessão), então
  // esses diálogos aparecem de verdade no app Android.
  loginForgotPassword.addEventListener("click", async () => {
    const email = (prompt("Qual o e-mail da sua conta?", loginEmail.value.trim()) || "").trim();
    if (!email) return;
    try {
      const peersRes = await fetch("/api/peers");
      const peersData = await peersRes.json();
      seedHttpUrl = peersData.seed_http;
      await fetch(`${seedHttpUrl}/api/auth/forgot_password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (e) {
      alert("Precisa de internet pra recuperar a senha.");
      return;
    }
    alert("Se esse e-mail tiver conta, mandamos um código de recuperação pra ele. Confira sua caixa de entrada.");

    const codigo = (prompt("Digite o código de 6 dígitos que chegou no seu e-mail:") || "").trim();
    if (!codigo) return;
    const novaSenha = prompt("Digite sua NOVA senha (mínimo 6 caracteres):");
    if (!novaSenha) return;

    try {
      const res = await fetch(`${seedHttpUrl}/api/auth/reset_password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, codigo, nova_senha: novaSenha }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "não deu pra trocar a senha - tenta de novo");
        return;
      }
      // Mesma lógica de sucesso do login normal - a troca de senha já
      // devolve um token novo, entra direto sem pedir a senha de novo.
      localStorage.setItem(STORAGE_NAME, data.name);
      localStorage.setItem(STORAGE_LOGGED_IN, "1");
      if (data.token) localStorage.setItem(STORAGE_WALLET_TOKEN, data.token);
      if (data.foto_id) localStorage.setItem(STORAGE_FOTO_ID, data.foto_id);
      else localStorage.removeItem(STORAGE_FOTO_ID);
      alert("Senha trocada! Você já está logado.");
      showChat();
    } catch (e) {
      alert("Precisa de internet pra trocar a senha.");
    }
  });

  async function loadHistory() {
    const res = await fetch("/api/messages");
    const msgs = await res.json();
    messagesCache = msgs;
    redrawMessages();
  }

  function connectSocket() {
    const socket = io();
    // O texto de status é sempre controlado por pollPeers (contagem de nós
    // na malha) - aqui só controla a cor do ponto, pra evitar os dois
    // ficarem brigando pra escrever em statusText.textContent ao mesmo
    // tempo (bug visto: piscava "offline" mesmo com a malha ativa).
    socket.on("connect", () => {
      statusDot.classList.add("online");
    });
    socket.on("disconnect", () => {
      statusDot.classList.remove("online");
    });
    socket.on("new_message", (msg) => {
      addMessage(msg);
    });
    socket.on("file_ack", (data) => {
      updateSeedAckStatus(data.id, data.seed_ack);
    });
    socket.on("incoming_call", (data) => handleIncomingCall(data));
    socket.on("call_answered", (data) => handleCallAnswered(data));
    socket.on("call_rejected", (data) => handleCallRejected(data));
    socket.on("call_hangup", (data) => handleCallHangup(data));
  }

  async function pollPeers() {
    try {
      const res = await fetch("/api/peers");
      const data = await res.json();
      const n = data.peers.length;
      if (n > 0) {
        statusDot.classList.add("mesh");
        statusText.textContent = n === 1 ? "1 nó na malha" : n + " nós na malha";
      } else {
        statusDot.classList.remove("mesh");
        statusText.textContent = "sozinho por enquanto";
      }
    } catch (e) {
      // ignora falha de rede momentânea
    }
  }

  sendForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    let url = "/api/send";
    const body = { text, sender_id: senderId(), sender_name: myName() };
    if (currentConv.type === "direct") {
      url = "/api/send_direct";
      body.recipient_id = currentConv.peer_id;
    } else if (currentConv.type === "group") {
      url = "/api/send_group";
      body.group_id = currentConv.group_id;
    }
    // ✅ CORRIGIDO (2026-09-07): faltava try/catch aqui - mesma lição já
    // aplicada em uploadBlob() no v30, nunca trazida pro envio de texto.
    // Se o fetch falhasse (servidor local sem responder, rede caindo no
    // meio), a promise rejeitava sem ninguém pegar - zero alerta, mensagem
    // perdida em silêncio, e o campo já tinha sido limpo (parecia enviado).
    // Achado real testando com o Gilcimar: texto simples "não veio" sem
    // erro nenhum na tela.
    textInput.value = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...krakenKeyHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) addMessage(data.message);
      else {
        alert(data.error || "erro ao enviar mensagem");
        textInput.value = text; // devolve o texto - não deixa perder o que a pessoa digitou
      }
    } catch (err) {
      alert("erro ao enviar: " + (err && err.message ? err.message : err));
      textInput.value = text;
    }
  });

  async function uploadBlob(blob, kind, filename) {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("sender_id", senderId());
    form.append("sender_name", myName());
    form.append("kind", kind);
    if (currentConv.type === "direct") {
      form.append("scope", "direct");
      form.append("recipient_id", currentConv.peer_id);
    } else if (currentConv.type === "group") {
      form.append("scope", "group");
      form.append("group_id", currentConv.group_id);
    } else {
      form.append("scope", "global");
    }
    statusText.textContent = "enviando…";
    // Achado real 2026-08-30: aqui não tinha try/catch nenhum. Se o fetch
    // falhasse por qualquer motivo (Blob de content:// URI ilegível, rede
    // caindo no meio, resposta que não é JSON), a promise rejeitava sem
    // ninguém pegar - zero alerta, mensagem nunca aparecia, e o "enviando…"
    // só saía do ar porque pollPeers (relógio separado, a cada 5s) pisava
    // por cima do texto sem relação nenhuma com o upload em si. Isso fazia
    // parecer que "ficou enviando e não foi" sem nunca mostrar o erro real.
    try {
      const res = await fetch("/api/upload", { method: "POST", headers: krakenKeyHeaders(), body: form });
      const data = await res.json();
      if (data.ok) addMessage(data.message);
      else alert(data.error || "erro ao enviar");
    } catch (e) {
      alert("erro ao enviar: " + (e && e.message ? e.message : e));
    } finally {
      pollPeers();
    }
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadBlob(file, "file", file.name);
    fileInput.value = "";
  });

  // Alternativa nativa de gravar áudio - o atributo "capture" faz o
  // Android abrir o gravador de som DE VERDADE do aparelho (fora do
  // WebView, sem passar por getUserMedia nenhum) em vez do seletor de
  // arquivo comum. Usada como resposta automática quando a gravação ao
  // vivo (🎙️) falha - pedido do Gilcimar depois de o microfone ficar
  // preso no WebView mesmo com o hardware liberado.
  audioCaptureInput.addEventListener("change", async () => {
    const file = audioCaptureInput.files[0];
    if (!file) return;
    await uploadBlob(file, "audio", file.name || "audio.m4a");
    audioCaptureInput.value = "";
  });

  // ---------- gravação de áudio (com onda sonora ao vivo + prévia) ----------
  let mediaRecorder = null;
  let recordedChunks = [];
  let pendingAudioBlob = null;
  let discardNextRecording = false;
  let audioCtx = null;
  let waveRAF = null;
  let recordTimerInterval = null;
  let recordStartTs = 0;

  // Mesmo princípio já usado na chamada de vídeo (visibilitychange perto da
  // linha 185) - achado real 2026-08-31: aquela limpeza só cobria
  // `callState`, não a gravação de mensagem de voz. Se o app fosse pro
  // segundo plano NO MEIO de uma gravação (troca de app, bloqueio de
  // tela), o microfone nunca era liberado - toda tentativa seguinte, pro
  // resto da vida dessa janela do WebView, passava a falhar com
  // `NotReadableError: Could not start audio source`, MESMO sem nenhum
  // outro app usando o microfone (confirmado ao vivo: reportado logo
  // depois de uma gravação ter cortado sozinha no testaudio.py - mesmo
  // mecanismo do navegador pausando captura em 2º plano, só que ali sem
  // consequência porque cada teste abre uma aba nova/processo novo).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      discardNextRecording = true;
      mediaRecorder.stop(); // dispara onstop, que já solta as tracks
    }
  });

  function startWaveform(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const ctx = recordWave.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);

    recordStartTs = Date.now();
    recordTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - recordStartTs) / 1000);
      recordTimer.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }, 250);

    const draw = () => {
      waveRAF = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, recordWave.width, recordWave.height);
      const barW = recordWave.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const h = (data[i] / 255) * recordWave.height;
        ctx.fillStyle = "#00A651";
        ctx.fillRect(i * barW, recordWave.height - h, Math.max(barW - 1, 1), h);
      }
    };
    draw();
  }

  function stopWaveform() {
    if (waveRAF) cancelAnimationFrame(waveRAF);
    if (recordTimerInterval) clearInterval(recordTimerInterval);
    if (audioCtx) audioCtx.close();
    waveRAF = null;
    recordTimerInterval = null;
    audioCtx = null;
    recordTimer.textContent = "0:00";
  }

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // Achado real (2026-08-27): em alguns celulares o microfone via
      // WebView (getUserMedia) fica indisponível mesmo com o hardware
      // livre e a permissão certa - é limitação da própria WebView, não
      // do Kraken.
      //
      // MUDANÇA (2026-08-31): até aqui, caía automaticamente e em
      // silêncio pro gravador NATIVO do Android (audioCaptureInput).
      // Achado real na mesma data: o gravador nativo desse tipo de
      // aparelho (Xiaomi/MIUI) produz áudio SEM SOM nenhum quando
      // chamado por outro app via intent (RECORD_SOUND_ACTION) - achado
      // testando o testaudio.py isolado (gravação ao vivo saiu com som
      // real, confirmado com ffprobe/volumedetect) e batendo o nome do
      // arquivo problemático anterior ("30 de ago. 23.38.m4a", padrão
      // do nativo) com esse mesmo caminho de fallback silencioso.
      // Cair escondido nesse caminho quebrado produzia uma mensagem de
      // voz muda sem avisar nada - pior que simplesmente mostrar o erro
      // real. Agora mostra o erro e PERGUNTA antes de tentar o nativo
      // (continua disponível como último recurso manual, não mais
      // automático/silencioso).
      console.warn("Gravação ao vivo falhou:", e.name, e.message);
      const tentarNativo = confirm(
        `Não consegui abrir o microfone do navegador (${e.name || "erro"}: ` +
        `${e.message || "sem detalhe"}).\n\n` +
        `Quer tentar o gravador de som do celular em vez disso? ` +
        `(atenção: em alguns aparelhos ele grava sem som - se sair mudo, ` +
        `esse é o motivo, não é a mensagem que se perdeu)`
      );
      if (tentarNativo) audioCaptureInput.click();
      return;
    }
    try {
      recordedChunks = [];
      discardNextRecording = false;
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopWaveform();
        recordBtn.classList.remove("recording");
        recordBar.classList.add("hidden");
        if (discardNextRecording) {
          discardNextRecording = false;
          return;
        }
        pendingAudioBlob = new Blob(recordedChunks, { type: "audio/webm" });
        previewAudio.src = URL.createObjectURL(pendingAudioBlob);
        previewBar.classList.remove("hidden");
      };
      mediaRecorder.start();
      recordBtn.classList.add("recording");
      recordBar.classList.remove("hidden");
      startWaveform(stream);
    } catch (e) {
      // Achado real (2026-08-27): antes disso, se algo desse errado DEPOIS
      // de já ter conseguido o stream (ex: MediaRecorder falhar ao criar),
      // a stream nunca era liberada - o microfone ficava preso pra sempre
      // (até fechar o app de verdade), fazendo a PRÓXIMA tentativa falhar
      // também, mesmo sem nenhum outro app usando o microfone.
      stream.getTracks().forEach((t) => t.stop());
      alert(`Não consegui gravar o áudio.\n${e.name || "Erro"}: ${e.message || "sem detalhe"}`);
    }
  }

  recordBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") return;
    startRecording();
  });

  recordStopBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  });

  recordCancelBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      discardNextRecording = true;
      mediaRecorder.stop();
    }
  });

  previewCancelBtn.addEventListener("click", () => {
    pendingAudioBlob = null;
    previewAudio.src = "";
    previewBar.classList.add("hidden");
  });

  previewSendBtn.addEventListener("click", async () => {
    if (!pendingAudioBlob) return;
    const blob = pendingAudioBlob;
    pendingAudioBlob = null;
    previewAudio.src = "";
    previewBar.classList.add("hidden");
    await uploadBlob(blob, "audio", "audio.webm");
  });

  // ---------- inicialização ----------
  if (demoName || localStorage.getItem(STORAGE_LOGGED_IN)) {
    showChat();
  } else {
    setLoginMode("login");
    nameScreen.classList.remove("hidden");
  }
  if (demoName) {
    document.title = "Kraken — " + demoName;
  }
  maybeShowAppBanner();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
