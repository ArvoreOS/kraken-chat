(function () {
  const STORAGE_NAME = "kraken_name";
  const STORAGE_ID = "kraken_sender_id";

  const nameScreen = document.getElementById("name-screen");
  const chatScreen = document.getElementById("chat-screen");
  const nameInput = document.getElementById("name-input");
  const nameSubmit = document.getElementById("name-submit");
  const messagesEl = document.getElementById("messages");
  const sendForm = document.getElementById("send-form");
  const textInput = document.getElementById("text-input");
  const fileInput = document.getElementById("file-input");
  const recordBtn = document.getElementById("record-btn");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const tabsEl = document.getElementById("tabs");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalContent = document.getElementById("modal-content");

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
    renderTabs();
  }

  nameSubmit.addEventListener("click", () => {
    const v = nameInput.value.trim();
    if (!v) return;
    localStorage.setItem(STORAGE_NAME, v);
    showChat();
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameSubmit.click();
  });

  async function loadHistory() {
    const res = await fetch("/api/messages");
    const msgs = await res.json();
    messagesCache = msgs;
    redrawMessages();
  }

  function connectSocket() {
    const socket = io();
    socket.on("connect", () => {
      statusDot.classList.add("online");
      statusText.textContent = "conectado";
    });
    socket.on("disconnect", () => {
      statusDot.classList.remove("online");
      statusText.textContent = "offline";
    });
    socket.on("new_message", (msg) => {
      addMessage(msg);
    });
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

  // ---------- gravação de áudio ----------
  let mediaRecorder = null;
  let recordedChunks = [];

  recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordBtn.classList.remove("recording");
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        await uploadBlob(blob, "audio", "audio.webm");
      };
      mediaRecorder.start();
      recordBtn.classList.add("recording");
    } catch (e) {
      alert("não foi possível acessar o microfone");
    }
  });

  // ---------- inicialização ----------
  if (myName()) {
    showChat();
  } else {
    nameScreen.classList.remove("hidden");
  }
  if (demoName) {
    document.title = "Kraken — " + demoName;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
