(function () {
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

  const nameScreen = document.getElementById("name-screen");
  const chatScreen = document.getElementById("chat-screen");
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginName = document.getElementById("login-name");
  const loginError = document.getElementById("login-error");
  const loginSubmit = document.getElementById("login-submit");
  const loginToggleMode = document.getElementById("login-toggle-mode");
  const loginTagline = document.getElementById("login-tagline");
  const messagesEl = document.getElementById("messages");
  const sendForm = document.getElementById("send-form");
  const textInput = document.getElementById("text-input");
  const fileInput = document.getElementById("file-input");
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
  const btnLive = document.getElementById("btn-live");

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
    callLocalVideo.srcObject = null;
    callAcceptBtn.classList.add("hidden");
    callRejectBtn.classList.add("hidden");
    callHangupBtn.classList.add("hidden");
  }

  function newCallId() {
    return "call-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

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
    };
    return pc;
  }

  // Pega câmera/microfone e devolve {stream} ou {error} com o motivo real -
  // a mensagem genérica de antes ("confere a permissão") escondia se o
  // problema era permissão negada de verdade (NotAllowedError), câmera não
  // encontrada (NotFoundError), câmera ocupada por outro app
  // (NotReadableError), ou a API nem existir nesse navegador/contexto
  // (TypeError - ex: página carregada por http:// num IP, não localhost -
  // getUserMedia só existe em contexto seguro).
  async function getCallMediaStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { error: "getUserMedia indisponível nesse navegador (a API só existe em contexto seguro - localhost/https)." };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      return { stream };
    } catch (e) {
      return { error: `${e.name || "Erro"}: ${e.message || "sem detalhe"}` };
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
    const lanPeers = (data.peers || [])
      .filter((p) => !p.id.startsWith("bootstrap-"))
      .map((p) => ({ id: p.id, name: p.name || "Nó", via: "lan", ip: p.ip, port: p.port }));

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
    const callId = newCallId();
    const { stream, error } = await getCallMediaStream();
    if (error) {
      openModal(`<h3>Chamada de vídeo</h3><p class='muted'>Não consegui acessar câmera/microfone.</p><p class='muted' style="font-size:11px">${error}</p>`);
      return;
    }
    const pc = makePeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    callState = { call_id: callId, role: "caller", pc, localStream: stream, peer };

    callScreen.classList.remove("hidden");
    callLocalVideo.srcObject = stream;
    callStatusText.textContent = `Chamando ${peer.name}…`;
    callHangupBtn.classList.remove("hidden");

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

  function startCallRelayLoop() {
    callRelayHeartbeat();
    callRelayPoll();
    setInterval(callRelayHeartbeat, 5000);
    setInterval(callRelayPoll, 2000);
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
    const { stream, error } = await getCallMediaStream();
    if (error) {
      openModal(`<h3>Chamada de vídeo</h3><p class='muted'>Não consegui acessar câmera/microfone.</p><p class='muted' style="font-size:11px">${error}</p>`);
      rejectCall();
      return;
    }
    const pc = makePeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    callState.pc = pc;
    callState.localStream = stream;
    callLocalVideo.srcObject = stream;
    callAcceptBtn.classList.add("hidden");
    callRejectBtn.classList.add("hidden");
    callHangupBtn.classList.remove("hidden");
    callStatusText.textContent = `Em chamada com ${peer.name}`;

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
    await callState.pc.setRemoteDescription(data.sdp);
    callStatusText.textContent = `Em chamada com ${callState.peer.name}`;
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

  btnLive.addEventListener("click", openPeerPicker);
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
    const token = encodeInvite(data.invite);
    openModal(`
      <h3>Grupo criado!</h3>
      <p>Compartilhe este código pra convidar (WhatsApp, e-mail, etc):</p>
      <textarea id="invite-out" rows="4" readonly></textarea>
      <button id="modal-close-btn" class="btn verde">Entendi</button>
    `);
    const out = document.getElementById("invite-out");
    out.value = token;
    out.addEventListener("click", () => out.select());
    document.getElementById("modal-close-btn").addEventListener("click", closeModal);
    setConversation({ type: "group", group_id: data.group.id, name: data.group.name });
  }

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

  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || "");
  }

  function paintMessage(msg) {
    if (messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
    const mine = msg.sender_id === senderId();
    const div = document.createElement("div");
    div.dataset.id = msg.id;
    div.className = "msg " + (mine ? "mine" : "other");
    const sender = document.createElement("span");
    sender.className = "sender";
    sender.textContent = mine ? "Você" : msg.sender_name || "Alguém";
    div.appendChild(sender);

    const body = document.createElement("div");
    if (msg.hidden) {
      body.className = "locked";
      body.textContent = "🔒 mensagem cifrada — não é pra você";
    } else if (msg.kind === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = "/files/" + msg.id + "/view";
      body.appendChild(audio);
    } else if (msg.kind === "file" && isImageName(msg.file_name)) {
      const a = document.createElement("a");
      a.href = "/files/" + msg.id + "/view";
      a.target = "_blank";
      a.className = "file-link";
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = "/files/" + msg.id + "/view";
      img.alt = msg.file_name || "imagem";
      img.loading = "lazy";
      img.onerror = () => {
        // Arquivo ainda não chegou nesse nó (ex: peer de origem só
        // alcançável na rede local dele, não pela internet) - cai pra
        // link em vez de deixar o ícone de imagem quebrada.
        img.remove();
        a.textContent = "📎 " + (msg.file_name || "imagem") + " (ainda não disponível aqui)";
      };
      a.appendChild(img);
      body.appendChild(a);
    } else if (msg.kind === "file") {
      const a = document.createElement("a");
      a.href = "/files/" + msg.id + "/view";
      a.className = "file-link";
      a.target = "_blank";
      a.textContent = "📎 " + (msg.file_name || "arquivo");
      body.appendChild(a);
    } else {
      body.textContent = msg.text || "";
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
    loadHistory();
    loadGroups();
    connectSocket();
    pollPeers();
    setInterval(pollPeers, 5000);
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
    } else {
      loginName.classList.add("hidden");
      loginPassword.setAttribute("autocomplete", "current-password");
      loginSubmit.textContent = "Entrar";
      loginTagline.textContent = "Entre com sua conta pra continuar";
      loginToggleMode.textContent = "Não tem conta? Criar agora";
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
      const data = await res.json();
      if (!res.ok || !data.ok) {
        loginError.textContent = data.error || "Não deu certo. Tenta de novo.";
        loginError.classList.remove("hidden");
        return;
      }
      localStorage.setItem(STORAGE_NAME, data.name);
      localStorage.setItem(STORAGE_LOGGED_IN, "1");
      showChat();
    } catch (e) {
      loginError.textContent = "Precisa de internet pra entrar (ou criar conta) pela primeira vez.";
      loginError.classList.remove("hidden");
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = textoOriginal;
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
    textInput.value = "";
    let url = "/api/send";
    const body = { text, sender_id: senderId(), sender_name: myName() };
    if (currentConv.type === "direct") {
      url = "/api/send_direct";
      body.recipient_id = currentConv.peer_id;
    } else if (currentConv.type === "group") {
      url = "/api/send_group";
      body.group_id = currentConv.group_id;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) addMessage(data.message);
    else alert(data.error || "erro ao enviar mensagem");
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
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) addMessage(data.message);
    else alert(data.error || "erro ao enviar");
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadBlob(file, "file", file.name);
    fileInput.value = "";
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      alert("não foi possível acessar o microfone");
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
