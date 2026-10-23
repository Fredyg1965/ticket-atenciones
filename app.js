'use strict';

// ---------- Configuración ----------
const STORE_KEY = 'ticketera.v1';
const DESK_KEY = 'ticketera.desk';
const DESK_COUNT = 4;
const VIEWS = ['emitir', 'ventanilla', 'pantalla', 'reporte'];

// El orden define cómo se muestran; "priority" se atiende antes que el resto.
const SERVICES = {
  P: { name: 'Preferencial', desc: 'Adultos mayores, embarazadas y personas con discapacidad', priority: true },
  A: { name: 'Atención general', desc: 'Consultas, trámites y reclamos' },
  C: { name: 'Caja', desc: 'Pagos y cobros' },
};

const STATUS_LABEL = {
  espera: 'En espera',
  llamado: 'En atención',
  atendido: 'Atendido',
  ausente: 'No se presentó',
};

const $ = (sel) => document.querySelector(sel);

// ---------- Estado (localStorage) ----------
function emptyState() {
  return {
    counters: Object.fromEntries(Object.keys(SERVICES).map((k) => [k, 0])),
    tickets: [],
    lastCall: null,
  };
}

function load() {
  try {
    const state = JSON.parse(localStorage.getItem(STORE_KEY));
    if (state && Array.isArray(state.tickets)) return state;
  } catch {
    // Datos corruptos: se empieza de cero.
  }
  return emptyState();
}

// Lee siempre el estado más reciente antes de modificarlo, así varias
// pestañas (kiosko, ventanillas, pantalla) no se pisan entre sí.
function update(mutator) {
  const state = load();
  const result = mutator(state);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  render();
  return result;
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
const svcTag = (key) => `<span class="tag" ${svcStyle(key)}>${esc(SERVICES[key].name)}</span>`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const average = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

function queueOrder(a, b) {
  const pa = SERVICES[a.service].priority ? 0 : 1;
  const pb = SERVICES[b.service].priority ? 0 : 1;
  return pa - pb || a.createdAt - b.createdAt;
}

function waitingList(state, services) {
  return state.tickets
    .filter((t) => t.status === 'espera' && (!services || services.includes(t.service)))
    .sort(queueOrder);
}

const currentTicket = (state, desk) => state.tickets.find((t) => t.status === 'llamado' && t.desk === desk);

// ---------- Acciones ----------
function issueTicket(service, name) {
  return update((state) => {
    state.counters[service] = (state.counters[service] || 0) + 1;
    const ticket = {
      id: newId(),
      code: `${service}-${String(state.counters[service]).padStart(3, '0')}`,
      service,
      name: name.trim(),
      status: 'espera',
      desk: null,
      calls: 0,
      createdAt: Date.now(),
      calledAt: null,
      finishedAt: null,
    };
    state.tickets.push(ticket);
    return ticket;
  });
}

function markCalled(state, ticket) {
  ticket.calls += 1;
  ticket.calledAt = Date.now();
  state.lastCall = { id: ticket.id, at: ticket.calledAt };
}

function callNext() {
  const { desk, services } = deskConfig();
  update((state) => {
    if (currentTicket(state, desk)) return;
    const next = waitingList(state, services)[0];
    if (!next) return;
    next.status = 'llamado';
    next.desk = desk;
    markCalled(state, next);
  });
}

function recall() {
  const { desk } = deskConfig();
  update((state) => {
    const ticket = currentTicket(state, desk);
    if (ticket) markCalled(state, ticket);
  });
}

function finish(status) {
  const { desk } = deskConfig();
  update((state) => {
    const ticket = currentTicket(state, desk);
    if (!ticket) return;
    ticket.status = status;
    ticket.finishedAt = Date.now();
  });
}

// ---------- Configuración de ventanilla (por pestaña) ----------
function deskConfig() {
  try {
    const cfg = JSON.parse(sessionStorage.getItem(DESK_KEY));
    if (cfg && cfg.desk) return cfg;
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

// ---------- Render: Emitir ----------
let lastIssuedId = null;

function renderEmitir(state) {
  $('#service-buttons').innerHTML = Object.entries(SERVICES).map(([key, svc]) => `
    <button class="service-btn" type="button" data-service="${key}" ${svcStyle(key)}>
      <strong>${esc(svc.name)}</strong>
      <small>${esc(svc.desc)}</small>
      <span class="badge">${waitingList(state, [key]).length} en espera</span>
    </button>`).join('');

  const box = $('#issued');
  const ticket = state.tickets.find((t) => t.id === lastIssuedId);
  if (!ticket) {
    box.classList.add('hidden');
    return;
  }
  const ahead = waitingList(state, [ticket.service]).findIndex((t) => t.id === ticket.id);
  box.classList.remove('hidden');
  box.setAttribute('style', `--svc-color: var(--svc-${ticket.service})`);
  box.innerHTML = `
    <p class="muted">Su turno es</p>
    <div class="code">${esc(ticket.code)}</div>
    <p>${svcTag(ticket.service)}</p>
    ${ticket.name ? `<p><strong>${esc(ticket.name)}</strong></p>` : ''}
    <p class="muted">Emitido a las ${fmtTime(ticket.createdAt)}</p>
    <p>${ahead >= 0
      ? `Personas antes que usted: <strong>${ahead}</strong>`
      : `Estado: <strong>${STATUS_LABEL[ticket.status]}</strong>`}</p>
    <button class="btn ghost no-print" type="button" onclick="window.print()">🖨️ Imprimir</button>`;
}

// ---------- Render: Ventanilla ----------
function renderVentanilla(state) {
  const { desk, services } = deskConfig();
  const current = currentTicket(state, desk);
  const queue = waitingList(state, services);
  const box = $('#desk-current');

  if (current) {
    box.setAttribute('style', `--svc-color: var(--svc-${current.service})`);
    box.innerHTML = `
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
      </div>`;
  } else {
    box.removeAttribute('style');
    box.innerHTML = `
      <p class="muted">Ventanilla ${desk} libre</p>
      <div class="code">—</div>
      <div class="meta">${services.length ? `${queue.length} persona(s) en espera para esta ventanilla` : 'Seleccione al menos un servicio'}</div>
      <div class="actions">
        <button class="btn big" type="button" data-action="next" ${queue.length ? '' : 'disabled'}>📣 Llamar siguiente</button>
      </div>`;
  }

  $('#queue-count').textContent = queue.length;
  $('#desk-queue').innerHTML = queue.length
    ? queue.map((t) => `
        <li>
          <span><span class="code">${esc(t.code)}</span>${svcTag(t.service)} ${esc(t.name)}</span>
          <span class="muted">${fmtDuration(Date.now() - t.createdAt)}</span>
        </li>`).join('')
    : '<li class="empty">No hay personas en espera</li>';
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

  $('#display-main').innerHTML = main
    ? `<div class="label">Turno</div>
       <div class="code">${esc(main.code)}</div>
       <div class="desk">Ventanilla ${main.desk}</div>
       <p>${svcTag(main.service)}</p>`
    : '<div class="label">Esperando turnos…</div>';

  const history = state.tickets
    .filter((t) => t.calledAt && t !== main)
    .sort((a, b) => b.calledAt - a.calledAt)
    .slice(0, 6);
  $('#display-history').innerHTML = history.length
    ? history.map((t) => `<li><span>${esc(t.code)}</span><span>Ventanilla ${t.desk}</span></li>`).join('')
    : '<li><span>—</span><span></span></li>';

  $('#display-waiting').innerHTML = Object.keys(SERVICES)
    .map((key) => `<span class="tag" ${svcStyle(key)}>${esc(SERVICES[key].name)}: ${waitingList(state, [key]).length}</span>`)
    .join('');

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
  $('#stats').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`)
    .join('');

  $('#service-table').innerHTML = `
    <tr><th>Servicio</th><th>Emitidos</th><th>En espera</th><th>Atendidos</th><th>Ausentes</th><th>Espera prom.</th><th>Atención prom.</th></tr>
    ${Object.keys(SERVICES).map((key) => {
      const r = summarize(state.tickets.filter((t) => t.service === key));
      return `<tr><td>${svcTag(key)}</td><td>${r.total}</td><td>${r.espera}</td><td>${r.atendido}</td><td>${r.ausente}</td>
        <td>${fmtDuration(r.avgWait)}</td><td>${fmtDuration(r.avgService)}</td></tr>`;
    }).join('')}`;

  const rows = [...state.tickets].sort((a, b) => b.createdAt - a.createdAt);
  $('#history-table').innerHTML = `
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
      </tr>`).join('') : '<tr><td class="empty" colspan="9">Aún no se emiten tickets</td></tr>'}`;
}

function exportCsv() {
  const state = load();
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
  const state = load();
  renderEmitir(state);
  renderVentanilla(state);
  renderPantalla(state);
  renderReporte(state);
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function init() {
  if (isKiosk) document.body.classList.add('kiosk');

  // Configuración de ventanilla (controles fijos, no se re-renderizan).
  const cfg = deskConfig();
  $('#desk-select').innerHTML = Array.from({ length: DESK_COUNT }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === cfg.desk ? 'selected' : ''}>${n}</option>`).join('');
  $('#desk-services').insertAdjacentHTML('beforeend', Object.entries(SERVICES).map(([key, svc]) => `
    <label><input type="checkbox" value="${key}" ${cfg.services.includes(key) ? 'checked' : ''}> ${esc(svc.name)}</label>`).join(''));
  $('#desk-select').addEventListener('change', saveDeskConfig);
  $('#desk-services').addEventListener('change', saveDeskConfig);

  $('#service-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-service]');
    if (!btn) return;
    const nameInput = $('#customer-name');
    lastIssuedId = issueTicket(btn.dataset.service, nameInput.value).id;
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
    localStorage.removeItem(STORE_KEY);
    lastIssuedId = null;
    render();
  });

  // Sincronización entre pestañas + refresco periódico de tiempos.
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY || e.key === null) render();
  });
  window.addEventListener('hashchange', showView);
  setInterval(render, 2000);
  setInterval(tickClock, 1000);

  seenCall = undefined; // no anunciar el último llamado al abrir la página
  tickClock();
  showView();
}

init();
