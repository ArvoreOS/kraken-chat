"""Kraken Testcall - app de teste ISOLADO, só pra provar o mecanismo de
chamada de vídeo/áudio via internet (WebRTC P2P + Oracle só como
"cupido" que apresenta um lado pro outro), sem nenhuma lógica de malha
offline, mensagem, cripto de grupo ou qualquer outra coisa do Kraken
principal.

Pedido do Gilcimar (2026-08-31): ele notou confusão entre os dois modos
do Kraken (malha P2P local sem internet vs. chat online normal com
internet, tipo YouTube/TikTok) e pediu um app separado só pra validar
que "câmera + áudio de um lado pro outro, usando a Oracle só de base"
funciona limpo. Este arquivo é exatamente isso - zero dependência do
resto do server.py, só compartilha a porta 7000 (já liberada no
firewall) por praticidade, registrado como Blueprint.

Modelo mental confirmado (é assim que a chamada de vídeo REAL do Kraken
já funciona, desde 27/08 - isso não muda nada nela, só isola o mesmo
princípio num app mínimo pra testar sem ruído):
- SEM internet: só malha local (broadcast UDP + gossip TCP), mensagem
  de texto/arquivo só chega em quem já tem um peer alcançável na hora
  (guarda-e-repassa quando volta a ter peer).
- COM internet: vira um chat online normal - áudio/vídeo/chamada ao
  vivo funcionam ponta a ponta (P2P de verdade, o vídeo/áudio NUNCA
  passa pela Oracle, só o "aperto de mão" inicial), like WhatsApp/Zoom.

Protocolo aqui (sem ICE trickle, mesmo padrão já testado e funcionando
na chamada de vídeo real do Kraken - mais simples, espera juntar os
candidatos antes de mandar a oferta/resposta):
  POST /api/testcall/offer  {room, sdp}  -> guarda a oferta da sala
  GET  /api/testcall/offer?room=X        -> quem vai atender fica
                                              perguntando até aparecer
  POST /api/testcall/answer {room, sdp}  -> guarda a resposta
  GET  /api/testcall/answer?room=X       -> quem ligou fica perguntando
                                              até aparecer
Sala em memória (dict simples, thread-safe com Lock) - reinicia com o
processo, não precisa de banco, é só um teste.
"""
import threading
import time

from flask import Blueprint, Response, jsonify, request

testcall_bp = Blueprint("testcall", __name__)

_lock = threading.Lock()
_rooms = {}  # room -> {"offer": sdp|None, "answer": sdp|None, "ts": float}

_ROOM_TTL = 3600  # salas esquecidas há mais de 1h somem sozinhas (só limpeza)


def _touch(room):
    _rooms.setdefault(room, {"offer": None, "answer": None})
    _rooms[room]["ts"] = time.time()


def _gc():
    now = time.time()
    dead = [r for r, v in _rooms.items() if now - v.get("ts", 0) > _ROOM_TTL]
    for r in dead:
        del _rooms[r]


@testcall_bp.route("/api/testcall/offer", methods=["POST"])
def post_offer():
    data = request.get_json(force=True) or {}
    room = (data.get("room") or "").strip()[:64]
    sdp = data.get("sdp")
    if not room or not sdp:
        return jsonify({"ok": False, "error": "room/sdp faltando"}), 400
    with _lock:
        _gc()
        _touch(room)
        _rooms[room]["offer"] = sdp
        _rooms[room]["answer"] = None  # nova ligação limpa resposta velha
    return jsonify({"ok": True})


@testcall_bp.route("/api/testcall/offer", methods=["GET"])
def get_offer():
    room = (request.args.get("room") or "").strip()[:64]
    with _lock:
        sdp = _rooms.get(room, {}).get("offer")
    return jsonify({"sdp": sdp})


@testcall_bp.route("/api/testcall/answer", methods=["POST"])
def post_answer():
    data = request.get_json(force=True) or {}
    room = (data.get("room") or "").strip()[:64]
    sdp = data.get("sdp")
    if not room or not sdp:
        return jsonify({"ok": False, "error": "room/sdp faltando"}), 400
    with _lock:
        _touch(room)
        _rooms[room]["answer"] = sdp
    return jsonify({"ok": True})


@testcall_bp.route("/api/testcall/answer", methods=["GET"])
def get_answer():
    room = (request.args.get("room") or "").strip()[:64]
    with _lock:
        sdp = _rooms.get(room, {}).get("answer")
    return jsonify({"sdp": sdp})


@testcall_bp.route("/api/testcall/reset", methods=["POST"])
def reset_room():
    """Limpa a sala pra testar de novo do zero sem trocar o nome."""
    data = request.get_json(force=True) or {}
    room = (data.get("room") or "").strip()[:64]
    with _lock:
        _rooms.pop(room, None)
    return jsonify({"ok": True})


_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kraken Testcall</title>
<style>
  body{font-family:sans-serif;background:#111;color:#eee;padding:16px;margin:0}
  h1{font-size:18px;color:#fff}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
  input{flex:1;min-width:120px;padding:10px;border-radius:8px;border:1px solid #444;
    background:#1c1c1c;color:#fff;font-size:14px}
  button{padding:10px 16px;border-radius:8px;border:0;background:#7B2CBF;color:#fff;
    font-size:14px;font-weight:bold}
  button:disabled{opacity:.4}
  video{width:48%;background:#000;border-radius:8px;aspect-ratio:3/4;object-fit:cover}
  #status{margin:10px 0;color:#0f8;font-size:13px;min-height:18px}
  .videos{display:flex;gap:4%}
</style></head><body>
<h1>🐙 Kraken Testcall — teste isolado de câmera/áudio via Oracle</h1>
<p style="color:#999;font-size:12px">Zero malha, zero mensagem, zero cripto — só WebRTC P2P
de verdade (vídeo/áudio nunca passa pela Oracle) usando esta página só como sinalização inicial.
Abra este link nos DOIS aparelhos, use o MESMO código de sala nos dois.</p>
<div class="row">
  <input id="room" placeholder="código da sala (ex: gil-teste)">
</div>
<div class="row">
  <button id="btnStart">🎥 Ligar câmera/mic</button>
  <button id="btnCall" disabled>📞 Ligar</button>
  <button id="btnAnswer" disabled>✅ Atender</button>
  <button id="btnHangup" disabled>❌ Encerrar</button>
</div>
<div id="status">parado</div>
<div class="videos">
  <video id="local" autoplay playsinline muted></video>
  <video id="remote" autoplay playsinline></video>
</div>
<script>
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
let pc = null, localStream = null, pollTimer = null;

function setStatus(t) { statusEl.textContent = t; console.log("[testcall]", t); }

function roomName() {
  const p = new URLSearchParams(location.search).get("room");
  if (p && !$("room").value) $("room").value = p;
  return $("room").value.trim();
}
roomName();

function makePC() {
  const p = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  p.ontrack = (ev) => { $("remote").srcObject = ev.streams[0]; };
  p.oniceconnectionstatechange = () => setStatus("conexão: " + p.iceConnectionState);
  return p;
}

function waitIceComplete(p) {
  if (p.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (p.iceGatheringState === "complete") {
        p.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    p.addEventListener("icegatheringstatechange", check);
  });
}

$("btnStart").addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $("local").srcObject = localStream;
    $("btnCall").disabled = false;
    $("btnAnswer").disabled = false;
    $("btnStart").disabled = true;
    setStatus("câmera/mic ligados - agora aperte Ligar (quem inicia) ou Atender (quem recebe)");
  } catch (e) {
    setStatus("erro ao abrir câmera/mic: " + (e.name || "") + " " + (e.message || e));
  }
});

async function startCommon() {
  const room = roomName();
  if (!room) { setStatus("digite um código de sala primeiro"); return null; }
  if (!localStream) { setStatus("aperta 'Ligar câmera/mic' primeiro"); return null; }
  pc = makePC();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  $("btnHangup").disabled = false;
  $("btnCall").disabled = true;
  $("btnAnswer").disabled = true;
  return room;
}

$("btnCall").addEventListener("click", async () => {
  const room = await startCommon();
  if (!room) return;
  await fetch("/api/testcall/reset", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room }),
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  setStatus("preparando oferta (juntando candidatos de rede)...");
  await waitIceComplete(pc);
  await fetch("/api/testcall/offer", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, sdp: pc.localDescription }),
  });
  setStatus("oferta mandada - esperando o outro lado atender...");
  pollTimer = setInterval(async () => {
    const res = await fetch("/api/testcall/answer?room=" + encodeURIComponent(room));
    const data = await res.json();
    if (data.sdp) {
      clearInterval(pollTimer);
      await pc.setRemoteDescription(data.sdp);
      setStatus("atendido! conectando...");
    }
  }, 1500);
});

$("btnAnswer").addEventListener("click", async () => {
  const room = await startCommon();
  if (!room) return;
  setStatus("procurando oferta na sala...");
  pollTimer = setInterval(async () => {
    const res = await fetch("/api/testcall/offer?room=" + encodeURIComponent(room));
    const data = await res.json();
    if (data.sdp) {
      clearInterval(pollTimer);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      setStatus("preparando resposta...");
      await waitIceComplete(pc);
      await fetch("/api/testcall/answer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, sdp: pc.localDescription }),
      });
      setStatus("resposta mandada - conectando...");
    }
  }, 1500);
});

$("btnHangup").addEventListener("click", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (pc) { pc.close(); pc = null; }
  $("remote").srcObject = null;
  $("btnHangup").disabled = true;
  $("btnCall").disabled = false;
  $("btnAnswer").disabled = false;
  setStatus("encerrado - pode ligar de novo");
});
</script>
</body></html>"""


@testcall_bp.route("/testcall")
def testcall_page():
    return Response(_PAGE, mimetype="text/html")
