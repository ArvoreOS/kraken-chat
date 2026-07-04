"""
Kraken - chat offline em malha (mesh) para redes sem internet.

Cada instância deste programa é um "nó": serve a interface web local (para
quem abrir o navegador nesse aparelho) e ao mesmo tempo procura outros nós
na mesma rede local (WiFi comum, hotspot ou Wi-Fi Direct pareado
manualmente - para o sistema operacional todos são só "uma rede IP local").

Quando dois nós se encontram na mesma rede, eles trocam automaticamente
todas as mensagens que um tem e o outro não (gossip/anti-entropia). Isso
faz a rede funcionar mesmo que os dois nunca estejam online ao mesmo
tempo: a informação vai "pegando carona" de aparelho em aparelho conforme
as pessoas circulam entre diferentes redes/hotspots do sítio.
"""
import json
import mimetypes
import os
import socket
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory, abort
from flask_socketio import SocketIO

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "craque.db"
NODE_ID_PATH = DATA_DIR / "node_id.txt"

HTTP_PORT = 5000
DISCOVERY_PORT = 8891
GOSSIP_PORT = 8892
DISCOVERY_INTERVAL = 3
PEER_TIMEOUT = 15
SYNC_INTERVAL = 10
MAX_SYNC_IDS = 3000

try:
    # No Termux/desktop, BASE_DIR/data é sempre gravável. No Android/Chaquopy,
    # a pasta do código-fonte extraído pode não ser gravável — nesse caso o
    # KrakenService chama configure_data_dir() com o diretório certo do app
    # logo depois de importar este módulo, antes de start_server().
    FILES_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass


def get_node_id():
    if NODE_ID_PATH.exists():
        return NODE_ID_PATH.read_text().strip()
    node_id = uuid.uuid4().hex[:12]
    NODE_ID_PATH.write_text(node_id)
    return node_id


_ANDROID_IP_OVERRIDE = None


def set_device_ip(ip):
    """Chamado pelo KrakenService (Android) com o IP WiFi de verdade, obtido
    via API do Android - o truque de socket abaixo nem sempre funciona
    corretamente dentro do sandbox de rede do Android."""
    global _ANDROID_IP_OVERRIDE
    _ANDROID_IP_OVERRIDE = ip or None


def local_ip():
    """IP local do nó. No Android usa o valor vindo do Java; no Termux/desktop
    descobre sozinho só com a tabela de rotas (sem precisar de internet)."""
    if _ANDROID_IP_OVERRIDE:
        return _ANDROID_IP_OVERRIDE
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.connect(("255.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


try:
    NODE_ID = get_node_id()
except OSError:
    NODE_ID = uuid.uuid4().hex[:12]  # reatribuído em configure_data_dir() no Android


class Store:
    """Guarda mensagens localmente (SQLite) - é o que permite sincronizar
    depois, mesmo com o remetente e destinatário nunca estando juntos."""

    def __init__(self, path):
        self.path = str(path)
        self._local = threading.local()
        self._init_schema()

    def _conn(self):
        if not hasattr(self._local, "conn"):
            self._local.conn = sqlite3.connect(self.path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _init_schema(self):
        conn = sqlite3.connect(self.path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                sender_id TEXT,
                sender_name TEXT,
                ts REAL,
                kind TEXT,
                text TEXT,
                file_name TEXT,
                file_size INTEGER,
                has_file INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

    def add_message(self, msg, has_file=None):
        conn = self._conn()
        try:
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, ts, kind, text, "
                "file_name, file_size, has_file) VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    msg["id"], msg["sender_id"], msg["sender_name"], msg["ts"],
                    msg["kind"], msg.get("text"), msg.get("file_name"),
                    msg.get("file_size"),
                    1 if (has_file if has_file is not None else msg.get("kind") == "text") else 0,
                ),
            )
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False  # já tinha essa mensagem

    def mark_has_file(self, msg_id):
        conn = self._conn()
        conn.execute("UPDATE messages SET has_file=1 WHERE id=?", (msg_id,))
        conn.commit()

    def all_ids(self):
        conn = self._conn()
        rows = conn.execute(
            "SELECT id FROM messages ORDER BY ts DESC LIMIT ?", (MAX_SYNC_IDS,)
        ).fetchall()
        return {r["id"] for r in rows}

    def get_messages(self, ids):
        if not ids:
            return []
        conn = self._conn()
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"SELECT * FROM messages WHERE id IN ({placeholders})", list(ids)
        ).fetchall()
        return [dict(r) for r in rows]

    def recent(self, limit=500):
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM messages ORDER BY ts ASC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def has_file_locally(self, msg_id):
        conn = self._conn()
        row = conn.execute("SELECT has_file FROM messages WHERE id=?", (msg_id,)).fetchone()
        return bool(row and row["has_file"])


store = Store(DB_PATH)


class MeshNode:
    """Descoberta de nós na rede local (UDP) + sincronização de mensagens
    e arquivos entre nós (TCP), tolerante a atraso."""

    def __init__(self, node_id, on_new_message):
        self.node_id = node_id
        self.on_new_message = on_new_message
        self.peers = {}  # node_id -> {ip, port, last_seen, name}
        self.lock = threading.Lock()
        self.display_name = "Nó " + node_id[:4]

    def start(self):
        threading.Thread(target=self._discovery_broadcast, daemon=True).start()
        threading.Thread(target=self._discovery_listen, daemon=True).start()
        threading.Thread(target=self._gossip_server, daemon=True).start()
        threading.Thread(target=self._sync_loop, daemon=True).start()
        threading.Thread(target=self._prune_loop, daemon=True).start()

    # ---------- descoberta ----------
    def _discovery_broadcast(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        while True:
            try:
                payload = f"CRAQUE_HELLO|{self.node_id}|{GOSSIP_PORT}|{self.display_name}"
                s.sendto(payload.encode(), ("255.255.255.255", DISCOVERY_PORT))
            except OSError:
                pass
            time.sleep(DISCOVERY_INTERVAL)

    def _discovery_listen(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("0.0.0.0", DISCOVERY_PORT))
        while True:
            try:
                data, addr = s.recvfrom(1024)
                parts = data.decode(errors="ignore").split("|")
                if len(parts) != 4 or parts[0] != "CRAQUE_HELLO":
                    continue
                _, peer_id, tcp_port, name = parts
                if peer_id == self.node_id:
                    continue
                with self.lock:
                    self.peers[peer_id] = {
                        "ip": addr[0], "port": int(tcp_port),
                        "name": name, "last_seen": time.time(),
                    }
            except OSError:
                pass

    def _prune_loop(self):
        while True:
            time.sleep(5)
            now = time.time()
            with self.lock:
                dead = [pid for pid, p in self.peers.items() if now - p["last_seen"] > PEER_TIMEOUT]
                for pid in dead:
                    del self.peers[pid]

    def live_peers(self):
        with self.lock:
            return dict(self.peers)

    # ---------- gossip (servidor) ----------
    def _gossip_server(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("0.0.0.0", GOSSIP_PORT))
        s.listen(5)
        while True:
            conn, _ = s.accept()
            threading.Thread(target=self._handle_gossip_conn, args=(conn,), daemon=True).start()

    def _handle_gossip_conn(self, conn):
        try:
            conn.settimeout(10)
            their_ids = set(self._recv_json(conn))
            my_ids = store.all_ids()
            missing_for_them = list(my_ids - their_ids)
            self._send_json(conn, store.get_messages(missing_for_them))

            my_ids_msg = self._recv_json(conn)
            self._send_json(conn, list(my_ids))
            new_msgs = self._recv_json(conn)
            for msg in new_msgs:
                self._ingest_message(msg, conn_for_file=conn)
        except (OSError, ValueError, ConnectionError):
            pass
        finally:
            conn.close()

    # ---------- gossip (cliente / iniciador da sincronização) ----------
    def _sync_loop(self):
        while True:
            time.sleep(SYNC_INTERVAL)
            for peer_id, info in self.live_peers().items():
                threading.Thread(
                    target=self._sync_with_peer, args=(peer_id, info), daemon=True
                ).start()

    def sync_now(self):
        for peer_id, info in self.live_peers().items():
            threading.Thread(
                target=self._sync_with_peer, args=(peer_id, info), daemon=True
            ).start()

    def _sync_with_peer(self, peer_id, info):
        try:
            conn = socket.create_connection((info["ip"], info["port"]), timeout=5)
            conn.settimeout(10)
            my_ids = store.all_ids()
            self._send_json(conn, list(my_ids))
            missing_for_me = self._recv_json(conn)
            for msg in missing_for_me:
                self._ingest_message(msg, conn_for_file=None, fetch_from=info)

            their_ids = set(self._recv_json(conn))
            self._send_json(conn, list(my_ids))
            missing_for_them_ids = my_ids - their_ids
            self._send_json(conn, store.get_messages(list(missing_for_them_ids)))
            conn.close()
        except (OSError, ValueError, ConnectionError):
            pass

    def _ingest_message(self, msg, conn_for_file=None, fetch_from=None):
        is_new = store.add_message(msg, has_file=(msg.get("kind") == "text"))
        if msg.get("kind") == "file":
            local_path = FILES_DIR / f"{msg['id']}_{msg['file_name']}"
            if not local_path.exists():
                if fetch_from:
                    self._fetch_file_http(fetch_from, msg, local_path)
        if is_new:
            self.on_new_message(msg)

    def _fetch_file_http(self, peer_info, msg, local_path):
        import urllib.request
        url = f"http://{peer_info['ip']}:{HTTP_PORT}/files/{msg['id']}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp, open(local_path, "wb") as f:
                f.write(resp.read())
            store.mark_has_file(msg["id"])
        except OSError:
            pass

    @staticmethod
    def _send_json(conn, obj):
        data = json.dumps(obj).encode()
        conn.sendall(len(data).to_bytes(8, "big") + data)

    @staticmethod
    def _recv_json(conn):
        size_bytes = MeshNode._recv_exact(conn, 8)
        size = int.from_bytes(size_bytes, "big")
        data = MeshNode._recv_exact(conn, size)
        return json.loads(data.decode())

    @staticmethod
    def _recv_exact(conn, n):
        buf = b""
        while len(buf) < n:
            chunk = conn.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("conexão fechada")
            buf += chunk
        return buf


# ---------------- Flask app ----------------
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 64MB por arquivo
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")


def broadcast_new_message(msg):
    socketio.emit("new_message", msg)


mesh = MeshNode(NODE_ID, broadcast_new_message)


@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json")


@app.route("/sw.js")
def sw():
    return send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")


@app.route("/api/messages")
def api_messages():
    return jsonify(store.recent())


@app.route("/api/peers")
def api_peers():
    peers = mesh.live_peers()
    return jsonify({
        "node_id": NODE_ID,
        "peers": [{"id": pid, **info} for pid, info in peers.items()],
    })


@app.route("/api/send", methods=["POST"])
def api_send():
    data = request.get_json(force=True)
    msg = {
        "id": uuid.uuid4().hex,
        "sender_id": data.get("sender_id") or NODE_ID,
        "sender_name": data.get("sender_name") or "Anônimo",
        "ts": time.time(),
        "kind": "text",
        "text": data.get("text", "").strip()[:4000],
    }
    if not msg["text"]:
        return jsonify({"ok": False, "error": "mensagem vazia"}), 400
    store.add_message(msg, has_file=True)
    broadcast_new_message(msg)
    mesh.sync_now()
    return jsonify({"ok": True, "message": msg})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "nenhum arquivo"}), 400
    sender_id = request.form.get("sender_id") or NODE_ID
    sender_name = request.form.get("sender_name") or "Anônimo"
    msg_id = uuid.uuid4().hex
    safe_name = os.path.basename(f.filename)
    local_path = FILES_DIR / f"{msg_id}_{safe_name}"
    f.save(local_path)
    msg = {
        "id": msg_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "ts": time.time(),
        "kind": "file",
        "file_name": safe_name,
        "file_size": local_path.stat().st_size,
    }
    store.add_message(msg, has_file=True)
    broadcast_new_message(msg)
    mesh.sync_now()
    return jsonify({"ok": True, "message": msg})


@app.route("/files/<msg_id>")
def get_file(msg_id):
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM messages WHERE id=? AND kind='file'", (msg_id,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    local_path = FILES_DIR / f"{msg_id}_{row['file_name']}"
    if not local_path.exists():
        abort(404)
    mime = mimetypes.guess_type(row["file_name"])[0] or "application/octet-stream"
    return send_file(local_path, mimetype=mime, download_name=row["file_name"])


_LOGO_DATA_URI = None


def _logo_data_uri():
    """Embute o logo como base64 direto no HTML - evita qualquer problema
    de path/serving de arquivo estático nessa página específica."""
    global _LOGO_DATA_URI
    if _LOGO_DATA_URI is None:
        try:
            import base64
            logo_path = BASE_DIR / "static" / "icons" / "icon-512.png"
            _LOGO_DATA_URI = "data:image/png;base64," + base64.b64encode(logo_path.read_bytes()).decode()
        except OSError:
            _LOGO_DATA_URI = ""
    return _LOGO_DATA_URI


@app.route("/join")
def join():
    ip = local_ip()
    url = f"http://{ip}:{HTTP_PORT}/"
    svg_bytes = ""
    try:
        import qrcode
        import qrcode.image.svg
        from io import BytesIO
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgImage)
        buf = BytesIO()
        img.save(buf)
        svg_bytes = buf.getvalue().decode()
    except Exception as e:
        print(f"[join] falha ao gerar QR code: {e!r}")
    return f"""<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Entrar no Kraken</title>
    <style>
      body{{font-family:sans-serif;background:#fff;color:#222;text-align:center;padding:32px}}
      .qr{{width:240px;margin:16px auto}}
      a.btn{{display:inline-block;margin-top:16px;padding:14px 28px;background:#00A651;
        color:#fff;border-radius:999px;text-decoration:none;font-weight:bold}}
      .roxo{{color:#7B2CBF}} .amarelo{{color:#E6B800}}
      .logo{{width:110px;height:110px}}
    </style></head><body>
    <img class="logo" src="{_logo_data_uri()}" alt="Kraken">
    <h1><span class="roxo">Kraken</span></h1>
    <p>Escaneie ou toque para entrar na conversa deste nó:</p>
    <div class="qr">{svg_bytes}</div>
    <p><code>{url}</code></p>
    <a class="btn" href="{url}">Entrar agora</a>
    </body></html>"""


@socketio.on("connect")
def on_connect():
    pass


def configure_data_dir(path):
    """Chamado pelo KrakenService (Android) logo após importar o módulo,
    ANTES de start_server(), com o diretório gravável de verdade do app
    (getFilesDir()). Recria tudo que dependia do caminho padrão do Termux."""
    global DATA_DIR, FILES_DIR, DB_PATH, NODE_ID_PATH, NODE_ID, store, mesh
    DATA_DIR = Path(path)
    FILES_DIR = DATA_DIR / "files"
    DB_PATH = DATA_DIR / "craque.db"
    NODE_ID_PATH = DATA_DIR / "node_id.txt"
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    NODE_ID = get_node_id()
    store = Store(DB_PATH)
    mesh = MeshNode(NODE_ID, broadcast_new_message)


def start_server():
    """Chamado pelo KrakenService (Android/Chaquopy) depois de importar o
    módulo, ou pelo bloco abaixo quando rodado direto (Termux/desktop)."""
    mesh.start()
    ip = local_ip()
    print(f"Kraken rodando! Node ID: {NODE_ID}")
    print(f"Abra no navegador deste aparelho: http://{ip}:{HTTP_PORT}/")
    print(f"Convide outros com:              http://{ip}:{HTTP_PORT}/join")

    # No Android, se o serviço reiniciar rápido demais (ex: crash anterior),
    # a porta pode ainda estar sendo liberada pelo sistema - tenta de novo
    # algumas vezes em vez de derrubar o app.
    attempts = 0
    while True:
        try:
            socketio.run(app, host="0.0.0.0", port=HTTP_PORT, allow_unsafe_werkzeug=True)
            break
        except SystemExit:
            attempts += 1
            if attempts >= 5:
                raise
            time.sleep(2)


if __name__ == "__main__":
    start_server()
