// Lee un overlay exportado de Claude Design (.dc.html), detecta qué se puede editar
// y genera una versión del HTML con los valores que eligió el usuario.
//
// Hay tres tipos de campos editables:
//   prop  -> opciones declaradas por el diseño en data-props (editor, default, etc.)
//   texto -> textos visibles escritos directamente en la plantilla <x-dc>
//   lista -> textos dentro de listas de datos del código, ej: const RADIO = [ ... ]

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP_TAGS = new Set(["svg", "style", "script", "helmet", "title", "noscript"]);
// Opciones que solo sirven para la vista previa de Claude Design; en OBS no tienen efecto.
const HIDDEN_PROPS = new Set(["fondoVistaPrevia"]);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function encodeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Evita que el motor de plantillas interprete {{ }} escritos por el usuario
    .replace(/\{\{/g, "{ {")
    .replace(/\}\}/g, "} }");
}

function encodeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// "detallePrograma" -> "Detalle programa", "culto1Cuando" -> "Culto 1 cuando"
function humanize(key) {
  const s = key
    .replace(/_/g, " ")
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function locateParts(html) {
  const open = /<x-dc(?:\s[^>]*)?>/.exec(html);
  const close = html.lastIndexOf("</x-dc>");
  const tpl = open && close > open.index ? { start: open.index + open[0].length, end: close } : null;

  const scriptOpen = /<script\b[^>]*\bdata-dc-script\b[^>]*>/.exec(html);
  let script = null, propsAttr = null;
  if (scriptOpen) {
    const start = scriptOpen.index + scriptOpen[0].length;
    const end = html.indexOf("</script>", start);
    if (end !== -1) script = { start, end };
    const m = /\bdata-props="([^"]*)"/.exec(scriptOpen[0]);
    if (m) {
      const start = scriptOpen.index + m.index + 'data-props="'.length;
      propsAttr = { start, end: start + m[1].length, raw: m[1] };
    }
  }
  return { tpl, script, propsAttr };
}

function parseProps(propsAttr) {
  if (!propsAttr) return null;
  try {
    const obj = JSON.parse(decodeEntities(propsAttr.raw));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

// Recorre la plantilla y devuelve los textos visibles con su posición exacta.
function scanTemplate(html, tpl) {
  const fields = [];
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const stack = [{ name: "#root", skip: false, group: "" }];
  let run = null; // texto continuo, posiblemente con <br> en medio
  let pos = tpl.start;

  const flush = () => {
    if (!run) return;
    const raw = html.slice(run.start, run.end);
    // Separa las partes fijas de las expresiones {{ ... }}
    const mustache = /\{\{[\s\S]*?\}\}/g;
    let last = 0, m;
    const pieces = [];
    while ((m = mustache.exec(raw))) {
      pieces.push([last, m.index]);
      last = m.index + m[0].length;
    }
    pieces.push([last, raw.length]);
    for (const [a, b] of pieces) {
      const seg = raw.slice(a, b);
      const lead = seg.length - seg.replace(/^[\s]+/, "").length;
      const body = seg.trim();
      if (!body || /^<br\s*\/?>$/i.test(body)) continue;
      const start = run.start + a + lead;
      const orig = decodeEntities(body.replace(/\s*<br\s*\/?>\s*/gi, "\n")).replace(/[ \t\r\n]*\n[ \t\r\n]*/g, "\n");
      fields.push({ start, end: start + body.length, orig, group: run.group });
    }
    run = null;
  };

  tagRe.lastIndex = tpl.start;
  let m;
  while ((m = tagRe.exec(html)) && m.index < tpl.end) {
    const top = stack[stack.length - 1];
    if (m.index > pos && !top.skip) {
      if (!run) run = { start: pos, end: m.index, group: top.group };
      else run.end = m.index;
    }
    pos = m.index + m[0].length;
    if (m[0].startsWith("<!--")) continue;

    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attrs = m[3] || "";

    if (name === "br" && run) { run.end = pos; continue; }
    flush();

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*$/.test(attrs)) continue;
    const label = /\bdata-screen-label="([^"]*)"/.exec(attrs);
    stack.push({
      name,
      // Lo que solo aparece en la vista previa (ej: el rótulo "CÁMARA") no se edita
      skip: top.skip || SKIP_TAGS.has(name) || (name === "sc-if" && /showPreview/.test(attrs)),
      group: label ? decodeEntities(label[1]) : top.group
    });
  }
  if (tpl.end > pos && !stack[stack.length - 1].skip) {
    if (!run) run = { start: pos, end: tpl.end, group: stack[stack.length - 1].group };
    else run.end = tpl.end;
  }
  flush();
  return fields;
}

// Busca listas de datos en el código (const NOMBRE = [ ... ]) y sus textos entre comillas dobles.
function scanScriptLists(html, script) {
  const fields = [];
  const src = html.slice(script.start, script.end);
  const declRe = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*\[/g;
  let d;
  while ((d = declRe.exec(src))) {
    const name = d[1];
    let i = d.index + d[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
        if (c === '"') {
          const lit = src.slice(i, j + 1);
          let value = null;
          try { value = JSON.parse(lit); } catch {}
          if (typeof value === "string" && value.trim() && !value.includes("<")) {
            fields.push({ start: script.start + i, end: script.start + j + 1, orig: value, group: humanize(name) });
          }
        }
        i = j + 1;
        continue;
      }
      if (c === "[" || c === "{" || c === "(") depth++;
      else if (c === "]" || c === "}" || c === ")") depth--;
      i++;
    }
    declRe.lastIndex = i;
  }
  return fields;
}

function parseOverlay(html) {
  const parts = locateParts(html);
  if (!parts.tpl || !parts.propsAttr) return null;
  const propsObj = parseProps(parts.propsAttr) || {};
  const scriptSrc = parts.script ? html.slice(parts.script.start, parts.script.end) : "";

  const props = [];
  for (const [key, meta] of Object.entries(propsObj)) {
    if (key.startsWith("$") || !meta || typeof meta !== "object") continue;
    if (HIDDEN_PROPS.has(key) || meta.section === "Vista previa") continue;
    // Si el código lee la opción desde la URL (?escena=...), se ofrecen enlaces por opción
    const urlParam = new RegExp(`\\.get\\(\\s*["']${key}["']\\s*\\)`).test(scriptSrc);
    props.push({
      id: "p:" + key,
      key,
      label: humanize(key),
      section: meta.section || "Opciones",
      editor: meta.editor || "text",
      options: meta.options || null,
      min: meta.min, max: meta.max, step: meta.step, unit: meta.unit || "",
      default: meta.default,
      urlParam
    });
  }

  const texts = scanTemplate(html, parts.tpl).map((f, i) => ({ id: "t" + i, ...f }));
  const lists = parts.script ? scanScriptLists(html, parts.script).map((f, i) => ({ id: "j" + i, ...f })) : [];

  return { parts, propsObj, props, texts, lists, size: propsObj.$preview || null };
}

// values: { props: { key: valor }, textos: { id: { o: original, v: valor } } }
function renderOverlay(html, parsed, values) {
  const reps = [];
  const textVals = (values && values.textos) || {};
  const propVals = (values && values.props) || {};

  if (parsed.parts.propsAttr) {
    const obj = JSON.parse(JSON.stringify(parsed.propsObj));
    for (const [k, v] of Object.entries(propVals)) {
      if (obj[k] && typeof obj[k] === "object") obj[k].default = v;
    }
    reps.push({ start: parsed.parts.propsAttr.start, end: parsed.parts.propsAttr.end, text: encodeAttr(JSON.stringify(obj)) });
  }
  for (const f of parsed.texts) {
    const tv = textVals[f.id];
    if (!tv || tv.o !== f.orig || tv.v === f.orig) continue;
    reps.push({ start: f.start, end: f.end, text: String(tv.v).split("\n").map(encodeText).join("<br>") });
  }
  for (const f of parsed.lists) {
    const tv = textVals[f.id];
    if (!tv || tv.o !== f.orig || tv.v === f.orig) continue;
    reps.push({ start: f.start, end: f.end, text: JSON.stringify(String(tv.v)) });
  }

  reps.sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of reps) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

module.exports = { parseOverlay, renderOverlay, humanize };
