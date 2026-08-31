"""Kraken Testaudio - app de teste ISOLADO pra enviar/receber mensagem de
voz ou arquivo de áudio, mesmo espírito do testcall.py: zero malha,
zero cripto, zero mesh - só upload/lista/player puro, servidor como
"caixa postal" comum (modelo online normal, tipo WhatsApp: sobe pro
servidor, quem tem o link/sala baixa e toca).

Pedido do Gilcimar (2026-08-31), mesma sessão do testcall.py - depois de
confirmar que a chamada de vídeo funciona limpo, quis o mesmo tipo de
teste isolado pra mensagem de voz/áudio, pra separar bug de gravação
(gravador nativo do Android, RECORD_SOUND_ACTION) de bug de player
(Service Worker, já corrigido no v31) sem o ruído do resto do Kraken.

Duas formas de mandar áudio nesta página, de propósito:
1. "Gravar" - MediaRecorder ao vivo, direto do getUserMedia do navegador
   (NÃO passa pelo gravador nativo do Android) - se isso sair com som e
   a gravação de voz do Kraken de verdade sair muda, isola de vez que o
   problema é no RECORD_SOUND_ACTION nesse aparelho, não no Kraken.
2. "Enviar arquivo" - sobe um arquivo já existente (ex: puxar um áudio
   do WhatsApp) - testa só upload+player, sem depender de captura nenhuma.

Detecção de formato pelos bytes reais (mesma lógica já testada e usada
em produção no server.py - _mime_real/_is_adts_aac) duplicada aqui de
propósito pra manter esse arquivo 100% independente, sem importar nada
do resto do Kraken.
"""
import threading
import time
import uuid
import re as _re

from flask import Blueprint, Response, jsonify, request

testaudio_bp = Blueprint("testaudio", __name__)

_lock = threading.Lock()
_items = {}          # id -> {"room":, "sender":, "ts":, "filename":, "data": bytes}
_rooms_order = {}     # room -> [id, id, ...] em ordem de chegada


def _is_adts_aac(data: bytes) -> bool:
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0


def _mime_real(data: bytes, filename: str) -> str:
    if _is_adts_aac(data):
        return "audio/aac"
    if data[:4] == b"RIFF":
        return "audio/wav"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:6] == b"#!AMR\n":
        return "audio/amr"
    if data[:3] == b"ID3":
        return "audio/mpeg"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data[:4] == b"\x1aE\xdf\xa3":
        return "audio/webm"
    import mimetypes
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _formato_legivel(data: bytes) -> str:
    if _is_adts_aac(data):
        return "AAC cru (ADTS)"
    if data[:4] == b"RIFF":
        return "WAV"
    if data[:4] == b"OggS":
        return "OGG"
    if data[:6] == b"#!AMR\n":
        return "AMR"
    if data[:3] == b"ID3":
        return "MP3"
    if data[4:8] == b"ftyp":
        return "MP4/M4A de verdade"
    if data[:4] == b"\x1aE\xdf\xa3":
        return "WebM"
    return "desconhecido"


@testaudio_bp.route("/api/testaudio/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "nenhum arquivo"}), 400
    room = (request.form.get("room") or "default").strip()[:64]
    sender = (request.form.get("sender") or "alguém").strip()[:40]
    data = f.read()
    if not data:
        return jsonify({"ok": False, "error": "arquivo vazio (0 bytes)"}), 400
    item_id = uuid.uuid4().hex
    with _lock:
        _items[item_id] = {
            "room": room, "sender": sender, "ts": time.time(),
            "filename": f.filename, "data": data,
        }
        _rooms_order.setdefault(room, []).append(item_id)
    return jsonify({"ok": True, "id": item_id})


@testaudio_bp.route("/api/testaudio/list")
def list_items():
    room = (request.args.get("room") or "default").strip()[:64]
    with _lock:
        ids = list(_rooms_order.get(room, []))
        out = []
        for i in ids:
            it = _items.get(i)
            if not it:
                continue
            out.append({
                "id": i, "sender": it["sender"], "ts": it["ts"],
                "filename": it["filename"], "size": len(it["data"]),
                "formato": _formato_legivel(it["data"]),
            })
    return jsonify(out)


@testaudio_bp.route("/api/testaudio/file/<item_id>")
def get_file(item_id):
    with _lock:
        it = _items.get(item_id)
        data = it["data"] if it else None
        filename = it["filename"] if it else None
    if data is None:
        return Response("não encontrado", status=404)

    mime = _mime_real(data, filename)
    total = len(data)
    range_header = request.headers.get("Range", "")
    range_match = _re.match(r"bytes=(\d*)-(\d*)", range_header)
    if range_match:
        start_s, end_s = range_match.groups()
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else total - 1
        end = min(end, total - 1)
        if start > end or start >= total:
            resp = Response(status=416)
            resp.headers["Content-Range"] = f"bytes */{total}"
            return resp
        chunk = data[start:end + 1]
        resp = Response(chunk, status=206, mimetype=mime)
        resp.headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        resp.headers["Content-Length"] = str(len(chunk))
    else:
        resp = Response(data, mimetype=mime)
        resp.headers["Content-Length"] = str(total)
    resp.headers["Accept-Ranges"] = "bytes"
    resp.headers["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp


@testaudio_bp.route("/api/testaudio/reset", methods=["POST"])
def reset_room():
    data = request.get_json(force=True) or {}
    room = (data.get("room") or "default").strip()[:64]
    with _lock:
        for i in _rooms_order.pop(room, []):
            _items.pop(i, None)
    return jsonify({"ok": True})


_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kraken Testaudio</title>
<style>
  body{font-family:sans-serif;background:#111;color:#eee;padding:16px;margin:0}
  h1{font-size:18px;color:#fff}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;align-items:center}
  input[type=text]{flex:1;min-width:120px;padding:10px;border-radius:8px;border:1px solid #444;
    background:#1c1c1c;color:#fff;font-size:14px}
  button{padding:10px 16px;border-radius:8px;border:0;background:#7B2CBF;color:#fff;
    font-size:14px;font-weight:bold}
  button.rec{background:#c0392b}
  button:disabled{opacity:.4}
  #status{margin:10px 0;color:#0f8;font-size:13px;min-height:18px}
  .item{background:#1c1c1c;border-radius:8px;padding:10px;margin:8px 0}
  .item .meta{color:#999;font-size:12px;margin-bottom:6px}
  .item .fmt{color:#0af}
  audio{width:100%}
  label.filebtn{padding:10px 16px;border-radius:8px;background:#444;color:#fff;
    font-size:14px;font-weight:bold;display:inline-block;cursor:pointer}
  input[type=file]{display:none}
</style></head><body>
<h1>🐙 Kraken Testaudio — teste isolado de voz/áudio via Oracle</h1>
<p style="color:#999;font-size:12px">Zero malha, zero mensagem, zero cripto — só upload comum
(igual chat online normal: sobe pro servidor, quem tem o mesmo código de sala baixa e toca).
Abra este link em quantos aparelhos quiser, mesmo código de sala em todos.</p>
<div class="row">
  <input type="text" id="room" placeholder="código da sala (ex: gil-teste)">
  <input type="text" id="sender" placeholder="seu nome" style="max-width:140px">
</div>
<div class="row">
  <button id="btnRec">🎙️ Gravar</button>
  <label class="filebtn">📁 Enviar arquivo<input type="file" id="fileInput" accept="audio/*"></label>
</div>
<div id="status">parado</div>
<div id="list"></div>
<script>
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(t) { statusEl.textContent = t; console.log("[testaudio]", t); }

function room() {
  const p = new URLSearchParams(location.search).get("room");
  if (p && !$("room").value) $("room").value = p;
  return $("room").value.trim() || "default";
}
function senderName() {
  return $("sender").value.trim() || "alguém";
}
room();

async function upload(blob, filename) {
  setStatus("enviando...");
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("room", room());
  form.append("sender", senderName());
  try {
    const res = await fetch("/api/testaudio/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!data.ok) { setStatus("erro: " + (data.error || "desconhecido")); return; }
    setStatus("enviado!");
    await refresh();
  } catch (e) {
    setStatus("erro ao enviar: " + (e.message || e));
  }
}

let mediaRecorder = null, chunks = [], recStream = null;
$("btnRec").addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setStatus("erro ao abrir microfone: " + (e.name || "") + " " + (e.message || e));
    return;
  }
  chunks = [];
  mediaRecorder = new MediaRecorder(recStream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    recStream.getTracks().forEach((t) => t.stop());
    $("btnRec").textContent = "🎙️ Gravar";
    $("btnRec").classList.remove("rec");
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    await upload(blob, "gravacao." + (blob.type.includes("webm") ? "webm" : "audio"));
  };
  mediaRecorder.start();
  $("btnRec").textContent = "⏹ Parar";
  $("btnRec").classList.add("rec");
  setStatus("gravando... fale alguma coisa perto do microfone");
});

$("fileInput").addEventListener("change", async () => {
  const f = $("fileInput").files[0];
  if (!f) return;
  await upload(f, f.name);
  $("fileInput").value = "";
});

async function refresh() {
  try {
    const res = await fetch("/api/testaudio/list?room=" + encodeURIComponent(room()));
    const items = await res.json();
    const listEl = $("list");
    listEl.innerHTML = "";
    items.slice().reverse().forEach((it) => {
      const div = document.createElement("div");
      div.className = "item";
      const d = new Date(it.ts * 1000);
      div.innerHTML = `<div class="meta">${it.sender} — ${d.toLocaleTimeString()} —
        ${it.size} bytes — <span class="fmt">${it.formato}</span></div>`;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = "/api/testaudio/file/" + it.id;
      div.appendChild(audio);
      listEl.appendChild(div);
    });
  } catch (e) { /* ignora falha momentânea */ }
}
refresh();
setInterval(refresh, 3000);
</script>
</body></html>"""


@testaudio_bp.route("/testaudio")
def testaudio_page():
    return Response(_PAGE, mimetype="text/html")
