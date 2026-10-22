"use strict";

// Control remoto para el celular: se abre desde http://<ip del PC>:7879/remoto en el mismo Wi-Fi.
// Pide el PIN una vez (queda una cookie) y luego maneja OBS, el programa al aire, versículos,
// comentarios y anuncios usando las mismas rutas /api del editor.

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...hijos) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h != null) n.append(h);
  return n;
};

const PESTANAS = [
  { id: "vivo", nombre: "En vivo", icono: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/>', cargar: () => api("/api/obs"), pintar: vistaVivo },
  { id: "programa", nombre: "Programa", icono: '<path d="M4 7h16v12H4z"/><path d="m8 3 4 4 4-4"/>', cargar: () => api("/api/estudio"), pintar: vistaPrograma },
  { id: "versiculo", nombre: "Versículo", icono: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M12 7v6M9 10h6"/>', cargar: () => api("/api/versiculo"), pintar: vistaVersiculo },
  { id: "comentario", nombre: "Comentario", icono: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', cargar: () => api("/api/comentarios"), pintar: vistaComentario },
  { id: "anuncios", nombre: "Anuncios", icono: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>', cargar: () => api("/api/estudio"), pintar: vistaAnuncios }
];

const R = { tab: "vivo", datos: null, pendiente: false, tPoll: null, vivos: {}, fuente: "youtube", firma: "" };
try { R.tab = localStorage.getItem("remotoPestana") || "vivo"; } catch {}
if (!PESTANAS.some(p => p.id === R.tab)) R.tab = "vivo";

async function api(ruta, opciones) {
  const r = await fetch(ruta, { cache: "no-store", ...opciones });
  if (r.status === 401) { pantallaPin(); throw new Error("Escribe el PIN para entrar"); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

function postear(ruta, cuerpo) {
  return api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
}

function toast(texto, tipo = "exito") {
  const t = $("#toast");
  t.textContent = texto;
  t.className = `toast ${tipo}`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

function tarjeta(titulo, ...hijos) {
  return el("section", { class: "tarjeta" }, titulo ? el("h2", {}, titulo) : null, ...hijos);
}

// Vibración corta al tocar algo importante (si el celular la permite)
function vibrar() { try { navigator.vibrate && navigator.vibrate(15); } catch {} }

async function hacer(ruta, cuerpo, mensaje) {
  vibrar();
  try {
    const r = await postear(ruta, cuerpo);
    pintar(r, true);
    if (mensaje) toast(mensaje);
    return r;
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

// ---------- Entrada con PIN ----------

function pantallaPin() {
  clearInterval(R.tPoll);
  $("#pestanas").hidden = true;
  $("#estadoVivo").hidden = true;
  const pin = el("input", { type: "password", inputMode: "numeric", pattern: "[0-9]*", maxLength: 8, autocomplete: "off", "aria-label": "PIN", placeholder: "••••" });
  const error = el("p", { class: "error", hidden: true });
  const entrar = async () => {
    error.hidden = true;
    try {
      const r = await fetch("/api/remoto/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pin.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo entrar");
      iniciar();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      pin.value = "";
      pin.focus();
    }
  };
  pin.addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });
  $("#contenido").replaceChildren(el("div", { class: "entrar" },
    el("h1", {}, "Control remoto"),
    el("p", {}, "Escribe el PIN que aparece en el Editor de Overlays del PC (sección «Control remoto»)."),
    pin, el("button", { class: "btn btn-primario ancho", type: "button", onclick: entrar }, "Entrar"), error));
  setTimeout(() => pin.focus(), 100);
}

// ---------- Navegación ----------

function pintarPestanas() {
  const nav = $("#pestanas");
  nav.hidden = false;
  nav.replaceChildren(...PESTANAS.map(p => {
    const b = el("button", { type: "button", "aria-current": String(p.id === R.tab), onclick: () => abrir(p.id) });
    b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p.icono}</svg>`;
    b.append(el("span", {}, p.nombre));
    return b;
  }));
}

function pestana() { return PESTANAS.find(p => p.id === R.tab); }

async function abrir(id) {
  R.tab = id;
  try { localStorage.setItem("remotoPestana", id); } catch {}
  R.datos = null;
  R.firma = "";
  pintarPestanas();
  window.scrollTo(0, 0);
  $("#contenido").replaceChildren(el("p", { class: "tenue" }, "Cargando…"));
  await recargar(true);
}

async function recargar(forzar) {
  const p = pestana();
  try { pintar(await p.cargar(), forzar); }
  catch (err) { if (forzar) $("#contenido").replaceChildren(tarjeta(null, el("p", { class: "error" }, err.message))); }
}

function escribiendo() {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox";
}

function pintar(datos, forzar) {
  R.datos = datos;
  if (R.tab === "vivo") {
    estadoBarra(datos);
    if (!forzar && R.firma === firmaObs(datos)) return actualizarVivos(datos);
  }
  if (!forzar && escribiendo()) { R.pendiente = true; return; }
  R.pendiente = false;
  R.vivos = {};
  $("#contenido").replaceChildren(...pestana().pintar(datos));
  if (R.tab === "vivo") { R.firma = firmaObs(datos); actualizarVivos(datos); }
}

document.addEventListener("focusout", () => setTimeout(() => { if (R.pendiente && !escribiendo() && R.datos) pintar(R.datos); }, 0));

function estadoBarra(o) {
  const b = $("#estadoVivo");
  if (!o || o.conexion !== "ok") { b.hidden = true; return; }
  b.hidden = false;
  b.className = "estado-vivo" + (o.transmision.activa ? " vivo" : "");
  b.textContent = o.transmision.activa ? `● EN VIVO ${o.transmision.tiempo || ""}` : "Fuera del aire";
}

// ---------- En vivo (OBS) ----------

function firmaObs(o) {
  return JSON.stringify([o.conexion, o.escena, o.escenas, o.audio, o.transmision && o.transmision.activa, o.grabacion && o.grabacion.activa, o.cuenta && o.cuenta.fin, o.config && [o.config.escenaEspera, o.config.escenaFinal]]);
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function actualizarVivos(o) {
  const v = R.vivos;
  if (v.t) v.t.textContent = o.transmision.activa ? o.transmision.tiempo || "" : "—";
  if (v.g) v.g.textContent = o.grabacion.activa ? o.grabacion.tiempo || "" : "—";
  if (v.cuenta && o.cuenta) v.cuenta.textContent = mmss(o.cuenta.fin - Date.now());
}

function vistaVivo(o) {
  if (o.conexion !== "ok") {
    return [el("h1", { class: "titulo" }, "En vivo"), tarjeta(null,
      el("p", { class: "tenue" }, o.conexion === "apagado"
        ? "OBS todavía no está conectado al editor. En el PC abre «En vivo · OBS» y presiona «Conectar»."
        : "No hay conexión con OBS. Revisa que OBS esté abierto en el PC; se reconecta solo."))];
  }
  const confirmar = (cual, accion, texto) => { if (confirm(texto)) hacer("/api/obs/salida", { cual, accion }, "Listo."); };
  const t = o.transmision, g = o.grabacion;
  R.vivos.t = el("span", { class: "tiempo" });
  R.vivos.g = el("span", { class: "tiempo" });
  const out = [el("h1", { class: "titulo" }, "En vivo"),
    el("div", { class: "salidas" },
      el("div", { class: "salida" + (t.activa ? " activa" : "") }, el("span", { class: "nombre" }, t.activa ? "● En vivo" : "Transmisión"), R.vivos.t,
        el("button", { class: "btn " + (t.activa ? "btn-suave" : "btn-primario"), type: "button",
          onclick: () => confirmar("transmision", t.activa ? "detener" : "iniciar", t.activa ? "¿Detener la transmisión? Saldrán del aire." : "¿Iniciar la transmisión en vivo?") }, t.activa ? "Detener" : "Iniciar")),
      el("div", { class: "salida" + (g.activa ? " activa grabando" : "") }, el("span", { class: "nombre" }, g.activa ? "● Grabando" : "Grabación"), R.vivos.g,
        el("button", { class: "btn btn-suave", type: "button",
          onclick: () => confirmar("grabacion", g.activa ? "detener" : "iniciar", g.activa ? "¿Detener la grabación?" : "¿Iniciar la grabación?") }, g.activa ? "Detener" : "Grabar")))];

  if (o.hayOverlayCuenta) {
    const c = o.config;
    if (o.cuenta) {
      R.vivos.cuenta = el("div", { class: "cuenta" });
      out.push(tarjeta("Cuenta regresiva", R.vivos.cuenta,
        el("p", { class: "tenue" }, o.cuenta.escenaFinal ? `Al terminar pasa a «${o.cuenta.escenaFinal}».` : "Al terminar se queda en la escena actual."),
        el("button", { class: "btn btn-suave ancho", type: "button", style: "margin-top:10px", onclick: () => hacer("/api/obs/cuenta", { accion: "cancelar" }, "Cuenta regresiva cancelada.") }, "Cancelar")));
    } else {
      out.push(tarjeta("Cuenta regresiva",
        el("p", { class: "tenue" }, c.escenaEspera || c.escenaFinal
          ? `Muestra «${c.escenaEspera || "la escena actual"}» con la cuenta de «Ya comenzamos» y al terminar pasa a «${c.escenaFinal || "la misma escena"}».`
          : "Las escenas de la cuenta regresiva se eligen en el PC («En vivo · OBS»)."),
        el("button", { class: "btn btn-primario ancho", type: "button", style: "margin-top:12px",
          onclick: () => hacer("/api/obs/cuenta", { escenaEspera: c.escenaEspera, escenaFinal: c.escenaFinal }, "Comenzó la cuenta regresiva.") }, "Iniciar cuenta regresiva")));
    }
  }

  out.push(tarjeta("Escenas", el("div", { class: "escenas" }, o.escenas.map(n => el("button", {
    type: "button", class: "escena" + (n === o.escena ? " al-aire" : ""),
    onclick: () => { if (n !== o.escena) hacer("/api/obs/escena", { nombre: n }); }
  }, el("span", {}, n), n === o.escena ? el("small", {}, "AL AIRE") : null)))));

  if (o.audio.length) {
    out.push(tarjeta("Audio", el("div", { class: "audios" }, o.audio.map(a => el("button", {
      type: "button", class: "audio" + (a.silenciado ? " silenciado" : ""),
      onclick: () => hacer("/api/obs/silenciar", { nombre: a.nombre, silenciado: !a.silenciado })
    }, el("span", {}, a.nombre), el("small", {}, a.silenciado ? "🔇 Silenciado" : "🎙 Activo"))))));
  }
  return out;
}

// ---------- Programa al aire ----------

function hora(iso) {
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function vistaPrograma(d) {
  const a = d.alAire, ahora = a.ahora;
  let estado = "Apagado: cada overlay usa sus textos", clase = "";
  if (a.fijo) { estado = `Puesto a mano hasta las ${hora(a.fijo.hasta)}`; clase = "ambar"; }
  else if (a.modo === "auto" && ahora && ahora.fuera) estado = "Fuera de programa";
  else if (a.modo === "auto" && ahora) { estado = "Según la programación"; clase = "rojo"; }
  const detalle = ahora ? (ahora.detalle != null ? ahora.detalle : `Al aire · ${ahora.dia} ${ahora.hora}`) : "";
  const auto = el("input", { type: "checkbox", checked: a.modo === "auto", onchange: e => hacer("/api/estudio/al-aire", { modo: e.target.checked ? "auto" : "apagado" }) });
  return [
    el("h1", { class: "titulo" }, "Programa al aire"),
    tarjeta(null,
      el("span", { class: "insignia " + clase }, estado),
      ahora ? el("div", { class: "rotulo" },
        el("span", { class: "detalle" }, detalle.toUpperCase()),
        el("span", { class: "nombre" }, ahora.nombre),
        ahora.presentador ? el("span", { class: "con" }, "Con " + ahora.presentador.replace(/^con\s+/i, "")) : null) : null,
      a.fijo ? el("button", { class: "btn btn-suave ancho", type: "button", onclick: () => hacer("/api/estudio/soltar", {}, "Listo.") }, a.modo === "auto" ? "Volver a la programación" : "Quitar") : null,
      el("label", { class: "interruptor", style: "margin-top:14px" }, el("span", {}, "Seguir la programación"), auto)),
    tarjeta("Poner al aire ahora", d.programas.length
      ? d.programas.map(p => el("div", { class: "programa" },
        el("div", {}, el("strong", {}, p.nombre), el("span", {}, p.horarios.join(" · "))),
        el("button", { class: "btn btn-suave", type: "button", onclick: () => hacer("/api/estudio/fijar", { nombre: p.nombre }, `«${p.nombre}» en los rótulos.`) }, "Al aire")))
      : el("p", { class: "tenue" }, "No hay programación en Horarios."))
  ];
}

// ---------- Versículo ----------

function vistaVersiculo(v) {
  if (v.error) return [el("h1", { class: "titulo" }, "Versículo"), tarjeta(null, el("p", { class: "tenue" }, v.error))];
  const cita = el("input", { type: "text", placeholder: "Juan 3:16 · Sal 23:1-3", autocomplete: "off", enterKeyHint: "send" });
  const version = el("select", { "aria-label": "Versión" }, v.versiones.map(x => el("option", { value: x.id, selected: x.id === v.version }, `${x.id} · ${x.nombre}`)));
  const mostrar = () => {
    if (!cita.value.trim()) { cita.focus(); return; }
    cita.blur();
    hacer("/api/versiculo", { cita: cita.value, version: version.value }).then(r => { if (r) toast(`${r.cita} en pantalla`); });
  };
  cita.addEventListener("keydown", e => { if (e.key === "Enter") mostrar(); });
  const paso = n => hacer("/api/versiculo", { paso: n, version: version.value }).then(r => { if (r) toast(`${r.cita} en pantalla`); });
  return [
    el("h1", { class: "titulo" }, "Versículo"),
    tarjeta("En el overlay", el("div", { class: "verso-actual" },
      el("strong", {}, `${v.cita} · ${v.version}`), el("p", {}, v.texto)),
      el("div", { class: "pasos" },
        el("button", { class: "btn btn-suave", type: "button", onclick: () => paso(-1) }, "‹ Anterior"),
        el("button", { class: "btn btn-primario", type: "button", onclick: () => paso(1) }, "Siguiente ›"))),
    tarjeta("Mostrar otro",
      el("label", { class: "etiqueta" }, "Cita"), cita,
      el("label", { class: "etiqueta" }, "Versión"), version,
      el("button", { class: "btn btn-primario ancho", type: "button", style: "margin-top:14px", onclick: mostrar }, "Mostrar en pantalla"),
      el("p", { class: "nota" }, "Se publica en OBS al tiro. Anterior y Siguiente avanzan tantos versículos como hay en pantalla."))
  ];
}

// ---------- Comentario ----------

const FUENTES = [["youtube", "YouTube"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["whatsapp", "WhatsApp"], ["", "Otro"]];

function vistaComentario(d) {
  const chips = el("div", { class: "chips" }, FUENTES.map(([id, n]) => el("button", {
    type: "button", "aria-pressed": String(R.fuente === id),
    onclick: e => { R.fuente = id; for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget)); }
  }, n)));
  const nombre = el("input", { type: "text", placeholder: "Nombre (opcional)", maxLength: 60 });
  const texto = el("textarea", { placeholder: "Escribe o pega el comentario…", maxLength: 400 });
  const mostrar = () => {
    if (!texto.value.trim()) { texto.focus(); return; }
    document.activeElement.blur();
    hacer("/api/comentarios/mostrar", { nombre: nombre.value, texto: texto.value, fuente: R.fuente }, "Comentario en pantalla.");
  };
  const actual = d.actual;
  const visible = actual && (!d.segundos || Date.now() - actual.desde < d.segundos * 1000);
  return [
    el("h1", { class: "titulo" }, "Comentario"),
    tarjeta(null,
      el("span", { class: "etiqueta", style: "margin-top:0" }, "Viene de"), chips,
      el("label", { class: "etiqueta" }, "Nombre"), nombre,
      el("label", { class: "etiqueta" }, "Comentario"), texto,
      el("button", { class: "btn btn-primario ancho", type: "button", style: "margin-top:14px", onclick: mostrar }, "Mostrar en pantalla"),
      visible ? el("button", { class: "btn btn-suave ancho", type: "button", style: "margin-top:8px", onclick: () => hacer("/api/comentarios/ocultar", {}, "Comentario oculto.") }, "Ocultar el que está en pantalla") : null),
    d.recientes.length ? tarjeta("Recientes (toca para repetir)", d.recientes.slice(0, 12).map(c => el("button", {
      type: "button", class: "com" + (actual && actual.id === c.id && visible ? " en-pantalla" : ""),
      onclick: () => hacer("/api/comentarios/mostrar", c, "Comentario en pantalla.")
    }, c.nombre ? el("strong", {}, c.nombre) : null, c.texto))) : null
  ];
}

// ---------- Anuncios ----------

function vistaAnuncios(d) {
  const an = d.anuncios;
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  const guardar = lista => hacer("/api/estudio/anuncios", { lista });
  return [
    el("h1", { class: "titulo" }, "Anuncios"),
    tarjeta(null, el("label", { class: "interruptor" }, el("span", {}, "Mostrar anuncios en la franja"),
      el("input", { type: "checkbox", checked: an.activo, onchange: e => hacer("/api/estudio/anuncios", { activo: e.target.checked }) }))),
    tarjeta("Lista", an.lista.length ? an.lista.map((a, i) => {
      const vencido = (a.hasta && a.hasta < fecha) || (a.desde && a.desde > fecha);
      return el("label", { class: "anuncio interruptor" + (vencido ? " vencido" : "") },
        el("span", {}, a.texto || "(vacío)", vencido ? el("small", { class: "tenue" }, a.hasta && a.hasta < fecha ? " · ya terminó" : " · todavía no empieza") : null),
        el("input", { type: "checkbox", checked: a.activo, onchange: e => guardar(an.lista.map((x, j) => j === i ? { ...x, activo: e.target.checked } : x)) }));
    }) : el("p", { class: "tenue" }, "No hay anuncios. Se agregan desde el PC.")),
    el("p", { class: "nota" }, "Para escribir anuncios nuevos o ponerles fecha, usa «Anuncios» en el PC.")
  ];
}

// ---------- Aviso de cambio de programa ----------

const AVISO = { datos: null, t: null, vibrado: null };

async function revisarAviso() {
  try { AVISO.datos = (await api("/api/estudio")).transicion; } catch { return; }
  pintarAviso();
}

function pintarAviso() {
  const caja = $("#avisoCambio");
  const t = AVISO.datos;
  clearInterval(AVISO.t);
  if (!t || (!t.pendiente && !t.mantenido)) { caja.hidden = true; return; }
  const responder = accion => {
    vibrar();
    postear("/api/estudio/transicion", { accion }).then(r => {
      AVISO.datos = r.transicion;
      pintarAviso();
      if (R.tab === "programa") pintar(r, true);
    }, err => toast(err.message, "error"));
  };
  if (t.pendiente) {
    const p = t.pendiente;
    const reloj = el("span", { class: "reloj" });
    const tic = () => { reloj.textContent = mmss(p.limite - Date.now()); };
    tic();
    AVISO.t = setInterval(tic, 1000);
    caja.replaceChildren(el("strong", {}, `${p.hora}: empieza «${p.nombre}»`),
      el("p", {}, `«${t.actual}» sigue en los rótulos. Cambian solos en `, reloj, "."),
      el("div", { class: "fila" },
        el("button", { class: "btn btn-primario", type: "button", onclick: () => responder("cambiar") }, "Cambiar ahora"),
        el("button", { class: "btn btn-suave", type: "button", onclick: () => responder("mantener") }, "Mantener")));
    if (AVISO.vibrado !== p.limite) { AVISO.vibrado = p.limite; try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {} }
  } else {
    caja.replaceChildren(el("strong", {}, `Se mantiene «${t.actual}»`),
      el("p", {}, `«${t.mantenido.nombre}» empezaba a las ${t.mantenido.hora}.`),
      el("button", { class: "btn btn-primario ancho", type: "button", onclick: () => responder("cambiar") }, `Cambiar a «${t.mantenido.nombre}»`));
  }
  caja.hidden = false;
}

// ---------- Inicio ----------

function escuchar() {
  if (R.es) return;
  const es = new EventSource("/api/eventos");
  R.es = es;
  es.onmessage = e => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.tipo === "obs" && R.tab === "vivo") recargar();
    if (d.tipo === "estudio" && (R.tab === "programa" || R.tab === "anuncios")) recargar();
    if (d.tipo === "estudio") revisarAviso();
    if (d.tipo === "comentario" && R.tab === "comentario") recargar();
    if (d.tipo === "cambio" && d.canal === "publicado" && R.tab === "versiculo" && R.datos && d.slug === R.datos.slug) recargar();
  };
  es.onerror = () => { es.close(); R.es = null; setTimeout(escuchar, 3000); };
}

async function iniciar() {
  pintarPestanas();
  await abrir(R.tab);
  revisarAviso();
  escuchar();
  clearInterval(R.tPoll);
  // OBS: los relojes se actualizan cada segundo mientras se ve «En vivo»
  R.tPoll = setInterval(() => { if (R.tab === "vivo" && !document.hidden) recargar(); }, 1000);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && R.datos) recargar(); });

fetch("/api/remoto/sesion", { cache: "no-store" }).then(r => r.json()).then(d => { if (d.ok) iniciar(); else pantallaPin(); }, () => pantallaPin());
