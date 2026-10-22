// Servidor local: muestra el editor y entrega los overlays a OBS con los textos elegidos.
// Se puede usar solo (node server.js "C:\ruta\a\overlays") o desde la app de escritorio (main.js).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { parseOverlay, renderOverlay } = require("./overlay-parser");
const { capitulo, interpretarCita, listaVersiones, listaLibros, VERSION_PREDETERMINADA } = require("./biblia");
const ytmusic = require("./ytmusic");
const spotify = require("./spotify");
const estudio = require("./estudio");
const obs = require("./obs");
const sincronizacion = require("./sincronizacion");

// De las dos fuentes se muestra la que está sonando; si las dos suenan (o las dos están en pausa), YouTube Music.
function cancionActual(yt, sp) {
  const fuentes = [
    yt.conexion === "ok" && yt.cancion ? { ...yt.cancion, fuente: "YouTube Music" } : null,
    sp.conexion === "ok" && sp.cancion ? { ...sp.cancion, fuente: "Spotify" } : null
  ].filter(Boolean);
  return fuentes.find(c => !c.pausado) || fuentes[0] || null;
}

async function estadoMusica(opciones) {
  const yt = await ytmusic.obtener(opciones), sp = spotify.obtener();
  return {
    actual: cancionActual(yt, sp),
    youtube: { conexion: yt.conexion, cancion: yt.cancion, detalle: yt.detalle || null, puerto: ytmusic.getPuerto() },
    spotify: { conexion: sp.conexion, cancion: sp.cancion, detalle: sp.detalle || null }
  };
}

const PUERTO = 7878;
const PUERTO_REMOTO = 7879; // el control remoto (celulares en el mismo Wi-Fi) entra por aquí, siempre con PIN
const ARCHIVO_VALORES = "overlay-valores.json";
const UI_DIR = path.join(__dirname, "ui");
const VENDOR_DIR = path.join(__dirname, "vendor");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon"
};

// React y Babel van incluidos en la app, así los overlays funcionan aunque falle internet.
const RECURSOS_LOCALES = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "/vendor/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "/vendor/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "/vendor/babel.min.js"
};

// Fuentes de Google: se guardan en el equipo para que los overlays se vean igual sin internet.
// Primero se buscan las incluidas en la app (vendor/fuentes); las nuevas se descargan una vez
// y quedan en la carpeta de overlays (_fuentes), así viajan con ella a otro PC.
const FUENTES_APP = path.join(__dirname, "vendor", "fuentes");
const RE_GOOGLE_FONTS = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+/g;
const AGENTE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function claveFuente(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function localizarFuentes(texto) {
  return texto.replace(RE_GOOGLE_FONTS, u => "/fuentes/css?u=" + encodeURIComponent(u.replace(/&amp;/g, "&")));
}

function dirFuentesCarpeta() {
  return carpeta ? path.join(carpeta, "_fuentes") : null;
}

// Descarga el CSS de Google Fonts y sus archivos de letra a `dir`, apuntando el CSS a /fuentes/archivo/.
async function descargarFuente(url, dir) {
  const r = await fetch(url, { headers: { "User-Agent": AGENTE } });
  if (!r.ok) throw new Error(`Google Fonts respondió ${r.status}`);
  let css = await r.text();
  fs.mkdirSync(dir, { recursive: true });
  const archivos = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])];
  for (const a of archivos) {
    const nombre = claveFuente(a) + (path.extname(new URL(a).pathname) || ".woff2");
    const destino = path.join(dir, nombre);
    if (!fs.existsSync(destino)) {
      const f = await fetch(a, { headers: { "User-Agent": AGENTE } });
      if (!f.ok) throw new Error(`No se pudo descargar ${a}`);
      fs.writeFileSync(destino, Buffer.from(await f.arrayBuffer()));
    }
    css = css.split(a).join("/fuentes/archivo/" + nombre);
  }
  fs.writeFileSync(path.join(dir, claveFuente(url) + ".css"), css, "utf8");
  return css;
}

async function cssFuente(url) {
  const nombre = claveFuente(url) + ".css";
  for (const dir of [FUENTES_APP, dirFuentesCarpeta()]) {
    if (dir && fs.existsSync(path.join(dir, nombre))) return fs.readFileSync(path.join(dir, nombre), "utf8");
  }
  if (!dirFuentesCarpeta()) return null;
  try { return await descargarFuente(url, dirFuentesCarpeta()); } catch { return null; }
}

let carpeta = null;
let valores = {};
const clientesSSE = new Set();

// Overlays exportados como página autónoma ("bundle", .html): la plantilla y sus archivos vienen
// empaquetados dentro del mismo archivo. Se desempaquetan para tratarlos igual que un .dc.html.
const cachePaquetes = new Map();

function leerPaquete(ruta) {
  const mtime = fs.statSync(ruta).mtimeMs;
  const c = cachePaquetes.get(ruta);
  if (c && c.mtime === mtime) return c.paquete;
  const crudo = fs.readFileSync(ruta, "utf8");
  const bloque = tipo => {
    const m = new RegExp(`<script type="__bundler/${tipo}">([\\s\\S]*?)</script>`).exec(crudo);
    return m ? JSON.parse(m[1]) : null;
  };
  let paquete = null;
  try {
    const plantilla = bloque("template"), manifiesto = bloque("manifest");
    if (typeof plantilla === "string" && manifiesto) paquete = { plantilla, manifiesto, externos: bloque("ext_resources") || [] };
  } catch {}
  cachePaquetes.set(ruta, { mtime, paquete });
  return paquete;
}

function urlRecursoPaquete(slug, uuid) {
  return `/paquete/${slug}/${uuid}`;
}

// Apunta los archivos empaquetados (fuentes, imágenes, support.js...) a /paquete/<slug>/<uuid>.
function desempaquetar(html, o) {
  for (const uuid of Object.keys(o.paquete.manifiesto)) html = html.split(uuid).join(urlRecursoPaquete(o.slug, uuid));
  return html.replace(/\s+integrity="[^"]*"/gi, "").replace(/\s+crossorigin="[^"]*"/gi, "");
}

function slugDe(archivo) {
  return archivo.replace(/(\.dc)?\.html$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nombreDe(archivo) {
  const base = archivo.replace(/(\.dc)?\.html$/i, "");
  return base.replace(/^overlays?\s+obs\s*/i, "").trim() || "Principal";
}

function esPantalla16x9(size) {
  const w = parseInt(size && size.width, 10), h = parseInt(size && size.height, 10);
  return w > 0 && h > 0 && Math.abs(w / h - 16 / 9) < 0.02;
}

function listarOverlays() {
  if (!carpeta || !fs.existsSync(carpeta)) return [];
  const lista = [];
  const archivos = fs.readdirSync(carpeta).sort((a, b) => a.localeCompare(b, "es"));
  const nombresDc = new Set(archivos.filter(a => /\.dc\.html$/i.test(a)).map(a => a.toLowerCase()));
  for (const archivo of archivos) {
    let html, paquete = null;
    if (/\.dc\.html$/i.test(archivo)) {
      html = fs.readFileSync(path.join(carpeta, archivo), "utf8");
    } else if (/\.html$/i.test(archivo)) {
      // Si el mismo diseño también está como .dc.html, manda el .dc.html
      if (nombresDc.has(archivo.toLowerCase().replace(/\.html$/, ".dc.html"))) continue;
      paquete = leerPaquete(path.join(carpeta, archivo));
      if (!paquete) continue;
      html = paquete.plantilla;
    } else continue;
    const parsed = parseOverlay(html);
    if (!parsed) continue; // páginas sin opciones (ej: la colección) no son overlays
    if (!esPantalla16x9(parsed.size)) continue; // diseños web, móviles o posts verticales no van a OBS
    lista.push({ slug: slugDe(archivo), archivo, nombre: nombreDe(archivo), html, parsed, paquete });
  }
  return lista;
}

function buscarOverlay(slug) {
  return listarOverlays().find(o => o.slug === slug) || null;
}

function cargarValores() {
  valores = {};
  if (!carpeta) return;
  try { valores = JSON.parse(fs.readFileSync(path.join(carpeta, ARCHIVO_VALORES), "utf8")) || {}; } catch {}
}

function guardarValores() {
  fs.writeFileSync(path.join(carpeta, ARCHIVO_VALORES), JSON.stringify(valores, null, 2), "utf8");
}

function vacio() { return { props: {}, textos: {} }; }

function entradaDe(slug) {
  const e = valores[slug] || (valores[slug] = {});
  if (!e.publicado) e.publicado = vacio();
  if (!e.borrador) e.borrador = JSON.parse(JSON.stringify(e.publicado));
  return e;
}

// Compara solo valores que difieren del diseño original, para que "sin cambios" sea exacto.
function normalizar(v, parsed) {
  const out = { props: {}, textos: {} };
  for (const p of parsed.props) {
    if (v.props && p.key in v.props && v.props[p.key] !== p.default) out.props[p.key] = v.props[p.key];
  }
  for (const f of [...parsed.texts, ...parsed.lists]) {
    const t = v.textos && v.textos[f.id];
    if (t && t.o === f.orig && t.v !== f.orig) out.textos[f.id] = t.v;
  }
  return JSON.stringify(out);
}

function hayPendientes(o) {
  const e = valores[o.slug];
  if (!e || !e.borrador) return false;
  return normalizar(e.borrador, o.parsed) !== normalizar(e.publicado || vacio(), o.parsed);
}

function emitir(evento) {
  const data = `data: ${JSON.stringify(evento)}\n\n`;
  for (const res of clientesSSE) res.write(data);
}

function scriptRecursos(o) {
  // Las librerías que trae el paquete se usan solo si la app no tiene su propia copia
  const extra = {};
  if (o.paquete) for (const r of o.paquete.externos) extra[r.id] = urlRecursoPaquete(o.slug, r.uuid);
  return `<script>window.__resources=Object.assign(window.__resources||{},${JSON.stringify(extra)},${JSON.stringify(RECURSOS_LOCALES)});</script>`;
}

// La programación semanal sale del overlay que tenga la lista `const RADIO = [...]` (Horarios),
// con los textos que el usuario haya puesto, y se entrega a todos los overlays en window.__programacion.
const RE_RADIO = /const RADIO = (\[[\s\S]*?\n\]);/;

function tieneProgramacion(o) {
  return RE_RADIO.test(o.html);
}

function programacion(canal) {
  const o = listarOverlays().find(tieneProgramacion);
  if (!o) return null;
  const e = entradaDe(o.slug);
  const m = RE_RADIO.exec(renderOverlay(o.html, o.parsed, canal === "borrador" ? e.borrador : e.publicado));
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

function scriptProgramacion(canal) {
  const datos = programacion(canal);
  return datos ? `<script>window.__programacion=${JSON.stringify(datos).replace(/</g, "\\u003c")};</script>` : "";
}

// ---------- Cambios suaves ----------
// El enlace de OBS (/o/<slug>) entrega una página "marco" con el overlay dentro de un iframe (una "capa").
// Cuando se publica un cambio, la versión nueva se carga escondida en otra capa y, cuando ya se dibujó,
// se funde encima de la anterior. Así OBS nunca muestra el overlay vacío ni un parpadeo.
const FUNDIDO_MS = 500;

function servirMarco(res, o, canal, url) {
  const usaProgramacion = o.html.includes("__programacion");
  // La capa recibe los mismos parámetros del enlace (ej: ?modo=Pantalla completa) más capa=1
  const q = new URLSearchParams(url.searchParams);
  q.delete("v"); q.delete("sinEntrada");
  q.set("capa", "1");
  const base = `/o/${o.slug}?${q.toString()}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${o.nombre}</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
iframe.oculta{opacity:0}
</style></head><body>
<script>(function(){
var S=${JSON.stringify(o.slug)},C=${JSON.stringify(canal)},P=${usaProgramacion},BASE=${JSON.stringify(base)},n=0,actual=null,pendiente=null;
function nueva(sinEntrada){
  var f=document.createElement("iframe");
  f.setAttribute("allowtransparency","true");
  f.setAttribute("scrolling","no");
  f.src=BASE+"&v="+(++n)+(sinEntrada?"&sinEntrada=1":"");
  return f;
}
// La capa anterior se quita recién cuando la nueva terminó de aparecer (si el equipo va lento, el fundido
// puede empezar tarde y no debe quedar un instante sin overlay)
function quitarViejas(){
  document.querySelectorAll("iframe").forEach(function(x){if(x!==actual&&x!==pendiente)x.remove()});
}
function mostrar(f){
  if(f!==pendiente)return;
  pendiente=null;clearTimeout(f._espera);
  actual=f;
  f.classList.remove("oculta");
  var a=f.animate([{opacity:0},{opacity:1}],{duration:${FUNDIDO_MS},easing:"ease"});
  a.onfinish=quitarViejas;
  setTimeout(quitarViejas,${FUNDIDO_MS + 3000});
}
// Si la capa nueva no avisa que está lista (ej: un error en el diseño), se muestra igual a los 5 s
function cambiar(){
  if(pendiente)pendiente.remove();
  var f=nueva(true);f.className="oculta";
  pendiente=f;f._espera=setTimeout(function(){mostrar(f)},5000);
  document.body.appendChild(f);
}
window.addEventListener("message",function(e){
  if(!e.data||!e.data.capaLista||!pendiente||pendiente.contentWindow!==e.source)return;
  mostrar(pendiente);
});
// La primera vez el overlay aparece con su propia animación de entrada, sin fundido
actual=nueva(false);document.body.appendChild(actual);
function conectar(){
  var es=new EventSource("/api/eventos");
  es.onmessage=function(e){var d;try{d=JSON.parse(e.data)}catch(x){return}
    if(d.canal!==C)return;
    if((d.tipo==="cambio"&&d.slug===S)||(d.tipo==="programacion"&&P))cambiar();};
  es.onerror=function(){es.close();setTimeout(conectar,3000)};
}
conectar();
})();</script>
</body></html>`;
  res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html);
}

// Va al principio de cada capa. Los diseños preguntan por window.obsstudio para esconder el fondo de
// vista previa; OBS lo define en la página principal, así que se copia desde el marco.
// Con sinEntrada, las animaciones de entrada (las que no se repiten) aparecen ya terminadas: al cambiar
// un texto solo se ve el fundido. Las animaciones continuas (nubes, franjas, pulsos) siguen normales.
function scriptCapaInicio(sinEntrada) {
  return `<script>(function(){
try{if(!window.obsstudio&&window.parent!==window&&window.parent.obsstudio)window.obsstudio=window.parent.obsstudio}catch(e){}
if(!${sinEntrada})return;
var activo=true;
function terminar(lista){lista.forEach(function(a){try{var t=a.effect&&a.effect.getTiming();if(t&&t.iterations!==Infinity)a.finish()}catch(e){}})}
window.addEventListener("animationstart",function(e){if(activo&&e.target.getAnimations)terminar(e.target.getAnimations())},true);
window.__terminarEntradas=function(){if(document.getAnimations)terminar(document.getAnimations());setTimeout(function(){activo=false},1500)};
})();</script>`;
}

// Va al final de cada capa: avisa al marco cuando el diseño ya se dibujó (la página dejó de cambiar
// y las fuentes cargaron), para que el fundido no muestre nada a medio armar.
function scriptCapaLista() {
  return `<script>(function(){
var avisado=false,t=null,obs=null;
function avisar(){
  if(avisado)return;avisado=true;
  if(obs)obs.disconnect();
  if(window.__terminarEntradas)window.__terminarEntradas();
  requestAnimationFrame(function(){requestAnimationFrame(function(){window.parent.postMessage({capaLista:true},"*")})});
}
function listo(){(document.fonts?document.fonts.ready:Promise.resolve()).then(avisar,avisar)}
window.addEventListener("load",function(){
  obs=new MutationObserver(function(){clearTimeout(t);t=setTimeout(listo,250)});
  obs.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  t=setTimeout(listo,250);
  setTimeout(listo,3000);
});
})();</script>`;
}

function servirOverlay(res, o, canal, url) {
  if (url.searchParams.get("capa") !== "1") return servirMarco(res, o, canal, url);
  const e = entradaDe(o.slug);
  const v = estudio.aplicar(o.parsed, programacion(canal), canal === "borrador" ? e.borrador : e.publicado);
  let html = localizarFuentes(renderOverlay(o.html, o.parsed, v));
  if (o.paquete) html = desempaquetar(html, o);
  // Los relojes de los diseños se revisan cada 10 s; cada 1 s cambian de minuto justo con el reloj del PC.
  html = html.replace(/(setState\(\{\s*now:\s*new Date\(\)\s*\}\)\s*,\s*)\d{4,}(\s*\))/g, "$11000$2");
  const usaProgramacion = o.html.includes("__programacion");
  const sinEntrada = url.searchParams.get("sinEntrada") === "1";
  html = html.replace(/<head>/i, m => m + scriptCapaInicio(sinEntrada) + scriptRecursos(o) + (usaProgramacion ? scriptProgramacion(canal) : ""));
  html = html.replace(/<\/body>/i, m => scriptCapaLista() + m);
  res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html);
}

function servirArchivo(res, base, relativo, respaldo) {
  let archivo = path.normalize(path.join(base, relativo));
  if (!archivo.startsWith(path.normalize(base + path.sep))) return enviar(res, 403, "Prohibido");
  if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
    if (!respaldo || !fs.existsSync(respaldo)) return enviar(res, 404, "No encontrado");
    archivo = respaldo;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(archivo).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(archivo).pipe(res);
}

function enviar(res, codigo, cuerpo) {
  const json = typeof cuerpo !== "string";
  res.writeHead(codigo, { "Content-Type": json ? MIME[".json"] : "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json ? JSON.stringify(cuerpo) : cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let largo = 0;
    req.on("data", c => { partes.push(c); largo += c.length; if (largo > 5e6) req.destroy(); });
    req.on("end", () => {
      // Se decodifica todo junto: una letra con tilde puede quedar partida entre dos trozos
      const datos = Buffer.concat(partes).toString("utf8");
      try { resolve(datos ? JSON.parse(datos) : {}); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function urlOverlay(slug, extra) {
  return `http://127.0.0.1:${PUERTO}/o/${slug}${extra || ""}`;
}

function resumen(o) {
  const escenas = [];
  for (const p of o.parsed.props) {
    if (p.urlParam && p.editor === "enum" && p.options) {
      for (const op of p.options) escenas.push({ nombre: op, url: urlOverlay(o.slug, `?${p.key}=${encodeURIComponent(op)}`) });
    }
  }
  return { slug: o.slug, nombre: o.nombre, archivo: o.archivo, url: urlOverlay(o.slug), escenas, pendiente: hayPendientes(o) };
}

// ---------- Herramientas de transmisión (estudio.js y obs.js) ----------

const CADA_REVISION_MS = 15000;
const firmas = new Map(); // slug|canal → lo último que se aplicó de «Programa al aire» y «Anuncios»

// Cada 15 s (y cuando cambia algo) se revisa si cambió el programa al aire o los anuncios vigentes.
// Los overlays afectados se actualizan con el mismo fundido suave de siempre.
// Con soloSlug se anota en silencio lo que ya tiene ese overlay (porque se acaba de guardar o publicar).
let tTransicion = null;

function revisarEstudio(silencioso, soloSlug) {
  if (!carpeta) return;
  let cambio = false;
  if (!soloSlug) {
    // ¿Llegó la hora del siguiente programa? Se pide confirmar el cambio (ver estudio.js)
    if (estudio.actualizarTransicion(programacion("publicado"))) cambio = true;
    const pend = estudio.estadoTransicion().pendiente;
    clearTimeout(tTransicion);
    // Si nadie responde, el cambio se hace justo al cumplirse la espera
    if (pend) tTransicion = setTimeout(() => revisarEstudio(), Math.max(0, pend.limite - Date.now()) + 300);
  }
  const prog = { publicado: programacion("publicado"), borrador: programacion("borrador") };
  for (const o of listarOverlays()) {
    if (soloSlug && o.slug !== soloSlug) continue;
    const e = entradaDe(o.slug);
    for (const canal of ["publicado", "borrador"]) {
      const firma = JSON.stringify(estudio.controlados(o.parsed, prog[canal], canal === "borrador" ? e.borrador : e.publicado));
      const clave = o.slug + "|" + canal;
      if (firmas.has(clave) && firmas.get(clave) !== firma && !silencioso) {
        emitir({ tipo: "cambio", slug: o.slug, canal, origen: "estudio" });
        cambio = true;
      }
      firmas.set(clave, firma);
    }
  }
  if (cambio) emitir({ tipo: "estudio" });
}

function overlayTicker() {
  return listarOverlays().find(x => x.parsed.props.some(p => p.key === "textoTicker")) || null;
}

// La primera vez, los anuncios se arman con el texto que ya tenía la franja inferior
function sembrarAnuncios() {
  const o = overlayTicker();
  if (!o) return;
  const p = o.parsed.props.find(x => x.key === "textoTicker");
  const pub = entradaDe(o.slug).publicado.props;
  estudio.sembrarAnuncios("textoTicker" in pub ? pub.textoTicker : p.default);
}

function datosEstudio() {
  const d = estudio.get();
  const prog = programacion("publicado");
  const horarios = listarOverlays().find(tieneProgramacion);
  const ticker = overlayTicker();
  return {
    alAire: {
      modo: d.alAire.modo, anticipacion: d.alAire.anticipacion, fuera: d.alAire.fuera,
      fijo: d.alAire.fijo && Date.parse(d.alAire.fijo.hasta) > Date.now() ? d.alAire.fijo : null,
      ahora: estudio.alAire(prog)
    },
    transicion: estudio.estadoTransicion(),
    hayProgramacion: !!prog,
    overlayHorarios: horarios ? horarios.slug : null,
    programas: estudio.catalogo(prog),
    anuncios: { activo: d.anuncios.activo, lista: d.anuncios.lista || [], vigentes: estudio.anunciosVigentes() || [] },
    overlayTicker: ticker ? ticker.slug : null
  };
}

function cambioEstudio() {
  estudio.guardar();
  revisarEstudio();
  emitir({ tipo: "estudio" });
}

// ---------- Cuenta regresiva + OBS ----------
// «Iniciar cuenta regresiva»: OBS pasa a la escena de espera, el overlay «Ya comenzamos» vuelve a contar desde
// el principio y, cuando llega a cero, OBS cambia solo a la escena del programa.
let cuenta = null; // { fin, escenaFinal, slug, minutos }
let tCuenta = null;

function overlayCuenta() {
  return listarOverlays().find(o => o.parsed.props.some(p => p.key === "minutosCuentaRegresiva")) || null;
}

async function iniciarCuenta({ escenaEspera, escenaFinal }) {
  const o = overlayCuenta();
  if (!o) throw new Error("No encontré el overlay con cuenta regresiva (Ya comenzamos).");
  const p = o.parsed.props.find(x => x.key === "minutosCuentaRegresiva");
  const pub = entradaDe(o.slug).publicado.props;
  const minutos = +("minutosCuentaRegresiva" in pub ? pub.minutosCuentaRegresiva : p.default) || 5;
  const cfg = estudio.get().obs;
  cfg.escenaEspera = escenaEspera || "";
  cfg.escenaFinal = escenaFinal || "";
  estudio.guardar();
  if (escenaEspera) await obs.cambiarEscena(escenaEspera);
  clearTimeout(tCuenta);
  cuenta = { fin: Date.now() + minutos * 60000, escenaFinal: escenaFinal || null, slug: o.slug, minutos };
  // Recargar el overlay hace que su cuenta parta de nuevo, al mismo tiempo que la de aquí
  emitir({ tipo: "cambio", slug: o.slug, canal: "publicado", origen: "estudio" });
  emitir({ tipo: "cambio", slug: o.slug, canal: "borrador", origen: "estudio" });
  tCuenta = setTimeout(terminarCuenta, minutos * 60000);
  emitir({ tipo: "obs" });
}

async function terminarCuenta() {
  const c = cuenta;
  cuenta = null;
  tCuenta = null;
  if (c && c.escenaFinal) {
    try { await obs.cambiarEscena(c.escenaFinal); } catch (err) { console.error("Cuenta regresiva:", err.message); }
  }
  emitir({ tipo: "obs" });
}

function cancelarCuenta() {
  clearTimeout(tCuenta);
  tCuenta = null;
  cuenta = null;
  emitir({ tipo: "obs" });
}

function datosObs() {
  const c = estudio.get().obs;
  return {
    ...obs.obtener(),
    config: { activo: c.activo, host: c.host, puerto: c.puerto, tieneClave: !!c.clave, escenaEspera: c.escenaEspera, escenaFinal: c.escenaFinal },
    cuenta: cuenta ? { fin: cuenta.fin, quedan: Math.max(0, cuenta.fin - Date.now()), escenaFinal: cuenta.escenaFinal, minutos: cuenta.minutos } : null,
    hayOverlayCuenta: !!overlayCuenta()
  };
}

// Solo se avisa a las pantallas cuando cambia algo importante (no con cada segundo del contador)
let firmaObs = "";
obs.alCambiar(e => {
  const f = JSON.stringify([e.conexion, e.detalle, e.escena, e.escenas, e.audio, e.transmision.activa, e.grabacion.activa]);
  if (f !== firmaObs) { firmaObs = f; emitir({ tipo: "obs" }); }
});

// ---------- Versículo desde el control remoto ----------

function overlayVersiculo() {
  return listarOverlays().find(o => {
    const k = new Set(o.parsed.props.map(p => p.key));
    return k.has("texto") && k.has("cita");
  }) || null;
}

// Pone el versículo en el overlay y lo publica de inmediato (sin tocar otros cambios pendientes del overlay)
async function mostrarVersiculo({ cita, version, paso }) {
  const o = overlayVersiculo();
  if (!o) throw new Error("No encontré el overlay de Versículos.");
  const e = entradaDe(o.slug);
  const prop = k => o.parsed.props.find(p => p.key === k);
  const actual = k => (k in e.publicado.props ? e.publicado.props[k] : (prop(k) || {}).default);
  let ver = String(version || actual("version") || VERSION_PREDETERMINADA).toUpperCase();
  if (!listaVersiones().some(v => v.id === ver)) ver = VERSION_PREDETERMINADA;
  const libros = listaLibros();

  let libro, cap, desde, hasta, versos;
  if (paso) {
    // Siguiente / anterior: un bloque del mismo tamaño que el que está en pantalla
    const c = interpretarCita(String(actual("cita") || ""));
    if (!c.desde) throw new Error("El overlay no tiene un versículo para seguir.");
    const n = c.hasta - c.desde + 1;
    libro = c.libro; cap = c.capitulo;
    versos = await capitulo(ver, libro, cap);
    const ultimo = versos.length ? versos[versos.length - 1].v : 0;
    if (paso > 0) {
      desde = c.hasta + 1;
      if (desde > ultimo) {
        if (cap < libros[libro].capitulos) cap++;
        else if (libro < libros.length - 1) { libro++; cap = 1; }
        else throw new Error("Es el final de la Biblia.");
        versos = await capitulo(ver, libro, cap);
        desde = 1;
      }
      hasta = desde + n - 1;
    } else {
      hasta = c.desde - 1;
      if (hasta < 1) {
        if (cap > 1) cap--;
        else if (libro > 0) { libro--; cap = libros[libro].capitulos; }
        else throw new Error("Es el comienzo de la Biblia.");
        versos = await capitulo(ver, libro, cap);
        hasta = versos.length ? versos[versos.length - 1].v : 1;
      }
      desde = Math.max(1, hasta - n + 1);
    }
  } else {
    const c = interpretarCita(String(cita || ""));
    if (!c.desde) throw new Error(`Escribe también el versículo, por ejemplo «${c.nombre} ${c.capitulo}:1».`);
    libro = c.libro; cap = c.capitulo; desde = c.desde; hasta = c.hasta;
    versos = await capitulo(ver, libro, cap);
  }
  const ultimo = versos.length ? versos[versos.length - 1].v : 0;
  if (desde > ultimo) throw new Error(`${libros[libro].nombre} ${cap} llega hasta el versículo ${ultimo}.`);
  hasta = Math.min(hasta, ultimo);
  const texto = versos.filter(x => x.v >= desde && x.v <= hasta).map(x => x.t).join(" ");
  const citaFinal = `${libros[libro].nombre} ${cap}:${desde}${hasta > desde ? "-" + hasta : ""}`;
  for (const [k, valor] of [["texto", texto], ["cita", citaFinal], ["version", ver]]) {
    const p = prop(k);
    if (!p) continue;
    for (const v of [e.borrador, e.publicado]) {
      if (valor === p.default) delete v.props[k]; else v.props[k] = valor;
    }
  }
  guardarValores();
  emitir({ tipo: "cambio", slug: o.slug, canal: "borrador", origen: "remoto" });
  emitir({ tipo: "cambio", slug: o.slug, canal: "publicado", origen: "remoto" });
  return datosVersiculo();
}

function datosVersiculo() {
  const o = overlayVersiculo();
  if (!o) return { error: "No hay overlay de Versículos" };
  const e = entradaDe(o.slug);
  const val = k => { const p = o.parsed.props.find(x => x.key === k); return k in e.publicado.props ? e.publicado.props[k] : p && p.default; };
  return { slug: o.slug, cita: val("cita"), texto: val("texto"), version: val("version") || VERSION_PREDETERMINADA, versiones: listaVersiones() };
}

// ---------- Overlay de comentarios (propio de la app, no viene de Claude Design) ----------

const RUTA_COMENTARIOS = path.join(UI_DIR, "overlay-comentarios.html");

function datosComentarios() {
  const c = estudio.get().comentarios;
  return { actual: c.actual, recientes: c.recientes, posicion: c.posicion, segundos: c.segundos, url: urlOverlay("comentarios") };
}

// ---------- Control remoto por Wi-Fi ----------
// Un segundo servidor (puerto 7879) escucha en la red local solo mientras el control remoto está encendido.
// Todo lo que entra por ahí necesita el PIN (después queda una cookie de sesión en el celular).
// OBS y la ventana del editor siguen usando 127.0.0.1:7878, que no es visible desde la red.
let servidorRemoto = null;
let errorRemoto = null;
const intentos = new Map(); // ip → { fallos, hasta }

function cookies(req) {
  const out = {};
  for (const parte of String(req.headers.cookie || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function sesionRemota(req) {
  return estudio.sesionValida(cookies(req).rb_remoto);
}

async function actualizarRemoto() {
  const r = estudio.get().remoto;
  const debe = !!(r.activo && r.pin);
  if (debe && !servidorRemoto) {
    const s = http.createServer(manejador(manejarRemoto));
    await new Promise(resolve => {
      s.once("error", err => {
        errorRemoto = err.code === "EADDRINUSE" ? `El puerto ${PUERTO_REMOTO} está ocupado por otro programa.` : err.message;
        resolve();
      });
      s.listen(PUERTO_REMOTO, "0.0.0.0", () => { servidorRemoto = s; errorRemoto = null; resolve(); });
    });
  } else if (!debe && servidorRemoto) {
    const s = servidorRemoto;
    servidorRemoto = null;
    s.close();
    if (s.closeAllConnections) s.closeAllConnections();
  }
  if (!debe) errorRemoto = null;
}

async function datosRemoto() {
  const r = estudio.get().remoto;
  const red = await estudio.infoRed();
  return {
    activo: !!r.activo, pin: r.pin, escuchando: !!servidorRemoto, error: errorRemoto, puerto: PUERTO_REMOTO,
    direcciones: estudio.direcciones().map(d => ({ ...d, url: `http://${d.ip}:${PUERTO_REMOTO}/remoto` })),
    wifi: red.wifi, categoria: red.categoria, sesiones: (r.sesiones || []).length
  };
}

// Lo que solo se puede cambiar desde el PC (no desde un celular, aunque tenga sesión)
const SOLO_PC = /^\/api\/(remoto\/config|obs\/config|sincronizacion\/.+)$/;
const PUBLICAS_REMOTO = new Set(["/remoto", "/ui/remoto.css", "/ui/remoto.js", "/api/remoto/entrar", "/api/remoto/sesion"]);

async function manejarRemoto(req, res) {
  req.remoto = true;
  const url = new URL(req.url, "http://remoto");
  const ruta = decodeURIComponent(url.pathname);
  if (ruta === "/") { res.writeHead(302, { Location: "/remoto" }); return res.end(); }
  if (!PUBLICAS_REMOTO.has(ruta) && !sesionRemota(req)) {
    if (ruta.startsWith("/api/")) return enviar(res, 401, { error: "Escribe el PIN para entrar" });
    res.writeHead(302, { Location: "/remoto" });
    return res.end();
  }
  if (SOLO_PC.test(ruta) && req.method === "POST") return enviar(res, 403, { error: "Esto solo se puede cambiar desde el PC" });
  return manejar(req, res);
}

async function manejarEstudio(req, res, ruta) {
  const post = req.method === "POST";
  const cuerpo = post ? await leerCuerpo(req) : null;
  const d = estudio.get();

  // Programa al aire
  if (ruta === "/api/estudio" && !post) return enviar(res, 200, datosEstudio());
  if (ruta === "/api/estudio/al-aire" && post) {
    if (["auto", "apagado"].includes(cuerpo.modo)) d.alAire.modo = cuerpo.modo;
    if (cuerpo.anticipacion != null) d.alAire.anticipacion = Math.max(0, Math.min(60, parseInt(cuerpo.anticipacion, 10) || 0));
    if (cuerpo.fuera) for (const k of ["nombre", "detalle", "presentador"]) if (typeof cuerpo.fuera[k] === "string") d.alAire.fuera[k] = cuerpo.fuera[k];
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }
  if (ruta === "/api/estudio/programa" && post) {
    const nombre = String(cuerpo.nombre || "").trim();
    if (!nombre) return enviar(res, 400, { error: "Falta el nombre del programa" });
    const p = d.programas[nombre] || (d.programas[nombre] = {});
    if (typeof cuerpo.presentador === "string") p.presentador = cuerpo.presentador.trim();
    if (cuerpo.duracion !== undefined) {
      // Vacío = sin duración fija (se muestra hasta 4 horas o hasta el siguiente programa)
      const n = parseInt(cuerpo.duracion, 10);
      if (n > 0) p.duracion = Math.max(5, Math.min(600, n)); else delete p.duracion;
    }
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }
  if (ruta === "/api/estudio/fijar" && post) {
    const nombre = String(cuerpo.nombre || "").trim();
    if (!nombre) return enviar(res, 400, { error: "Escribe el nombre del programa" });
    const minutos = Math.max(5, Math.min(720, parseInt(cuerpo.minutos, 10) || estudio.infoPrograma(nombre).duracion));
    const ahora = Date.now();
    d.alAire.fijo = {
      nombre, presentador: typeof cuerpo.presentador === "string" ? cuerpo.presentador.trim() : null,
      desde: new Date(ahora).toISOString(), hasta: new Date(ahora + minutos * 60000).toISOString()
    };
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }
  if (ruta === "/api/estudio/transicion" && post) {
    estudio.responderTransicion(cuerpo.accion);
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }
  if (ruta === "/api/estudio/soltar" && post) {
    d.alAire.fijo = null;
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }

  // Anuncios
  if (ruta === "/api/estudio/anuncios" && post) {
    if (typeof cuerpo.activo === "boolean") d.anuncios.activo = cuerpo.activo;
    if (Array.isArray(cuerpo.lista)) {
      const fecha = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
      d.anuncios.lista = cuerpo.lista.slice(0, 50).map(a => ({
        id: /^[0-9a-f]{10}$/.test(a.id || "") ? a.id : estudio.nuevoId(),
        texto: String(a.texto || "").replace(/\s+/g, " ").slice(0, 300),
        activo: a.activo !== false, desde: fecha(a.desde), hasta: fecha(a.hasta)
      }));
    }
    cambioEstudio();
    return enviar(res, 200, datosEstudio());
  }

  // Comentarios
  if (ruta === "/api/comentarios" && !post) return enviar(res, 200, datosComentarios());
  if (ruta === "/api/comentarios/mostrar" && post) {
    const c = estudio.mostrarComentario(cuerpo);
    emitir({ tipo: "comentario", comentario: c, posicion: d.comentarios.posicion, segundos: d.comentarios.segundos });
    return enviar(res, 200, datosComentarios());
  }
  if (ruta === "/api/comentarios/ocultar" && post) {
    estudio.ocultarComentario();
    emitir({ tipo: "comentario", comentario: null });
    return enviar(res, 200, datosComentarios());
  }
  if (ruta === "/api/comentarios/borrar" && post) {
    d.comentarios.recientes = d.comentarios.recientes.filter(c => c.id !== cuerpo.id);
    estudio.guardar();
    return enviar(res, 200, datosComentarios());
  }
  if (ruta === "/api/comentarios/config" && post) {
    if (["arriba-izquierda", "arriba-derecha", "abajo-izquierda", "abajo-derecha", "centro"].includes(cuerpo.posicion)) d.comentarios.posicion = cuerpo.posicion;
    if (cuerpo.segundos != null) d.comentarios.segundos = Math.max(0, Math.min(300, parseInt(cuerpo.segundos, 10) || 0));
    estudio.guardar();
    emitir({ tipo: "comentario-config", posicion: d.comentarios.posicion, segundos: d.comentarios.segundos });
    return enviar(res, 200, datosComentarios());
  }

  // OBS
  if (ruta === "/api/obs" && !post) return enviar(res, 200, datosObs());
  if (ruta === "/api/obs/config" && post) {
    const c = d.obs;
    if (typeof cuerpo.activo === "boolean") c.activo = cuerpo.activo;
    if (typeof cuerpo.host === "string" && cuerpo.host.trim()) c.host = cuerpo.host.trim();
    if (cuerpo.puerto != null) c.puerto = parseInt(cuerpo.puerto, 10) || 4455;
    if (typeof cuerpo.clave === "string") c.clave = cuerpo.clave;
    estudio.guardar();
    obs.configurar(c);
    return enviar(res, 200, datosObs());
  }
  if (ruta === "/api/obs/recargar" && post) return enviar(res, 200, { ...datosObs(), recargados: await obs.recargarOverlays() });
  if (ruta === "/api/obs/escena" && post) { await obs.cambiarEscena(String(cuerpo.nombre || "")); return enviar(res, 200, datosObs()); }
  if (ruta === "/api/obs/salida" && post) { await obs.salida(cuerpo.cual, cuerpo.accion); return enviar(res, 200, datosObs()); }
  if (ruta === "/api/obs/silenciar" && post) { await obs.silenciar(String(cuerpo.nombre || ""), !!cuerpo.silenciado); return enviar(res, 200, datosObs()); }
  if (ruta === "/api/obs/cuenta" && post) {
    if (cuerpo.accion === "cancelar") cancelarCuenta();
    else await iniciarCuenta(cuerpo);
    return enviar(res, 200, datosObs());
  }

  // Versículo (control remoto)
  if (ruta === "/api/versiculo" && !post) return enviar(res, 200, datosVersiculo());
  if (ruta === "/api/versiculo" && post) return enviar(res, 200, await mostrarVersiculo(cuerpo));

  // Sincronización con el otro PC (sincronizacion.js)
  if (ruta === "/api/sincronizacion" && !post) return enviar(res, 200, await sincronizacion.obtener(true));
  if (ruta === "/api/sincronizacion/config" && post) { sincronizacion.configurar(cuerpo); return enviar(res, 200, await sincronizacion.obtener(true)); }
  if (ruta === "/api/sincronizacion/enviar" && post) { await sincronizacion.enviar(); return enviar(res, 200, await sincronizacion.obtener(true)); }
  if (ruta === "/api/sincronizacion/revisar" && post) return enviar(res, 200, await sincronizacion.revisar());
  if (ruta === "/api/sincronizacion/aplicar" && post) { sincronizacion.aplicar(); return enviar(res, 200, await sincronizacion.obtener(true)); }

  // Control remoto
  if (ruta === "/api/remoto/sesion" && !post) return enviar(res, 200, { ok: !req.remoto || sesionRemota(req) });
  if (ruta === "/api/remoto/entrar" && post) {
    if (!req.remoto) return enviar(res, 200, { ok: true });
    const ip = req.socket.remoteAddress || "";
    const i = intentos.get(ip) || { fallos: 0, hasta: 0 };
    if (i.hasta > Date.now()) return enviar(res, 429, { error: `Demasiados intentos. Espera ${Math.ceil((i.hasta - Date.now()) / 1000)} segundos.` });
    if (!estudio.revisarPin(cuerpo.pin)) {
      i.fallos++;
      // Desde el quinto error, cada intento fallido bloquea un rato más largo
      if (i.fallos >= 5) i.hasta = Date.now() + 60000 * Math.min(10, i.fallos - 4);
      intentos.set(ip, i);
      return enviar(res, 401, { error: "PIN incorrecto" });
    }
    intentos.delete(ip);
    const token = estudio.nuevaSesion();
    res.setHeader("Set-Cookie", `rb_remoto=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 180}`);
    return enviar(res, 200, { ok: true });
  }
  if (ruta === "/api/remoto/config" && !post) {
    if (req.remoto) return enviar(res, 403, { error: "Esto solo se puede ver desde el PC" });
    return enviar(res, 200, await datosRemoto());
  }
  if (ruta === "/api/remoto/config" && post) {
    if (cuerpo.pin != null && cuerpo.pin !== d.remoto.pin) {
      if (!estudio.pinValido(cuerpo.pin)) return enviar(res, 400, { error: "El PIN debe tener entre 4 y 8 números" });
      estudio.cambiarPin(cuerpo.pin);
    }
    if (typeof cuerpo.activo === "boolean") {
      if (cuerpo.activo && !d.remoto.pin) return enviar(res, 400, { error: "Primero elige un PIN" });
      d.remoto.activo = cuerpo.activo;
    }
    if (cuerpo.cerrarSesiones) d.remoto.sesiones = [];
    estudio.guardar();
    await actualizarRemoto();
    return enviar(res, 200, await datosRemoto());
  }
  return false;
}

async function manejar(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
  const ruta = decodeURIComponent(url.pathname);
  let m;

  if (ruta === "/" || ruta === "/index.html") return servirArchivo(res, UI_DIR, "index.html");
  if (ruta.startsWith("/ui/")) return servirArchivo(res, UI_DIR, ruta.slice(4));
  if (ruta.startsWith("/vendor/")) return servirArchivo(res, VENDOR_DIR, ruta.slice(8));
  if (ruta === "/remoto") return servirArchivo(res, UI_DIR, "remoto.html");
  if (ruta === "/o/comentarios") {
    const html = localizarFuentes(fs.readFileSync(RUTA_COMENTARIOS, "utf8"))
      .replace("/*DATOS*/", `window.__comentarios=${JSON.stringify(datosComentarios()).replace(/</g, "\\u003c")};`);
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return res.end(html);
  }
  if (/^\/api\/(estudio|comentarios|obs|versiculo|remoto|sincronizacion)(\/|$)/.test(ruta)) {
    try {
      if ((await manejarEstudio(req, res, ruta)) !== false) return;
    } catch (err) {
      return enviar(res, 400, { error: err.message });
    }
  }

  if (ruta === "/fuentes/css") {
    const original = url.searchParams.get("u") || "";
    if (!/^https:\/\/fonts\.googleapis\.com\//.test(original)) return enviar(res, 400, "Fuente no válida");
    const css = await cssFuente(original);
    if (css == null) { res.writeHead(302, { Location: original }); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[".css"], "Cache-Control": "no-cache" });
    return res.end(css);
  }
  if ((m = /^\/fuentes\/archivo\/([\w.-]+)$/.exec(ruta))) {
    const enApp = path.join(FUENTES_APP, m[1]);
    if (fs.existsSync(enApp)) return servirArchivo(res, FUENTES_APP, m[1]);
    const dir = dirFuentesCarpeta();
    return dir ? servirArchivo(res, dir, m[1]) : enviar(res, 404, "No encontrado");
  }

  if ((m = /^\/paquete\/([\w-]+)\/([0-9a-f-]{36})$/.exec(ruta))) {
    const o = buscarOverlay(m[1]);
    const entrada = o && o.paquete && o.paquete.manifiesto[m[2]];
    if (!entrada) return enviar(res, 404, "No encontrado");
    let datos = Buffer.from(entrada.data, "base64");
    if (entrada.compressed) datos = zlib.gunzipSync(datos);
    res.writeHead(200, { "Content-Type": entrada.mime || "application/octet-stream", "Cache-Control": "no-cache" });
    return res.end(datos);
  }

  // «Ahora suena» desde YouTube Music o Spotify. Los overlays preguntan /api/musica cada 2 s; si no hay canción
  // (apps cerradas, sin autorizar o nada sonando) reciben {} y muestran el texto escrito a mano.
  if (ruta === "/api/musica" && req.method === "GET") {
    return enviar(res, 200, cancionActual(await ytmusic.obtener(), spotify.obtener()) || {});
  }
  if ((m = /^\/api\/musica\/portada\/(\w+)$/.exec(ruta))) {
    const p = spotify.obtenerPortada(m[1]);
    if (!p) return enviar(res, 404, "No encontrado");
    res.writeHead(200, { "Content-Type": p.tipo, "Cache-Control": "max-age=3600" });
    return res.end(p.datos);
  }
  if (ruta === "/api/musica/estado" && req.method === "GET") {
    return enviar(res, 200, await estadoMusica({ esperar: true }));
  }
  if (ruta === "/api/musica/conectar" && req.method === "POST") {
    try {
      await ytmusic.autorizar();
      return enviar(res, 200, await estadoMusica());
    } catch (err) {
      return enviar(res, 400, { error: err.message });
    }
  }
  if (ruta === "/api/musica/puerto" && req.method === "POST") {
    try {
      ytmusic.setPuerto((await leerCuerpo(req)).puerto);
      return enviar(res, 200, await estadoMusica({ esperar: true }));
    } catch (err) {
      return enviar(res, 400, { error: err.message });
    }
  }

  // Lector de la Biblia (overlay de Versículos)
  if (ruta === "/api/biblia/versiones") return enviar(res, 200, { versiones: listaVersiones(), predeterminada: VERSION_PREDETERMINADA });
  if (ruta === "/api/biblia/libros") return enviar(res, 200, listaLibros());
  if (ruta === "/api/biblia/cita") {
    try { return enviar(res, 200, interpretarCita(url.searchParams.get("texto"))); }
    catch (err) { return enviar(res, 400, { error: err.message }); }
  }
  if (ruta === "/api/biblia/capitulo") {
    const p = url.searchParams;
    try { return enviar(res, 200, { versos: await capitulo(p.get("version"), +p.get("libro"), +p.get("capitulo")) }); }
    catch (err) { return enviar(res, 400, { error: err.message }); }
  }

  if (ruta === "/api/eventos") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": conectado\n\n");
    clientesSSE.add(res);
    req.on("close", () => clientesSSE.delete(res));
    return;
  }

  if (ruta === "/api/estado" && req.method === "GET") {
    const overlays = listarOverlays();
    return enviar(res, 200, {
      carpeta,
      faltaSoporte: !!carpeta && overlays.length > 0 && !fs.existsSync(path.join(carpeta, "assets")),
      overlays: overlays.map(resumen)
    });
  }

  if ((m = /^\/api\/overlay\/([\w-]+)$/.exec(ruta)) && req.method === "GET") {
    const o = buscarOverlay(m[1]);
    if (!o) return enviar(res, 404, { error: "No existe ese overlay" });
    const e = entradaDe(o.slug);
    const campo = f => ({ id: f.id, grupo: f.group, original: f.orig });
    return enviar(res, 200, {
      ...resumen(o),
      ancho: parseInt(o.parsed.size && o.parsed.size.width, 10) || 1920,
      alto: parseInt(o.parsed.size && o.parsed.size.height, 10) || 1080,
      opciones: o.parsed.props,
      // Las comillas o signos sueltos del diseño (ej: “ ”) no son textos que valga la pena editar
      textos: o.parsed.texts.filter(f => /[\p{L}\p{N}]/u.test(f.orig)).map(campo),
      listas: o.parsed.lists.map(campo),
      // Campos que manejan «Programa al aire» o «Anuncios»: el editor los muestra bloqueados
      controlados: estudio.controlados(o.parsed, programacion("borrador"), e.borrador),
      borrador: e.borrador,
      publicado: e.publicado
    });
  }

  if ((m = /^\/api\/overlay\/([\w-]+)\/(borrador|publicar|descartar|restaurar)$/.exec(ruta)) && req.method === "POST") {
    const o = buscarOverlay(m[1]);
    if (!o) return enviar(res, 404, { error: "No existe ese overlay" });
    const e = entradaDe(o.slug);
    const accion = m[2];
    if (accion === "borrador") {
      const cuerpo = await leerCuerpo(req);
      e.borrador = { props: cuerpo.props || {}, textos: cuerpo.textos || {} };
    } else if (accion === "publicar") {
      e.publicado = JSON.parse(JSON.stringify(e.borrador));
    } else if (accion === "descartar") {
      e.borrador = JSON.parse(JSON.stringify(e.publicado));
    } else if (accion === "restaurar") {
      e.borrador = vacio();
    }
    guardarValores();
    revisarEstudio(true, o.slug);
    emitir({ tipo: "cambio", slug: o.slug, canal: "borrador" });
    if (accion === "publicar") emitir({ tipo: "cambio", slug: o.slug, canal: "publicado" });
    if (tieneProgramacion(o)) {
      emitir({ tipo: "programacion", canal: "borrador" });
      if (accion === "publicar") emitir({ tipo: "programacion", canal: "publicado" });
      revisarEstudio(); // la programación cambió: puede cambiar el programa al aire
    }
    return enviar(res, 200, { ok: true, pendiente: hayPendientes(o), borrador: e.borrador, publicado: e.publicado });
  }

  if ((m = /^\/o\/([\w-]+)\/?$/.exec(ruta))) {
    const o = buscarOverlay(m[1]);
    if (!o) return enviar(res, 404, "Este overlay no existe. Revisa la carpeta elegida en el Editor de Overlays.");
    return servirOverlay(res, o, url.searchParams.get("canal") === "borrador" ? "borrador" : "publicado", url);
  }

  // Archivos de apoyo de los overlays (support.js, _ds/, assets/ ...)
  if (ruta.startsWith("/o/") && carpeta) {
    const rel = ruta.slice(3);
    const css = path.normalize(path.join(carpeta, rel));
    if (path.extname(rel).toLowerCase() === ".css" && css.startsWith(path.normalize(carpeta + path.sep)) && fs.existsSync(css)) {
      res.writeHead(200, { "Content-Type": MIME[".css"], "Cache-Control": "no-cache" });
      return res.end(localizarFuentes(fs.readFileSync(css, "utf8")));
    }
    return servirArchivo(res, carpeta, rel, rel === "support.js" ? path.join(VENDOR_DIR, "support.js") : null);
  }

  enviar(res, 404, "No encontrado");
}

function setCarpeta(nueva) {
  carpeta = nueva ? path.resolve(nueva) : null;
  cargarValores();
  ytmusic.setCarpeta(carpeta);
  estudio.setCarpeta(carpeta);
  sembrarAnuncios();
  firmas.clear();
  revisarEstudio(true);
  obs.configurar(estudio.get().obs);
  if (servidorPrincipal) actualizarRemoto().catch(() => {});
  emitir({ tipo: "carpeta" });
}

let servidorPrincipal = null;

// ---------- Contenido que viaja del PC de preparación al de transmisión ----------
// Viajan los diseños, lo publicado de cada overlay (menos Versículos, que se maneja en vivo), la programación,
// los presentadores, los anuncios y las opciones del rótulo y de los comentarios. No viaja lo que es propio de cada
// PC ni lo que pasa en vivo: OBS, control remoto, programa puesto a mano, comentario en pantalla.
const CARPETAS_DISENO = ["_ds", "assets"];

function archivosDiseno() {
  const lista = [];
  const recorrer = rel => {
    for (const e of fs.readdirSync(path.join(carpeta, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) recorrer(r);
      else lista.push(r);
    }
  };
  for (const e of fs.readdirSync(carpeta, { withFileTypes: true })) {
    if (e.isFile() && (/\.html$/i.test(e.name) || e.name === "support.js")) lista.push(e.name);
    else if (e.isDirectory() && CARPETAS_DISENO.includes(e.name)) recorrer(e.name);
  }
  return lista.sort();
}

function contenidoParaEnviar() {
  if (!carpeta) throw new Error("No hay carpeta de overlays");
  const archivos = {};
  for (const rel of archivosDiseno()) archivos[rel] = fs.readFileSync(path.join(carpeta, rel)).toString("base64");
  const vers = overlayVersiculo();
  const vals = {};
  for (const [slug, e] of Object.entries(valores)) if (!vers || slug !== vers.slug) vals[slug] = e.publicado || vacio();
  const d = estudio.get();
  return {
    archivos, valores: vals,
    estudio: {
      programas: d.programas, anuncios: d.anuncios,
      alAire: { modo: d.alAire.modo, anticipacion: d.alAire.anticipacion, fuera: d.alAire.fuera },
      comentarios: { posicion: d.comentarios.posicion, segundos: d.comentarios.segundos }
    }
  };
}

function aplicarContenido(c, anteriores) {
  const dentro = rel => {
    const destino = path.normalize(path.join(carpeta, rel));
    return destino.startsWith(path.normalize(carpeta + path.sep)) ? destino : null;
  };
  for (const [rel, b64] of Object.entries(c.archivos || {})) {
    const destino = dentro(rel);
    if (!destino) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(b64, "base64"));
  }
  // Los diseños que se quitaron en el PC de preparación se quitan aquí también
  for (const rel of anteriores) {
    const destino = dentro(rel);
    if (destino && !(rel in (c.archivos || {})) && fs.existsSync(destino)) fs.unlinkSync(destino);
  }
  for (const [slug, v] of Object.entries(c.valores || {})) {
    valores[slug] = { publicado: JSON.parse(JSON.stringify(v)), borrador: JSON.parse(JSON.stringify(v)) };
  }
  guardarValores();
  const d = estudio.get(), e = c.estudio || {};
  if (e.programas) d.programas = e.programas;
  if (e.anuncios) d.anuncios = e.anuncios;
  if (e.alAire) Object.assign(d.alAire, e.alAire);
  if (e.comentarios) Object.assign(d.comentarios, e.comentarios);
  estudio.guardar();
  firmas.clear();
  revisarEstudio(true);
  for (const o of listarOverlays()) {
    emitir({ tipo: "cambio", slug: o.slug, canal: "publicado", origen: "sincronizacion" });
    emitir({ tipo: "cambio", slug: o.slug, canal: "borrador", origen: "sincronizacion" });
  }
  emitir({ tipo: "carpeta" });
  emitir({ tipo: "estudio" });
}

function manejador(fn) {
  return (req, res) => {
    fn(req, res).catch(err => {
      console.error(err);
      if (!res.headersSent) enviar(res, 500, { error: String(err.message || err) });
    });
  };
}

// opciones: { configSincronizacion: archivo con la configuración de este PC, rolPredeterminado }
function iniciar(carpetaInicial, opciones = {}) {
  setCarpeta(carpetaInicial);
  sincronizacion.iniciar({
    archivo: opciones.configSincronizacion || path.join(__dirname, "sincronizacion-local.json"),
    rolPredeterminado: opciones.rolPredeterminado,
    generar: contenidoParaEnviar,
    aplicar: aplicarContenido,
    enVivo: () => { const e = obs.obtener(); return e.conexion === "ok" && (e.transmision.activa || e.grabacion.activa); },
    avisar: emitir
  });
  const server = http.createServer(manejador(manejar));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PUERTO, "127.0.0.1", () => {
      servidorPrincipal = server;
      setInterval(() => revisarEstudio(), CADA_REVISION_MS);
      actualizarRemoto().catch(() => {});
      resolve(server);
    });
  });
}

module.exports = { iniciar, setCarpeta, getCarpeta: () => carpeta, PUERTO, descargarFuente, FUENTES_APP, RE_GOOGLE_FONTS };

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, "..");
  iniciar(dir).then(() => console.log(`Editor de Overlays en http://127.0.0.1:${PUERTO}  (carpeta: ${dir})`));
}
