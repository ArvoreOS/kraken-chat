"""
Kraken - chat offline em malha (mesh) para redes sem internet.

Cada instância deste programa é um "nó": serve a interface web local (para
quem abrir o navegador nesse aparelho) e ao mesmo tempo procura outros nós
na mesma rede local (WiFi comum, hotspot ou Wi-Fi Direct pareado
manualmente - para o sistema operacional todos são só "uma rede IP local").

Quando dois nós se encontram na mesma rede, eles trocam automaticamente
todas as mensagens que um tem e o outro não (gossip/anti-entropia), cifradas
ou não conforme o escopo (ver abaixo). Isso faz a rede funcionar mesmo que
os dois nunca estejam online ao mesmo tempo: a informação vai "pegando
carona" de aparelho em aparelho conforme as pessoas circulam entre
diferentes redes/hotspots do sítio.

Escopo das mensagens:
- "global": vai pra rede toda, texto puro (igual sempre foi).
- "direct": mensagem de um nó pra outro, cifrada com a chave pública do
  destinatário (X25519/NaCl Box) - só ele consegue ler.
- "group" + grupo "private": cifrada com a chave simétrica do grupo (NaCl
  SecretBox) - só quem tem a chave (os membros) lê.
- "group" + grupo "open": texto puro, só organizado numa aba separada.

Todo nó continua repassando (gossip) TODAS as mensagens pra todo peer que
encontrar, cifradas ou não - é isso que faz a malha tolerante a atraso
funcionar (um nó "de fora" carrega a mensagem até ela chegar no destino
certo). Quem não tem a chave nunca consegue decifrar o conteúdo.
"""
import base64
import json
import mimetypes
import os
import socket
import sqlite3
import sys
import threading
import time
import uuid
from pathlib import Path

import nacl.public
import nacl.secret
import nacl.utils
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory
from flask_socketio import SocketIO

BASE_DIR = Path(__file__).resolve().parent

# Empacotado com PyInstaller (versão PC): os recursos (static/templates)
# ficam extraídos num diretório temporário (sys._MEIPASS), mas os dados
# (mensagens, chaves) precisam ficar num lugar persistente do lado de fora
# desse temp - ao lado do .exe, pra sobreviver entre execuções.
if getattr(sys, "frozen", False):
    RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
    DATA_DIR = Path(sys.executable).resolve().parent / "kraken_data"
else:
    RESOURCE_DIR = BASE_DIR
    DATA_DIR = BASE_DIR / "data"
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "craque.db"
NODE_ID_PATH = DATA_DIR / "node_id.txt"
NODE_KEY_PATH = DATA_DIR / "node_key.bin"

# Configuráveis por variável de ambiente só pra rodar em servidor fixo
# (nó-semente na internet) - no Android/Chaquopy essas variáveis nunca
# existem, então o comportamento continua exatamente o mesmo.
HTTP_PORT = int(os.environ.get("KRAKEN_HTTP_PORT", 5000))
DISCOVERY_PORT = int(os.environ.get("KRAKEN_DISCOVERY_PORT", 8891))
GOSSIP_PORT = int(os.environ.get("KRAKEN_GOSSIP_PORT", 8892))
DISCOVERY_INTERVAL = 3
PEER_TIMEOUT = 15
SYNC_INTERVAL = 10
MAX_SYNC_IDS = 3000

# Nó-semente sempre online (Oceano Livre, Oracle) - ponte híbrida: quem tem
# internet sincroniza com ele além da malha local, o que costura qualquer
# nó online com qualquer outro nó online no mundo, sem NAT/porta aberta em
# casa (a conexão é sempre feita DAQUI pra lá). Quem não tem internet
# continua funcionando só na malha local, do jeito que já era.
# O próprio servidor rodando no Oracle sobe com KRAKEN_BOOTSTRAP_PEERS=""
# pra não tentar ser semente de si mesmo.
BOOTSTRAP_PEERS_RAW = os.environ.get("KRAKEN_BOOTSTRAP_PEERS", "136.248.100.20:8892")

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


def _load_or_create_node_key():
    if NODE_KEY_PATH.exists():
        return nacl.public.PrivateKey(NODE_KEY_PATH.read_bytes())
    key = nacl.public.PrivateKey.generate()
    NODE_KEY_PATH.write_bytes(bytes(key))
    return key


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

try:
    NODE_PRIVKEY = _load_or_create_node_key()
except OSError:
    NODE_PRIVKEY = nacl.public.PrivateKey.generate()  # reatribuído em configure_data_dir() no Android
NODE_PUBKEY = NODE_PRIVKEY.public_key


def _my_pubkey_b64():
    return base64.b64encode(bytes(NODE_PUBKEY)).decode()


# ---------------- criptografia por escopo ----------------
# "store" é definido mais abaixo (classe Store); estas funções só o usam
# dentro do corpo (chamado em tempo de execução), então a ordem de
# definição no arquivo não importa.

def _encrypt_direct_bytes(plaintext, recipient_pubkey_bytes):
    box = nacl.public.Box(NODE_PRIVKEY, nacl.public.PublicKey(recipient_pubkey_bytes))
    return bytes(box.encrypt(plaintext))


def _decrypt_direct_bytes(ciphertext, peer_pubkey_bytes):
    try:
        box = nacl.public.Box(NODE_PRIVKEY, nacl.public.PublicKey(peer_pubkey_bytes))
        return box.decrypt(ciphertext)
    except Exception:
        return None


def _encrypt_group_bytes(plaintext, group_key):
    return bytes(nacl.secret.SecretBox(group_key).encrypt(plaintext))


def _decrypt_group_bytes(ciphertext, group_key):
    try:
        return nacl.secret.SecretBox(group_key).decrypt(ciphertext)
    except Exception:
        return None


def _encrypt_for_scope(data, scope, group_id=None, recipient_id=None):
    """Retorna (bytes_a_guardar, encrypted_bool). Lança ValueError se a
    cifragem for necessária mas faltar a chave/peer pra fazer isso."""
    if scope == "direct":
        if not recipient_id:
            raise ValueError("destinatário não informado")
        pubkey_b64 = store.get_pubkey(recipient_id)
        if not pubkey_b64:
            raise ValueError("ainda não vi esse nó na rede, não dá pra mandar direto")
        return _encrypt_direct_bytes(data, base64.b64decode(pubkey_b64)), True
    if scope == "group":
        group = store.get_group(group_id)
        if not group:
            raise ValueError("grupo desconhecido")
        if group["kind"] == "private":
            return _encrypt_group_bytes(data, group["key"]), True
        return data, False
    return data, False


def _decrypt_for_scope(data, row):
    """row: dict de uma linha de messages. Retorna bytes decifrados, ou
    None se este nó não tem como (não é membro/destinatário)."""
    scope = row.get("scope") or "global"
    if scope == "direct":
        # Usa origin_node_id (identidade criptográfica do aparelho que criou
        # a mensagem), não sender_id (apelido de exibição escolhido na hora
        # de entrar no chat) - são coisas diferentes, e comparar com sender_id
        # faz até o próprio remetente perder acesso ao que ele mesmo mandou.
        origin_node_id, recipient_id = row.get("origin_node_id"), row.get("recipient_id")
        if NODE_ID not in (origin_node_id, recipient_id):
            return None
        peer_id = recipient_id if origin_node_id == NODE_ID else origin_node_id
        pubkey_b64 = store.get_pubkey(peer_id)
        if not pubkey_b64:
            return None
        return _decrypt_direct_bytes(data, base64.b64decode(pubkey_b64))
    if scope == "group":
        group = store.get_group(row.get("group_id"))
        if not group or not group.get("key"):
            return None
        return _decrypt_group_bytes(data, group["key"])
    return data


def _try_decrypt_message(row):
    """Usado só na hora de mostrar mensagens de texto pro dono deste nó
    (histórico / evento em tempo real) - nunca no armazenamento nem no
    repasse entre nós, que continuam sempre com o texto cifrado."""
    if not row.get("encrypted") or row.get("kind") != "text":
        return row
    out = dict(row)
    plain = None
    try:
        ciphertext = base64.b64decode(row["text"]) if row.get("text") else b""
        plain = _decrypt_for_scope(ciphertext, row)
    except Exception:
        plain = None
    if plain is None:
        out["text"] = None
        out["hidden"] = True
    else:
        out["text"] = plain.decode("utf-8", errors="replace")
    return out


class Store:
    """Guarda mensagens, grupos e identidades de outros nós localmente
    (SQLite) - é o que permite sincronizar depois, mesmo com o remetente e
    destinatário nunca estando juntos."""

    def __init__(self, path):
        self.path = str(path)
        self._local = threading.local()
        self._init_schema()

    def _conn(self):
        if not hasattr(self._local, "conn"):
            self._local.conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA busy_timeout=10000")
            self._local.conn.execute("PRAGMA journal_mode=WAL")
        return self._local.conn

    def _init_schema(self):
        # WAL + busy_timeout: com vários gossips e requisições HTTP escrevendo
        # ao mesmo tempo (uma conexão SQLite por thread), o modo padrão do
        # SQLite derruba a escrita perdedora com "database is locked" - e como
        # sqlite3.OperationalError não é OSError/ValueError/ConnectionError,
        # esse erro nem era capturado no except do gossip, matando a thread
        # de sincronização no meio da troca. WAL deixa leituras e escritas
        # conviverem, e o busy_timeout faz esperar a vez em vez de falhar.
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute("PRAGMA journal_mode=WAL")
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
                has_file INTEGER DEFAULT 0,
                scope TEXT DEFAULT 'global',
                group_id TEXT,
                recipient_id TEXT,
                encrypted INTEGER DEFAULT 0,
                origin_node_id TEXT
            )
        """)
        # Migração pra bancos criados antes do motor de escopo existir.
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
        for col, decl in (
            ("scope", "TEXT DEFAULT 'global'"),
            ("group_id", "TEXT"),
            ("recipient_id", "TEXT"),
            ("encrypted", "INTEGER DEFAULT 0"),
            ("origin_node_id", "TEXT"),
        ):
            if col not in existing_cols:
                conn.execute(f"ALTER TABLE messages ADD COLUMN {col} {decl}")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS known_nodes (
                node_id TEXT PRIMARY KEY,
                pubkey TEXT,
                name TEXT,
                last_seen REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT,
                kind TEXT,
                key BLOB,
                created_ts REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS group_members (
                group_id TEXT,
                node_id TEXT,
                joined_ts REAL,
                PRIMARY KEY (group_id, node_id)
            )
        """)
        conn.commit()
        conn.close()

    def add_message(self, msg, has_file=None):
        conn = self._conn()
        try:
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, ts, kind, text, "
                "file_name, file_size, has_file, scope, group_id, recipient_id, encrypted, "
                "origin_node_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    msg["id"], msg["sender_id"], msg["sender_name"], msg["ts"],
                    msg["kind"], msg.get("text"), msg.get("file_name"),
                    msg.get("file_size"),
                    1 if (has_file if has_file is not None else msg.get("kind") not in ("file", "audio")) else 0,
                    msg.get("scope") or "global", msg.get("group_id"), msg.get("recipient_id"),
                    1 if msg.get("encrypted") else 0,
                    msg.get("origin_node_id"),
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

    # ---------- identidade de outros nós ----------
    def remember_node(self, node_id, pubkey_b64, name=""):
        if not node_id or not pubkey_b64:
            return
        conn = self._conn()
        conn.execute(
            "INSERT INTO known_nodes (node_id, pubkey, name, last_seen) VALUES (?,?,?,?) "
            "ON CONFLICT(node_id) DO UPDATE SET pubkey=excluded.pubkey, "
            "name=excluded.name, last_seen=excluded.last_seen",
            (node_id, pubkey_b64, name, time.time()),
        )
        conn.commit()

    def get_pubkey(self, node_id):
        conn = self._conn()
        row = conn.execute("SELECT pubkey FROM known_nodes WHERE node_id=?", (node_id,)).fetchone()
        return row["pubkey"] if row else None

    def list_known_nodes(self):
        conn = self._conn()
        rows = conn.execute(
            "SELECT node_id, name, last_seen FROM known_nodes ORDER BY last_seen DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ---------- grupos ----------
    def create_group(self, group_id, name, kind, key):
        conn = self._conn()
        conn.execute(
            "INSERT OR IGNORE INTO groups (id, name, kind, key, created_ts) VALUES (?,?,?,?,?)",
            (group_id, name, kind, key, time.time()),
        )
        conn.commit()

    def get_group(self, group_id):
        if not group_id:
            return None
        conn = self._conn()
        row = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
        return dict(row) if row else None

    def get_group_public(self, group_id):
        group = self.get_group(group_id)
        if not group:
            return None
        return {"id": group["id"], "name": group["name"], "kind": group["kind"]}

    def list_groups(self):
        conn = self._conn()
        rows = conn.execute(
            "SELECT g.id, g.name, g.kind FROM groups g "
            "JOIN group_members m ON m.group_id = g.id AND m.node_id = ? "
            "ORDER BY g.created_ts DESC",
            (NODE_ID,),
        ).fetchall()
        return [dict(r) for r in rows]

    def add_member(self, group_id, node_id):
        conn = self._conn()
        conn.execute(
            "INSERT OR IGNORE INTO group_members (group_id, node_id, joined_ts) VALUES (?,?,?)",
            (group_id, node_id, time.time()),
        )
        conn.commit()

    def list_members(self, group_id):
        conn = self._conn()
        rows = conn.execute(
            "SELECT node_id FROM group_members WHERE group_id=?", (group_id,)
        ).fetchall()
        return [r["node_id"] for r in rows]


store = Store(DB_PATH)


class MeshNode:
    """Descoberta de nós na rede local (UDP) + sincronização de mensagens
    e arquivos entre nós (TCP), tolerante a atraso."""

    def __init__(self, node_id, on_new_message):
        self.node_id = node_id
        self.on_new_message = on_new_message
        self.peers = {}  # node_id -> {ip, port, last_seen, name} (descoberta local, some com o tempo)
        self.bootstrap_peers = {}  # sempre tentados, nunca expiram - ver BOOTSTRAP_PEERS_RAW
        self.lock = threading.Lock()
        self.display_name = "Nó " + node_id[:4]
        # Só pra diagnóstico (tela /debug) - não afeta o funcionamento da malha.
        self.sync_log = {}      # peer_id -> {last_attempt, ok, error, last_success}
        self.incoming_log = {}  # peer_id_ou_ip -> {last_attempt, ok, error}

    def _seed_bootstrap_peers(self):
        for entry in BOOTSTRAP_PEERS_RAW.split(","):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            ip, _, port_s = entry.rpartition(":")
            try:
                port = int(port_s)
            except ValueError:
                continue
            pid = f"bootstrap-{ip}-{port}"
            self.bootstrap_peers[pid] = {
                "ip": ip, "port": port, "name": "Oceano Livre (semente)", "last_seen": time.time(),
            }

    def _record_sync(self, peer_id, attempt_ts, ok, error=None):
        with self.lock:
            entry = self.sync_log.setdefault(peer_id, {})
            entry["last_attempt"] = attempt_ts
            entry["ok"] = ok
            entry["error"] = error
            if ok:
                entry["last_success"] = attempt_ts

    def _record_incoming(self, peer_id, attempt_ts, ok, error=None):
        with self.lock:
            entry = self.incoming_log.setdefault(peer_id, {})
            entry["last_attempt"] = attempt_ts
            entry["ok"] = ok
            entry["error"] = error
            if ok:
                entry["last_success"] = attempt_ts

    def start(self):
        self._seed_bootstrap_peers()
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
            merged = dict(self.bootstrap_peers)
            merged.update(self.peers)
            return merged

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
        attempt_ts = time.time()
        try:
            peer_key = conn.getpeername()[0]
        except OSError:
            peer_key = "?"
        try:
            conn.settimeout(10)

            # Handshake de identidade: troca node_id+chave pública antes de
            # qualquer coisa - precisamos saber quem é o peer pra poder
            # decifrar mensagens diretas endereçadas a ele/dele mais tarde.
            peer_hello = self._recv_json(conn)
            self._send_json(conn, {"node_id": self.node_id, "pubkey": _my_pubkey_b64(), "name": self.display_name, "http_port": HTTP_PORT})
            if isinstance(peer_hello, dict):
                peer_key = peer_hello.get("node_id") or peer_key
                store.remember_node(peer_hello.get("node_id"), peer_hello.get("pubkey"), peer_hello.get("name", ""))

            their_ids = set(self._recv_json(conn))
            my_ids = store.all_ids()
            missing_for_them = list(my_ids - their_ids)
            self._send_json(conn, store.get_messages(missing_for_them))

            my_ids_msg = self._recv_json(conn)
            self._send_json(conn, list(my_ids))
            new_msgs = self._recv_json(conn)
            for msg in new_msgs:
                self._ingest_message(msg, conn_for_file=conn)
            self._record_incoming(peer_key, attempt_ts, ok=True)
        except (OSError, ValueError, ConnectionError, KeyError, sqlite3.Error) as e:
            self._record_incoming(peer_key, attempt_ts, ok=False, error=f"{type(e).__name__}: {e}")
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
        attempt_ts = time.time()
        try:
            conn = socket.create_connection((info["ip"], info["port"]), timeout=5)
            conn.settimeout(10)

            self._send_json(conn, {"node_id": self.node_id, "pubkey": _my_pubkey_b64(), "name": self.display_name, "http_port": HTTP_PORT})
            peer_hello = self._recv_json(conn)
            if isinstance(peer_hello, dict):
                store.remember_node(peer_hello.get("node_id"), peer_hello.get("pubkey"), peer_hello.get("name", ""))
                # A porta HTTP do peer pode ser diferente da nossa (ex: o
                # nó-semente do Oracle usa 7000) - sem isso, buscar o arquivo
                # depois tenta na porta errada e a imagem/áudio nunca chega.
                if peer_hello.get("http_port"):
                    info = dict(info, http_port=peer_hello["http_port"])

            my_ids = store.all_ids()
            self._send_json(conn, list(my_ids))
            missing_for_me = self._recv_json(conn)
            for msg in missing_for_me:
                self._ingest_message(msg, conn_for_file=None, fetch_from=info)

            # Precisa mandar antes de receber aqui - o servidor (_handle_gossip_conn)
            # está bloqueado esperando este recv_json antes de mandar their_ids;
            # inverter a ordem trava os dois lados até o timeout e a mensagem nova
            # nunca chega no peer (bug: "envia mas ninguém recebe").
            self._send_json(conn, list(my_ids))
            their_ids = set(self._recv_json(conn))
            missing_for_them_ids = my_ids - their_ids
            self._send_json(conn, store.get_messages(list(missing_for_them_ids)))
            conn.close()
            self._record_sync(peer_id, attempt_ts, ok=True)
        except (OSError, ValueError, ConnectionError, KeyError, sqlite3.Error) as e:
            self._record_sync(peer_id, attempt_ts, ok=False, error=f"{type(e).__name__}: {e}")

    def _ingest_message(self, msg, conn_for_file=None, fetch_from=None):
        is_new = store.add_message(msg, has_file=(msg.get("kind") not in ("file", "audio")))
        if msg.get("kind") in ("file", "audio"):
            local_path = FILES_DIR / f"{msg['id']}_{msg['file_name']}"
            if not local_path.exists():
                if fetch_from:
                    self._fetch_file_http(fetch_from, msg, local_path)
        if is_new:
            self.on_new_message(msg)

    def _fetch_file_http(self, peer_info, msg, local_path):
        import urllib.request
        port = peer_info.get("http_port") or HTTP_PORT
        url = f"http://{peer_info['ip']}:{port}/files/{msg['id']}"
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
app = Flask(__name__, static_folder=str(RESOURCE_DIR / "static"), template_folder=str(RESOURCE_DIR / "templates"))
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 64MB por arquivo
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")


@app.after_request
def _no_cache(response):
    # Este servidor só existe em localhost e muda a cada atualização do
    # app - cache de HTTP aqui só serve pra mostrar tela antiga depois de
    # atualizar (visto em WebView de MIUI/Xiaomi). Sem custo real
    # desabilitar, é tudo loopback.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


def broadcast_new_message(msg):
    socketio.emit("new_message", msg)


mesh = MeshNode(NODE_ID, lambda msg: broadcast_new_message(_try_decrypt_message(msg)))


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
    return jsonify([_try_decrypt_message(m) for m in store.recent()])


@app.route("/api/peers")
def api_peers():
    peers = mesh.live_peers()
    return jsonify({
        "node_id": NODE_ID,
        "peers": [{"id": pid, **info} for pid, info in peers.items()],
    })


@app.route("/api/known_nodes")
def api_known_nodes():
    return jsonify(store.list_known_nodes())


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
        "scope": "global",
        "origin_node_id": NODE_ID,
    }
    if not msg["text"]:
        return jsonify({"ok": False, "error": "mensagem vazia"}), 400
    store.add_message(msg, has_file=True)
    broadcast_new_message(msg)
    mesh.sync_now()
    return jsonify({"ok": True, "message": msg})


@app.route("/api/send_direct", methods=["POST"])
def api_send_direct():
    data = request.get_json(force=True)
    recipient_id = data.get("recipient_id")
    text = (data.get("text") or "").strip()[:4000]
    if not recipient_id or not text:
        return jsonify({"ok": False, "error": "destinatário ou texto vazio"}), 400
    try:
        ciphertext, encrypted = _encrypt_for_scope(text.encode(), "direct", recipient_id=recipient_id)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    msg_id = uuid.uuid4().hex
    ts = time.time()
    sender_id = data.get("sender_id") or NODE_ID
    sender_name = data.get("sender_name") or "Anônimo"
    stored_text = base64.b64encode(ciphertext).decode() if encrypted else ciphertext.decode()
    stored = {
        "id": msg_id, "sender_id": sender_id, "sender_name": sender_name, "ts": ts,
        "kind": "text", "text": stored_text,
        "scope": "direct", "recipient_id": recipient_id, "encrypted": encrypted,
        "origin_node_id": NODE_ID,
    }
    store.add_message(stored, has_file=True)
    plain = dict(stored, text=text, encrypted=False, hidden=False)
    broadcast_new_message(plain)
    mesh.sync_now()
    return jsonify({"ok": True, "message": plain})


@app.route("/api/send_group", methods=["POST"])
def api_send_group():
    data = request.get_json(force=True)
    group_id = data.get("group_id")
    text = (data.get("text") or "").strip()[:4000]
    group = store.get_group(group_id)
    if not group or not text:
        return jsonify({"ok": False, "error": "grupo ou texto inválido"}), 400
    ciphertext, encrypted = _encrypt_for_scope(text.encode(), "group", group_id=group_id)

    msg_id = uuid.uuid4().hex
    ts = time.time()
    sender_id = data.get("sender_id") or NODE_ID
    sender_name = data.get("sender_name") or "Anônimo"
    stored_text = base64.b64encode(ciphertext).decode() if encrypted else ciphertext.decode()
    stored = {
        "id": msg_id, "sender_id": sender_id, "sender_name": sender_name, "ts": ts,
        "kind": "text", "text": stored_text,
        "scope": "group", "group_id": group_id, "encrypted": encrypted,
        "origin_node_id": NODE_ID,
    }
    store.add_message(stored, has_file=True)
    plain = dict(stored, text=text, encrypted=False, hidden=False)
    broadcast_new_message(plain)
    mesh.sync_now()
    return jsonify({"ok": True, "message": plain})


@app.route("/api/groups", methods=["GET"])
def api_groups_list():
    return jsonify(store.list_groups())


@app.route("/api/groups", methods=["POST"])
def api_groups_create():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()[:80]
    kind = data.get("kind") if data.get("kind") in ("open", "private") else "private"
    if not name:
        return jsonify({"ok": False, "error": "nome vazio"}), 400
    group_id = uuid.uuid4().hex
    key = nacl.utils.random(nacl.secret.SecretBox.KEY_SIZE) if kind == "private" else None
    store.create_group(group_id, name, kind, key)
    store.add_member(group_id, NODE_ID)
    invite = {
        "group_id": group_id, "name": name, "kind": kind,
        "key": base64.b64encode(key).decode() if key else None,
    }
    return jsonify({"ok": True, "group": store.get_group_public(group_id), "invite": invite})


@app.route("/api/groups/join", methods=["POST"])
def api_groups_join():
    data = request.get_json(force=True)
    group_id = data.get("group_id")
    name = (data.get("name") or "Grupo").strip()[:80]
    kind = data.get("kind") if data.get("kind") in ("open", "private") else "private"
    key_b64 = data.get("key")
    key = base64.b64decode(key_b64) if key_b64 else None
    if not group_id:
        return jsonify({"ok": False, "error": "convite inválido"}), 400
    if not store.get_group(group_id):
        store.create_group(group_id, name, kind, key)
    store.add_member(group_id, NODE_ID)
    return jsonify({"ok": True, "group": store.get_group_public(group_id)})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "nenhum arquivo"}), 400
    sender_id = request.form.get("sender_id") or NODE_ID
    sender_name = request.form.get("sender_name") or "Anônimo"
    kind = request.form.get("kind") if request.form.get("kind") in ("file", "audio") else "file"
    scope = request.form.get("scope") if request.form.get("scope") in ("global", "direct", "group") else "global"
    group_id = request.form.get("group_id")
    recipient_id = request.form.get("recipient_id")

    raw = f.read()
    try:
        data, encrypted = _encrypt_for_scope(raw, scope, group_id=group_id, recipient_id=recipient_id)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    msg_id = uuid.uuid4().hex
    safe_name = os.path.basename(f.filename)
    local_path = FILES_DIR / f"{msg_id}_{safe_name}"
    local_path.write_bytes(data)
    msg = {
        "id": msg_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "ts": time.time(),
        "kind": kind,
        "file_name": safe_name,
        "file_size": len(raw),
        "scope": scope,
        "group_id": group_id,
        "recipient_id": recipient_id,
        "encrypted": encrypted,
        "origin_node_id": NODE_ID,
    }
    store.add_message(msg, has_file=True)
    broadcast_new_message(msg)
    mesh.sync_now()
    return jsonify({"ok": True, "message": msg})


@app.route("/files/<msg_id>")
def get_file(msg_id):
    """Bytes crus, exatamente como estão em disco (cifrados se a mensagem
    for de escopo direto/grupo privado). Usado só pelo repasse entre nós
    (_fetch_file_http) - NUNCA decifra aqui, senão qualquer um na rede local
    que descobrisse essa URL leria o conteúdo sem ter a chave."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM messages WHERE id=? AND kind IN ('file','audio')", (msg_id,)
    ).fetchone()
    conn.close()
    if not row:
        abort(404)
    local_path = FILES_DIR / f"{msg_id}_{row['file_name']}"
    if not local_path.exists():
        abort(404)
    mime = mimetypes.guess_type(row["file_name"])[0] or "application/octet-stream"
    return send_file(local_path, mimetype=mime, download_name=row["file_name"])


@app.route("/files/<msg_id>/view")
def get_file_view(msg_id):
    """Bytes decifrados pra quem tem o direito de ver - usado pela própria
    interface deste nó (player de áudio, link de download)."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM messages WHERE id=? AND kind IN ('file','audio')", (msg_id,)
    ).fetchone()
    conn.close()
    if not row:
        abort(404)
    row = dict(row)
    local_path = FILES_DIR / f"{msg_id}_{row['file_name']}"
    if not local_path.exists():
        abort(404)
    data = local_path.read_bytes()
    if row.get("encrypted"):
        data = _decrypt_for_scope(data, row)
        if data is None:
            abort(403)
    mime = mimetypes.guess_type(row["file_name"])[0] or "application/octet-stream"
    resp = Response(data, mimetype=mime)
    resp.headers["Content-Disposition"] = f'inline; filename="{row["file_name"]}"'
    return resp


_LOGO_DATA_URI = None


def _logo_data_uri():
    """Embute o logo como base64 direto no HTML - evita qualquer problema
    de path/serving de arquivo estático nessa página específica."""
    global _LOGO_DATA_URI
    if _LOGO_DATA_URI is None:
        try:
            logo_path = RESOURCE_DIR / "static" / "icons" / "icon-512.png"
            _LOGO_DATA_URI = "data:image/png;base64," + base64.b64encode(logo_path.read_bytes()).decode()
        except OSError:
            _LOGO_DATA_URI = ""
    return _LOGO_DATA_URI


def _fmt_age(ts):
    if not ts:
        return "nunca"
    s = time.time() - ts
    if s < 60:
        return f"{int(s)}s atrás"
    if s < 3600:
        return f"{int(s // 60)}min atrás"
    return f"{int(s // 3600)}h atrás"


@app.route("/debug")
def debug_page():
    peers = mesh.live_peers()
    rows = []
    for pid, info in peers.items():
        sync = mesh.sync_log.get(pid, {})
        incoming = mesh.incoming_log.get(pid, {}) or mesh.incoming_log.get(info.get("ip"), {})
        sync_status = "✅ ok" if sync.get("ok") else (f"❌ {sync.get('error')}" if sync else "— (ainda não tentou)")
        in_status = "✅ ok" if incoming.get("ok") else (f"❌ {incoming.get('error')}" if incoming else "— (nunca recebeu conexão dele)")
        rows.append(f"""
        <tr>
          <td>{info.get('name','?')}<br><span class="mono">{pid[:10]}…</span></td>
          <td class="mono">{info.get('ip')}:{info.get('port')}</td>
          <td>{_fmt_age(info.get('last_seen'))}</td>
          <td>{sync_status}<br><span class="dim">último sucesso: {_fmt_age(sync.get('last_success'))}</span></td>
          <td>{in_status}<br><span class="dim">último sucesso: {_fmt_age(incoming.get('last_success'))}</span></td>
        </tr>""")
    known = store.list_known_nodes()
    known_rows = "".join(
        f"<tr><td>{n.get('name') or '?'}</td><td class='mono'>{n['node_id'][:10]}…</td><td>{_fmt_age(n.get('last_seen'))}</td></tr>"
        for n in known
    )
    return f"""<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kraken — Diagnóstico</title>
    <style>
      body{{font-family:sans-serif;background:#fff;color:#222;padding:16px;font-size:13px}}
      h1{{font-size:18px}} h2{{font-size:15px;margin-top:24px}}
      table{{width:100%;border-collapse:collapse;margin-top:8px}}
      td,th{{border:1px solid #e7e3ee;padding:6px 8px;text-align:left;vertical-align:top}}
      .mono{{font-family:monospace;font-size:11px}}
      .dim{{color:#888;font-size:11px}}
      a.btn{{display:inline-block;margin-top:10px;padding:8px 16px;background:#7B2CBF;
        color:#fff;border-radius:8px;text-decoration:none}}
    </style></head><body>
    <h1>🩺 Diagnóstico do Kraken</h1>
    <p>Meu nó: <span class="mono">{NODE_ID}</span> ({mesh.display_name})</p>

    <h2>Peers descobertos na rede local ({len(peers)})</h2>
    <table>
      <tr><th>Nó</th><th>Endereço</th><th>Visto por último</th>
          <th>Sincronizar → ele (eu inicio)</th><th>Ele → mim (ele inicia)</th></tr>
      {''.join(rows) if rows else '<tr><td colspan="5">Nenhum peer descoberto ainda.</td></tr>'}
    </table>

    <h2>Nós conhecidos (têm chave guardada, p/ mensagem direta) ({len(known)})</h2>
    <table>
      <tr><th>Nome</th><th>ID</th><th>Visto por último</th></tr>
      {known_rows if known_rows else '<tr><td colspan="3">Nenhum ainda.</td></tr>'}
    </table>

    <p><a class="btn" href="/">← Voltar pro chat</a></p>
    </body></html>"""


@app.route("/join")
def join():
    ip = local_ip()
    url = f"http://{ip}:{HTTP_PORT}/"
    svg_bytes = ""
    debug_error = ""
    try:
        import qrcode
        import qrcode.image.svg
        from io import BytesIO
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgImage)
        buf = BytesIO()
        img.save(buf)
        svg_bytes = buf.getvalue().decode()
    except Exception:
        import traceback
        debug_error = traceback.format_exc()
        print(f"[join] falha ao gerar QR code:\n{debug_error}")
    logo_uri = _logo_data_uri()
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
      .debug{{text-align:left;background:#fff3f3;border:1px solid #f0b0b0;color:#a33;
        font-size:11px;padding:10px;margin-top:20px;white-space:pre-wrap;word-break:break-all}}
    </style></head><body>
    <img class="logo" src="{logo_uri}" alt="Kraken">
    <h1><span class="roxo">Kraken</span></h1>
    <p>Escaneie ou toque para entrar na conversa deste nó:</p>
    <div class="qr">{svg_bytes}</div>
    {f'<div class="debug">ERRO NO QR (debug temporário):<br>{debug_error}</div>' if debug_error else ''}
    {f'<div class="debug">Logo vazio: caminho tentado = {RESOURCE_DIR / "static" / "icons" / "icon-512.png"}</div>' if not logo_uri else ''}
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
    global DATA_DIR, FILES_DIR, DB_PATH, NODE_ID_PATH, NODE_KEY_PATH
    global NODE_ID, NODE_PRIVKEY, NODE_PUBKEY, store, mesh
    DATA_DIR = Path(path)
    FILES_DIR = DATA_DIR / "files"
    DB_PATH = DATA_DIR / "craque.db"
    NODE_ID_PATH = DATA_DIR / "node_id.txt"
    NODE_KEY_PATH = DATA_DIR / "node_key.bin"
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    NODE_ID = get_node_id()
    NODE_PRIVKEY = _load_or_create_node_key()
    NODE_PUBKEY = NODE_PRIVKEY.public_key
    store = Store(DB_PATH)
    mesh = MeshNode(NODE_ID, lambda msg: broadcast_new_message(_try_decrypt_message(msg)))


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


def _abrir_navegador_desktop():
    """Só roda quando o server.py é executado direto (Termux/desktop/.exe
    empacotado) - o KrakenService no Android chama start_server() sem
    passar por aqui, então o WebView continua sendo quem abre a tela lá.

    Tenta abrir como janela de app de verdade (Chrome/Edge --app=, sem
    barra de endereço nem abas) em vez de uma aba comum do navegador
    padrão. Se não achar Chrome/Edge instalado, cai pro navegador normal."""
    import shutil
    import subprocess
    import webbrowser

    time.sleep(1.5)
    url = f"http://127.0.0.1:{HTTP_PORT}/"

    candidatos = []
    for env_var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(env_var)
        if not base:
            continue
        candidatos.append(str(Path(base) / "Google/Chrome/Application/chrome.exe"))
        candidatos.append(str(Path(base) / "Microsoft/Edge/Application/msedge.exe"))
    for nome in ("chrome", "google-chrome", "chromium", "msedge"):
        achado = shutil.which(nome)
        if achado:
            candidatos.append(achado)

    for exe in candidatos:
        if exe and Path(exe).exists():
            try:
                subprocess.Popen([exe, f"--app={url}", "--window-size=420,760"])
                return
            except OSError:
                continue

    try:
        webbrowser.open(url)
    except Exception:
        pass


def _criar_atalhos_desktop():
    """Cria atalho na Área de Trabalho e no Menu Iniciar na primeira vez
    que o .exe empacotado roda - não é um instalador de verdade (não vai
    pra Program Files, não tem desinstalador), mas resolve o essencial sem
    precisar de outra ferramenta de build. Só roda uma vez (marcador em
    DATA_DIR) e só faz sentido no Windows empacotado."""
    if not getattr(sys, "frozen", False) or os.name != "nt":
        return
    marcador = DATA_DIR / ".atalhos_criados"
    if marcador.exists():
        return
    try:
        import subprocess
        exe = str(Path(sys.executable).resolve())
        pasta_exe = str(Path(exe).parent)
        destinos = [
            str(Path(os.environ["USERPROFILE"]) / "Desktop" / "Kraken.lnk"),
            str(Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Kraken.lnk"),
        ]
        for destino in destinos:
            script = (
                f'$s = (New-Object -ComObject WScript.Shell).CreateShortcut("{destino}"); '
                f'$s.TargetPath = "{exe}"; $s.WorkingDirectory = "{pasta_exe}"; '
                f'$s.IconLocation = "{exe}"; $s.Save()'
            )
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True, timeout=15,
            )
        marcador.write_text("ok")
    except Exception:
        pass  # atalho é conveniência, nunca deve impedir o app de abrir


if __name__ == "__main__":
    _criar_atalhos_desktop()
    threading.Thread(target=_abrir_navegador_desktop, daemon=True).start()
    start_server()
