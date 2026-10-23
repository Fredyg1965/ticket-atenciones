# 🎫 Ticketera · Control de atenciones

Prototipo web para gestionar turnos de atención (tipo "toma tu número").
Frontend en HTML, CSS y JavaScript puro; los datos se guardan en **SQLite** mediante un
pequeño servidor en Python que **no necesita instalar dependencias**.

> Rama `feature/sqlite`. La versión sin base de datos (solo navegador) está en `main`.

## Vistas

| Vista | Para qué sirve |
|-------|----------------|
| **Emitir ticket** | Kiosko donde el cliente elige el servicio y obtiene su número (se puede imprimir). |
| **Ventanilla** | Panel del operador: llamar siguiente, volver a llamar, finalizar o marcar "no se presentó". |
| **Pantalla** | Pantalla pública con el turno actual, últimos llamados y sonido/voz opcional. |
| **Reporte** | Estadísticas del día, resumen por servicio, historial y exportación a CSV. |

Servicios incluidos: **Preferencial (P)** (tiene prioridad), **Atención general (A)** y **Caja (C)**.

## Requisitos

- Python 3.9 o superior (ya incluye `sqlite3`).

## Cómo usarlo

```bash
python server.py
```

Abra http://127.0.0.1:8080 y use varias pestañas (o varios equipos) a la vez:

- `http://127.0.0.1:8080/#emitir` → kiosko
- `http://127.0.0.1:8080/#ventanilla` → cada pestaña puede ser una ventanilla distinta
- `http://127.0.0.1:8080/?modo=pantalla#pantalla` → pantalla pública a pantalla completa

Todas las vistas se sincronizan con el servidor cada 2 segundos.

### Opciones

```bash
python server.py --port 9000                   # otro puerto
python server.py --host 0.0.0.0                # accesible desde otros equipos de la red
TICKETERA_DB=/ruta/otra.db python server.py    # otra base de datos
```

> ⚠️ El servidor **no tiene usuarios ni contraseñas**. Use `--host 0.0.0.0` solo en una red de confianza.

La base de datos se crea sola en `data/ticketera.db` (no se sube al repositorio).

## API

| Método | Ruta | Cuerpo | Descripción |
|--------|------|--------|-------------|
| GET | `/api/config` | — | Servicios y cantidad de ventanillas |
| GET | `/api/state` | — | Todos los tickets y el último llamado |
| POST | `/api/tickets` | `{ "service": "A", "name": "..." }` | Emite un ticket |
| POST | `/api/desks/{n}/next` | `{ "services": ["P","A"] }` | Llama al siguiente turno |
| POST | `/api/desks/{n}/recall` | — | Vuelve a llamar el turno actual |
| POST | `/api/desks/{n}/finish` | `{ "status": "atendido" \| "ausente" }` | Cierra la atención |
| DELETE | `/api/tickets` | — | Reinicia el día (borra todos los tickets) |

## Personalizar

En `server.py`:

- `SERVICES`: agregue, quite o renombre servicios (la letra es el prefijo del ticket).
- `DESK_COUNT`: cantidad de ventanillas.

Los colores de cada servicio están en `styles.css` (`--svc-P`, `--svc-A`, `--svc-C`).

## Archivos

```
server.py    servidor HTTP + API + SQLite (librería estándar de Python)
index.html   estructura de las 4 vistas
styles.css   estilos
app.js       interfaz: consume la API, render, sonido, CSV
```
