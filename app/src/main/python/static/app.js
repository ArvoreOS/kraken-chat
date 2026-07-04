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
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  // Parâmetros de URL só para simulação/teste (?demo_name=Ana&demo_id=phoneA).
  // Não afetam o uso normal, que continua guardando tudo em localStorage.
  const demoParams = new URLSearchParams(location.search);
  const demoName = demoParams.get("demo_name");
  const demoId = demoParams.get("demo_id");

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

  function renderMessage(msg) {
    if (messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
    const mine = msg.sender_id === senderId();
    const div = document.createElement("div");
    div.dataset.id = msg.id;
    div.className = "msg " + (mine ? "mine" : "other");
    const sender = document.createElement("span");
    sender.className = "sender";
    sender.textContent = mine ? "Você" : (msg.sender_name || "Alguém");
    div.appendChild(sender);

    const body = document.createElement("div");
    if (msg.kind === "file") {
      const a = document.createElement("a");
      a.href = "/files/" + msg.id;
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
    connectSocket();
    pollPeers();
    setInterval(pollPeers, 5000);
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
    messagesEl.innerHTML = "";
    msgs.forEach(renderMessage);
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
      renderMessage(msg);
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
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sender_id: senderId(), sender_name: myName() }),
    });
    const data = await res.json();
    if (data.ok) renderMessage(data.message);
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("sender_id", senderId());
    form.append("sender_name", myName());
    statusText.textContent = "enviando arquivo…";
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) renderMessage(data.message);
    fileInput.value = "";
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
