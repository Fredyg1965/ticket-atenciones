"""Servidor de la Ticketera: API JSON + archivos estáticos, con datos en SQLite.

Solo usa la librería estándar de Python (3.9+). Uso:

    python server.py                 # http://127.0.0.1:8080
    python server.py --port 9000
    python server.py --host 0.0.0.0  # accesible desde otros equipos de la red

La base de datos se crea sola en data/ticketera.db (configurable con TICKETERA_DB).
"""

import argparse
import json
import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("TICKETERA_DB", ROOT / "data" / "ticketera.db"))

DESK_COUNT = 4
# La letra es el prefijo del ticket; "priority" se atiende antes que el resto.
SERVICES = {
    "P": {"name": "Preferencial", "desc": "Adultos mayores, embarazadas y personas con discapacidad", "priority": True},
    "A": {"name": "Atención general", "desc": "Consultas, trámites y reclamos"},
    "C": {"name": "Caja", "desc": "Pagos y cobros"},
}
MAX_NAME = 40
MAX_BODY = 10_000

# Solo se sirven estos archivos: nunca server.py, la base de datos ni otros.
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    NOT NULL,
    service      TEXT    NOT NULL,
    name         TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'espera'
                 CHECK (status IN ('espera', 'llamado', 'atendido', 'ausente')),
    desk         INTEGER,
    calls        INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,  -- epoch en milisegundos
    called_at    INTEGER,           -- primer llamado (para medir la espera)
    announced_at INTEGER,           -- último llamado (para la pantalla)
    finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, service);
"""

# Serializa las escrituras: evita que dos ventanillas tomen el mismo ticket.
write_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def now_ms():
    return int(time.time() * 1000)


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def transaction():
    """Conexión que hace commit (o rollback si hay error) y siempre se cierra."""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with transaction() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)


def to_ticket(row):
    return {
        "id": row["id"],
        "code": row["code"],
        "service": row["service"],
        "name": row["name"],
        "status": row["status"],
        "desk": row["desk"],
        "calls": row["calls"],
        "createdAt": row["created_at"],
        "calledAt": row["called_at"],
        "announcedAt": row["announced_at"],
        "finishedAt": row["finished_at"],
    }


def get_ticket(conn, ticket_id):
    return to_ticket(conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone())


def current_ticket(conn, desk):
    return conn.execute(
        "SELECT * FROM tickets WHERE status = 'llamado' AND desk = ?", (desk,)
    ).fetchone()


# ---------- Operaciones ----------

def get_state():
    with transaction() as conn:
        tickets = [to_ticket(r) for r in conn.execute("SELECT * FROM tickets ORDER BY id")]
        last = conn.execute(
            "SELECT id, announced_at FROM tickets WHERE announced_at IS NOT NULL "
            "ORDER BY announced_at DESC, id DESC LIMIT 1"
        ).fetchone()
    return {
        "tickets": tickets,
        "lastCall": {"id": last["id"], "at": last["announced_at"]} if last else None,
    }


def issue_ticket(body):
    service = body.get("service")
    if service not in SERVICES:
        raise ApiError(400, "Servicio inválido")
    name = str(body.get("name") or "").strip()[:MAX_NAME]

    with write_lock, transaction() as conn:
        number = conn.execute("SELECT COUNT(*) FROM tickets WHERE service = ?", (service,)).fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO tickets (code, service, name, created_at) VALUES (?, ?, ?, ?)",
            (f"{service}-{number:03d}", service, name, now_ms()),
        )
        return get_ticket(conn, cur.lastrowid)


def call_next(desk, body):
    services = [s for s in body.get("services") or [] if s in SERVICES]
    if not services:
        raise ApiError(400, "Seleccione al menos un servicio")
    priority = [k for k, v in SERVICES.items() if v.get("priority")] or [""]

    with write_lock, transaction() as conn:
        if current_ticket(conn, desk):
            raise ApiError(409, "La ventanilla ya tiene una atención en curso")
        row = conn.execute(
            f"""SELECT id FROM tickets
                WHERE status = 'espera' AND service IN ({','.join('?' * len(services))})
                ORDER BY CASE WHEN service IN ({','.join('?' * len(priority))}) THEN 0 ELSE 1 END,
                         created_at, id
                LIMIT 1""",
            (*services, *priority),
        ).fetchone()
        if not row:
            raise ApiError(409, "No hay personas en espera")
        ts = now_ms()
        conn.execute(
            "UPDATE tickets SET status = 'llamado', desk = ?, calls = 1, called_at = ?, announced_at = ? WHERE id = ?",
            (desk, ts, ts, row["id"]),
        )
        return get_ticket(conn, row["id"])


def recall(desk, _body):
    with write_lock, transaction() as conn:
        row = current_ticket(conn, desk)
        if not row:
            raise ApiError(409, "No hay atención en curso")
        conn.execute(
            "UPDATE tickets SET calls = calls + 1, announced_at = ? WHERE id = ?", (now_ms(), row["id"])
        )
        return get_ticket(conn, row["id"])


def finish(desk, body):
    status = body.get("status")
    if status not in ("atendido", "ausente"):
        raise ApiError(400, "Estado inválido")
    with write_lock, transaction() as conn:
        row = current_ticket(conn, desk)
        if not row:
            raise ApiError(409, "No hay atención en curso")
        conn.execute(
            "UPDATE tickets SET status = ?, finished_at = ? WHERE id = ?", (status, now_ms(), row["id"])
        )
        return get_ticket(conn, row["id"])


def reset_day():
    with write_lock, transaction() as conn:
        conn.execute("DELETE FROM tickets")
    return {"ok": True}


DESK_ACTIONS = {"next": call_next, "recall": recall, "finish": finish}
DESK_ROUTE = re.compile(r"^/api/desks/(\d+)/(next|recall|finish)$")


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "Ticketera"

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/config":
            return self.send_json(200, {"services": SERVICES, "deskCount": DESK_COUNT})
        if path == "/api/state":
            return self.send_json(200, get_state())
        if path in STATIC:
            return self.send_static(*STATIC[path])
        self.send_json(404, {"error": "No encontrado"})

    def do_POST(self):
        path = urlparse(self.path).path
        self.handle_api(lambda body: self.route_post(path, body))

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/tickets":
            return self.handle_api(lambda _body: reset_day())
        self.send_json(404, {"error": "No encontrado"})

    def route_post(self, path, body):
        if path == "/api/tickets":
            return issue_ticket(body)
        match = DESK_ROUTE.match(path)
        if match:
            desk = int(match.group(1))
            if not 1 <= desk <= DESK_COUNT:
                raise ApiError(400, "Ventanilla inválida")
            return DESK_ACTIONS[match.group(2)](desk, body)
        raise ApiError(404, "No encontrado")

    def handle_api(self, action):
        try:
            self.send_json(200, action(self.read_body()))
        except ApiError as err:
            self.send_json(err.status, {"error": str(err)})

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Solicitud demasiado grande")
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise ApiError(400, "JSON inválido")
        if not isinstance(body, dict):
            raise ApiError(400, "JSON inválido")
        return body

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, filename, content_type):
        data = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # El sondeo de /api/state cada 2 s llenaría la consola.
        if "/api/state" not in self.path:
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="Servidor de la Ticketera (SQLite)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    init_db()
    # En Windows SO_REUSEADDR permite que dos procesos usen el mismo puerto;
    # se desactiva para que falle con un error claro si el puerto está ocupado.
    ThreadingHTTPServer.allow_reuse_address = os.name != "nt"
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as err:
        raise SystemExit(f"No se pudo usar el puerto {args.port}: {err}. Pruebe con --port <otro>.")
    print(f"Ticketera en http://{args.host}:{args.port}  (base de datos: {DB_PATH})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
