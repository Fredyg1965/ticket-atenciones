# 🎫 Ticketera · Control de atenciones

Prototipo web para gestionar turnos de atención (tipo "toma tu número").
Hecho solo con HTML, CSS y JavaScript: **no necesita servidor ni base de datos**.
Los datos se guardan en el navegador (`localStorage`).

## Vistas

| Vista | Para qué sirve |
|-------|----------------|
| **Emitir ticket** | Kiosko donde el cliente elige el servicio y obtiene su número (se puede imprimir). |
| **Ventanilla** | Panel del operador: llamar siguiente, volver a llamar, finalizar o marcar "no se presentó". |
| **Pantalla** | Pantalla pública con el turno actual, últimos llamados y sonido/voz opcional. |
| **Reporte** | Estadísticas del día, resumen por servicio, historial y exportación a CSV. |

Servicios incluidos: **Preferencial (P)** (tiene prioridad), **Atención general (A)** y **Caja (C)**.

## Cómo usarlo

1. Abra `index.html` en el navegador (doble clic) o use la versión publicada en GitHub Pages.
2. Abra varias pestañas del **mismo navegador** para simular el sistema completo:
   - una en **Emitir ticket** (kiosko),
   - una o más en **Ventanilla** (cada pestaña puede ser una ventanilla distinta),
   - una en **Pantalla** → botón *Abrir en ventana* para verla a pantalla completa.
3. Las pestañas se sincronizan solas.

> ⚠️ Al ser un prototipo sin base de datos, los datos **no se comparten entre equipos o navegadores distintos**.
> Para uso real habría que agregar un backend (por ejemplo, una API con base de datos y WebSockets).

## Personalizar

En `app.js`:

- `SERVICES`: agregue, quite o renombre servicios (la letra es el prefijo del ticket).
- `DESK_COUNT`: cantidad de ventanillas.

Los colores de cada servicio están en `styles.css` (`--svc-P`, `--svc-A`, `--svc-C`).

## Archivos

```
index.html   estructura de las 4 vistas
styles.css   estilos
app.js       lógica (estado, colas, render, sonido, CSV)
```
