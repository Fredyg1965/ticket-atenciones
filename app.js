'use strict';

// ---------- Configuración ----------
// Servicios y ventanillas los define el servidor (server.py) y se cargan en init().
const DESK_KEY = 'ticketera.desk';
const REFRESH_MS = 2000;
const VIEWS = ['emitir', 'ventanilla', 'pantalla', 'reporte'];
let SERVICES = {};
let DESK_COUNT = 0;

const STATUS_LABEL = {
  espera: 'En espera',
  llamado: 'En atención',
  atendido: 'Atendido',
  ausente: 'No se presentó',
};

const $ = (sel) => document.querySelector(sel);

// ---------- Estado (servidor SQLite) ----------
let appState = { tickets: [], lastCall: null };
let busy = false;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function refresh() {
  try {
    appState = await api('GET', '/api/state');
    $('#offline').classList.add('hidden');
  } catch {
    $('#offline').classList.remove('hidden');
  }
  render();
}

// Ejecuta una acción en el servidor y vuelve a leer el estado.
// "busy" evita dobles clics mientras la solicitud está en curso.
async function act(request) {
  if (busy) return null;
  busy = true;
  try {
    return await request();
  } catch (err) {
    toast(err.message);
    return null;
  } finally {
    busy = false;
    await refresh();
  }
}

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.add('hidden'), 3500);
}

// ---------- Utilidades ----------
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—');

function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  return min ? `${min}m ${totalSec % 60}s` : `${totalSec}s`;
}

const svcStyle = (key) => `style="--svc-color: var(--svc-${key})"`;
const svcTag = (key) => `<span class="tag" ${svcStyle(key)}>${esc(SERVICES[key]?.name ?? key)}</span>`;
const average = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// Debe coincidir con el ORDER BY de call_next() en server.py.
function queueOrder(a, b) {
  const pa = SERVICES[a.service]?.priority ? 0 : 1;
  const pb = SERVICES[b.service]?.priority ? 0 : 1;
  return pa - pb || a.createdAt - b.createdAt || a.id - b.id;
}

function waitingList(state, services) {
  return state.tickets
    .filter((t) => t.status === 'espera' && (!services || services.includes(t.service)))
    .sort(queueOrder);
}

const currentTicket = (state, desk) => state.tickets.find((t) => t.status === 'llamado' && t.desk === desk);

// ---------- Acciones ----------
const issueTicket = (service, name) => act(() => api('POST', '/api/tickets', { service, name }));

function callNext() {
  const { desk, services } = deskConfig();
  return act(() => api('POST', `/api/desks/${desk}/next`, { services }));
}

function recall() {
  return act(() => api('POST', `/api/desks/${deskConfig().desk}/recall`));
}

function finish(status) {
  return act(() => api('POST', `/api/desks/${deskConfig().desk}/finish`, { status }));
}

// ---------- Configuración de ventanilla (por pestaña) ----------
function deskConfig() {
  try {
    const cfg = JSON.parse(sessionStorage.getItem(DESK_KEY));
    if (cfg && cfg.desk >= 1 && cfg.desk <= DESK_COUNT) return cfg;
  } catch {
    // Configuración inválida: se usa la predeterminada.
  }
  return { desk: 1, services: Object.keys(SERVICES) };
}

function saveDeskConfig() {
  const services = [...document.querySelectorAll('#desk-services input:checked')].map((i) => i.value);
  sessionStorage.setItem(DESK_KEY, JSON.stringify({ desk: Number($('#desk-select').value), services }));
  render();
}

// Reemplaza el HTML solo si cambió: el refresco periódico no recrea los botones
// (un clic justo durante el redibujo se perdería).
const lastHtml = new WeakMap();
function setHtml(el, html) {
  if (lastHtml.get(el) === html) return;
  el.innerHTML = html;
  lastHtml.set(el, html);
}

// ---------- Render: Emitir ----------
let lastIssuedId = null;

function renderEmitir(state) {
  setHtml($('#service-buttons'), Object.entries(SERVICES).map(([key, svc]) => `
    <button class="service-btn" type="button" data-service="${key}" ${svcStyle(key)}>
      <strong>${esc(svc.name)}</strong>
      <small>${esc(svc.desc)}</small>
      <span class="badge">${waitingList(state, [key]).length} en espera</span>
    </button>`).join(''));

  const box = $('#issued');
  const ticket = state.tickets.find((t) => t.id === lastIssuedId);
  if (!ticket) {
    box.classList.add('hidden');
    return;
  }
  const ahead = waitingList(state, [ticket.service]).findIndex((t) => t.id === ticket.id);
  box.classList.remove('hidden');
  box.setAttribute('style', `--svc-color: var(--svc-${ticket.service})`);
  setHtml(box, `
    <p class="muted">Su turno es</p>
    <div class="code">${esc(ticket.code)}</div>
    <p>${svcTag(ticket.service)}</p>
    ${ticket.name ? `<p><strong>${esc(ticket.name)}</strong></p>` : ''}
    <p class="muted">Emitido a las ${fmtTime(ticket.createdAt)}</p>
    <p>${ahead >= 0
      ? `Personas antes que usted: <strong>${ahead}</strong>`
      : `Estado: <strong>${STATUS_LABEL[ticket.status]}</strong>`}</p>
    <button class="btn ghost no-print" type="button" onclick="window.print()">🖨️ Imprimir</button>`);
}

// ---------- Render: Ventanilla ----------
function renderVentanilla(state) {
  const { desk, services } = deskConfig();
  const current = currentTicket(state, desk);
  const queue = waitingList(state, services);
  const box = $('#desk-current');

  if (current) {
    box.setAttribute('style', `--svc-color: var(--svc-${current.service})`);
    setHtml(box, `
      <p class="muted">Atendiendo en ventanilla ${desk}</p>
      <div class="code">${esc(current.code)}</div>
      <div class="meta">
        ${svcTag(current.service)} ${current.name ? `· <strong>${esc(current.name)}</strong>` : ''}<br>
        Esperó ${fmtDuration(current.calledAt - current.createdAt)} · llamado ${current.calls} ${current.calls === 1 ? 'vez' : 'veces'}
      </div>
      <div class="actions">
        <button class="btn ok big" type="button" data-action="finish">✔ Finalizar atención</button>
        <button class="btn" type="button" data-action="recall">🔁 Volver a llamar</button>
        <button class="btn warn" type="button" data-action="absent">✖ No se presentó</button>
      </div>`);
  } else {
    box.removeAttribute('style');
    setHtml(box, `
      <p class="muted">Ventanilla ${desk} libre</p>
      <div class="code">—</div>
      <div class="meta">${services.length ? `${queue.length} persona(s) en espera para esta ventanilla` : 'Seleccione al menos un servicio'}</div>
      <div class="actions">
        <button class="btn big" type="button" data-action="next" ${queue.length ? '' : 'disabled'}>📣 Llamar siguiente</button>
      </div>`);
  }

  $('#queue-count').textContent = queue.length;
  setHtml($('#desk-queue'), queue.length
    ? queue.map((t) => `
        <li>
          <span><span class="code">${esc(t.code)}</span>${svcTag(t.service)} ${esc(t.name)}</span>
          <span class="muted">${fmtDuration(Date.now() - t.createdAt)}</span>
        </li>`).join('')
    : '<li class="empty">No hay personas en espera</li>');
}

// ---------- Render: Pantalla ----------
let soundOn = false;
let seenCall = null;
let audioCtx = null;

function beep() {
  audioCtx ||= new AudioContext();
  [660, 880].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const start = audioCtx.currentTime + i * 0.25;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  });
}

function announce(ticket) {
  const main = $('#display-main');
  main.classList.remove('flash');
  void main.offsetWidth; // reinicia la animación
  main.classList.add('flash');

  if (!soundOn) return;
  beep();
  if ('speechSynthesis' in window) {
    // "A-005" -> "A 5"
    const spoken = ticket.code.replace('-', ' ').replace(/ 0+(\d)/, ' $1');
    const msg = new SpeechSynthesisUtterance(`Turno ${spoken}, ventanilla ${ticket.desk}`);
    msg.lang = 'es-ES';
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(msg), 700);
  }
}

function renderPantalla(state) {
  const main = state.lastCall && state.tickets.find((t) => t.id === state.lastCall.id);

  setHtml($('#display-main'), main
    ? `<div class="label">Turno</div>
       <div class="code">${esc(main.code)}</div>
       <div class="desk">Ventanilla ${main.desk}</div>
       <p>${svcTag(main.service)}</p>`
    : '<div class="label">Esperando turnos…</div>');

  const history = state.tickets
    .filter((t) => t.announcedAt && t !== main)
    .sort((a, b) => b.announcedAt - a.announcedAt)
    .slice(0, 6);
  setHtml($('#display-history'), history.length
    ? history.map((t) => `<li><span>${esc(t.code)}</span><span>Ventanilla ${t.desk}</span></li>`).join('')
    : '<li><span>—</span><span></span></li>');

  setHtml($('#display-waiting'), Object.keys(SERVICES)
    .map((key) => `<span class="tag" ${svcStyle(key)}>${esc(SERVICES[key].name)}: ${waitingList(state, [key]).length}</span>`)
    .join(''));

  const callKey = state.lastCall ? `${state.lastCall.id}@${state.lastCall.at}` : null;
  if (callKey !== seenCall) {
    const isFirstRender = seenCall === undefined;
    seenCall = callKey;
    if (main && !isFirstRender && currentView() === 'pantalla') announce(main);
  }
}

// ---------- Render: Reporte ----------
function ticketDurations(t) {
  return {
    wait: t.calledAt ? t.calledAt - t.createdAt : null,
    service: t.status === 'atendido' ? t.finishedAt - t.calledAt : null,
  };
}

function summarize(tickets) {
  const durations = tickets.map(ticketDurations);
  return {
    total: tickets.length,
    espera: tickets.filter((t) => t.status === 'espera').length,
    llamado: tickets.filter((t) => t.status === 'llamado').length,
    atendido: tickets.filter((t) => t.status === 'atendido').length,
    ausente: tickets.filter((t) => t.status === 'ausente').length,
    avgWait: average(durations.map((d) => d.wait).filter((v) => v != null)),
    avgService: average(durations.map((d) => d.service).filter((v) => v != null)),
  };
}

function renderReporte(state) {
  const s = summarize(state.tickets);
  const stats = [
    ['Emitidos', s.total],
    ['En espera', s.espera],
    ['En atención', s.llamado],
    ['Atendidos', s.atendido],
    ['No se presentaron', s.ausente],
    ['Espera promedio', fmtDuration(s.avgWait)],
    ['Atención promedio', fmtDuration(s.avgService)],
  ];
  setHtml($('#stats'), stats
    .map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`)
    .join(''));

  setHtml($('#service-table'), `
    <tr><th>Servicio</th><th>Emitidos</th><th>En espera</th><th>Atendidos</th><th>Ausentes</th><th>Espera prom.</th><th>Atención prom.</th></tr>
    ${Object.keys(SERVICES).map((key) => {
      const r = summarize(state.tickets.filter((t) => t.service === key));
      return `<tr><td>${svcTag(key)}</td><td>${r.total}</td><td>${r.espera}</td><td>${r.atendido}</td><td>${r.ausente}</td>
        <td>${fmtDuration(r.avgWait)}</td><td>${fmtDuration(r.avgService)}</td></tr>`;
    }).join('')}`);

  const rows = [...state.tickets].sort((a, b) => b.createdAt - a.createdAt);
  setHtml($('#history-table'), `
    <tr><th>Ticket</th><th>Servicio</th><th>Nombre</th><th>Estado</th><th>Ventanilla</th><th>Emitido</th><th>Llamado</th><th>Finalizado</th><th>Espera</th></tr>
    ${rows.length ? rows.map((t) => `
      <tr>
        <td><strong>${esc(t.code)}</strong></td>
        <td>${svcTag(t.service)}</td>
        <td>${esc(t.name) || '—'}</td>
        <td class="status status-${t.status}">${STATUS_LABEL[t.status]}</td>
        <td>${t.desk ?? '—'}</td>
        <td>${fmtTime(t.createdAt)}</td>
        <td>${fmtTime(t.calledAt)}</td>
        <td>${fmtTime(t.finishedAt)}</td>
        <td>${fmtDuration(ticketDurations(t).wait ?? Date.now() - t.createdAt)}</td>
      </tr>`).join('') : '<tr><td class="empty" colspan="9">Aún no se emiten tickets</td></tr>'}`);
}

function exportCsv() {
  const state = appState;
  const toMin = (ms) => (ms == null ? '' : (ms / 60000).toFixed(1));
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('es') : '');
  // Evita que Excel interprete nombres como fórmulas.
  const safe = (v) => (/^[=+\-@]/.test(String(v)) ? `'${v}` : v);
  const rows = [
    ['Ticket', 'Servicio', 'Nombre', 'Estado', 'Ventanilla', 'Emitido', 'Llamado', 'Finalizado', 'Espera (min)', 'Atención (min)'],
    ...state.tickets.map((t) => {
      const d = ticketDurations(t);
      return [t.code, SERVICES[t.service].name, safe(t.name), STATUS_LABEL[t.status], t.desk ?? '',
        fmtDate(t.createdAt), fmtDate(t.calledAt), fmtDate(t.finishedAt), toMin(d.wait), toMin(d.service)];
    }),
  ];
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `atenciones-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- Navegación y render general ----------
const isKiosk = new URLSearchParams(location.search).get('modo') === 'pantalla';

function currentView() {
  if (isKiosk) return 'pantalla';
  const view = location.hash.slice(1);
  return VIEWS.includes(view) ? view : 'emitir';
}

function showView() {
  const view = currentView();
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('active', v === view));
  document.querySelectorAll('nav a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  render();
}

function render() {
  renderEmitir(appState);
  renderVentanilla(appState);
  renderPantalla(appState);
  renderReporte(appState);
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function init() {
  if (isKiosk) document.body.classList.add('kiosk');

  try {
    ({ services: SERVICES, deskCount: DESK_COUNT } = await api('GET', '/api/config'));
  } catch {
    $('#offline').classList.remove('hidden');
    $('main').innerHTML = '<div class="card">No se pudo conectar con el servidor. Inicie <code>python server.py</code> y recargue la página.</div>';
    return;
  }

  // Configuración de ventanilla (controles fijos, no se re-renderizan).
  const cfg = deskConfig();
  $('#desk-select').innerHTML = Array.from({ length: DESK_COUNT }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === cfg.desk ? 'selected' : ''}>${n}</option>`).join('');
  $('#desk-services').insertAdjacentHTML('beforeend', Object.entries(SERVICES).map(([key, svc]) => `
    <label><input type="checkbox" value="${key}" ${cfg.services.includes(key) ? 'checked' : ''}> ${esc(svc.name)}</label>`).join(''));
  $('#desk-select').addEventListener('change', saveDeskConfig);
  $('#desk-services').addEventListener('change', saveDeskConfig);

  $('#service-buttons').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-service]');
    if (!btn) return;
    const nameInput = $('#customer-name');
    const ticket = await issueTicket(btn.dataset.service, nameInput.value);
    if (!ticket) return;
    lastIssuedId = ticket.id;
    nameInput.value = '';
    render();
  });

  $('#desk-current').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'next') callNext();
    if (action === 'recall') recall();
    if (action === 'finish') finish('atendido');
    if (action === 'absent') finish('ausente');
  });

  $('#sound-btn').addEventListener('click', (e) => {
    soundOn = !soundOn;
    if (soundOn) beep(); // el navegador exige un clic para habilitar audio
    e.currentTarget.textContent = soundOn ? '🔊 Sonido activo' : '🔇 Activar sonido';
  });

  $('#export-btn').addEventListener('click', exportCsv);
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los tickets y reiniciar la numeración?')) return;
    lastIssuedId = null;
    act(() => api('DELETE', '/api/tickets'));
  });

  // Sincronización con el servidor (sondeo) + reloj.
  window.addEventListener('hashchange', showView);
  setInterval(refresh, REFRESH_MS);
  setInterval(tickClock, 1000);

  seenCall = undefined; // no anunciar el último llamado al abrir la página
  tickClock();
  await refresh(); // el primer render ya llega con los datos del servidor
  showView();
}

init();
