// «Ahora suena» desde Spotify de escritorio. Spotify informa la canción, el artista, el álbum y la portada al
// panel multimedia de Windows (el que aparece al subir el volumen). Un proceso de PowerShell lee ese panel
// cada segundo y avisa por su salida cuando algo cambia. No hace falta iniciar sesión ni registrar nada.
// El proceso solo corre mientras algún overlay o el editor está preguntando por la música.

const { spawn } = require("child_process");
const crypto = require("crypto");

const APAGAR_SIN_USO_MS = 60000;
const REINTENTAR_MS = 10000;

// Escribe una línea JSON cada vez que cambia lo que suena en Spotify. La portada (en base64) solo se manda
// cuando cambia la canción.
const SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' } | Select-Object -First 1
function Esperar($op, [Type]$tipo) { $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$tipoGestor = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$tipoProps = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$gestor = Esperar ($tipoGestor::RequestAsync()) $tipoGestor
# PowerShell no ve los métodos del flujo de la imagen; se convierte a un flujo de .NET por reflexión
$aFlujo = [System.IO.WindowsRuntimeStreamExtensions].GetMethod("AsStreamForRead", [Type[]]@([Windows.Storage.Streams.IInputStream]))
function Portada($ref) {
  if ($null -eq $ref) { return $null }
  try {
    $st = Esperar ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $flujo = $aFlujo.Invoke($null, @($st))
    $ms = New-Object System.IO.MemoryStream
    $flujo.CopyTo($ms)
    $flujo.Dispose()
    return [Convert]::ToBase64String($ms.ToArray())
  } catch { return $null }
}
$ultimo = ""
$ultimaCancion = ""
$padre = __PID_EDITOR__
while ($true) {
  # Si el editor se cerró de golpe, este lector se apaga solo
  if (-not (Get-Process -Id $padre -ErrorAction SilentlyContinue)) { exit }
  $salida = @{ app = $false }
  try {
    $s = $gestor.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
    if ($s) {
      $p = Esperar ($s.TryGetMediaPropertiesAsync()) $tipoProps
      $salida = @{ app = $true; titulo = $p.Title; artista = $p.Artist; album = $p.AlbumTitle; estado = [string]$s.GetPlaybackInfo().PlaybackStatus }
      $cancion = "$($p.Title)|$($p.Artist)"
      if ($cancion -ne $ultimaCancion) {
        Start-Sleep -Milliseconds 400  # Spotify entrega la portada un momento después del título
        $p = Esperar ($s.TryGetMediaPropertiesAsync()) $tipoProps
        $salida.portada = Portada $p.Thumbnail
        $ultimaCancion = $cancion
      }
    } else { $ultimaCancion = "" }
  } catch { $salida = @{ app = $false; error = $_.Exception.Message } }
  $clave = "$($salida.app)|$($salida.titulo)|$($salida.artista)|$($salida.estado)|$($salida.ContainsKey('portada'))"
  if ($clave -ne $ultimo -or $salida.ContainsKey('portada')) {
    [Console]::Out.WriteLine(($salida | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    $ultimo = $clave
  }
  Start-Sleep -Milliseconds 1000
}
`;

let proceso = null;
let ultimoUso = 0;
let tApagar = null;
let reintentarDesde = 0;
let estado = { conexion: "sin-consultar", cancion: null };
let portada = null; // { id, tipo, datos }

function tipoImagen(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/jpeg";
}

function procesarLinea(linea) {
  let d;
  try { d = JSON.parse(linea); } catch { return; }
  if (!d.app) { estado = { conexion: "sin-app", cancion: null, detalle: d.error || null }; return; }
  if (d.portada) {
    const datos = Buffer.from(d.portada, "base64");
    portada = { id: crypto.createHash("sha1").update(datos).digest("hex").slice(0, 12), tipo: tipoImagen(datos), datos };
  } else if ("portada" in d) {
    portada = null; // la canción nueva no trae portada
  }
  // Sin artista suele ser un anuncio de Spotify Free: no se muestra como canción
  const hayCancion = d.titulo && d.artista;
  estado = {
    conexion: "ok",
    cancion: hayCancion ? {
      titulo: d.titulo,
      artista: d.artista,
      album: d.album || "",
      portada: portada ? `/api/musica/portada/${portada.id}` : null,
      pausado: d.estado !== "Playing"
    } : null
  };
}

function iniciar() {
  if (proceso || process.platform !== "win32" || Date.now() < reintentarDesde) return;
  const codificado = Buffer.from(SCRIPT.replace("__PID_EDITOR__", String(process.pid)), "utf16le").toString("base64");
  proceso = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", codificado], { windowsHide: true });
  let resto = "";
  proceso.stdout.setEncoding("utf8");
  proceso.stdout.on("data", trozo => {
    resto += trozo;
    let i;
    while ((i = resto.indexOf("\n")) >= 0) {
      procesarLinea(resto.slice(0, i).trim());
      resto = resto.slice(i + 1);
    }
  });
  proceso.stderr.on("data", () => {});
  proceso.on("error", () => {});
  proceso.on("exit", () => {
    proceso = null;
    // Si se cayó (no por apagarlo nosotros), se reintenta más tarde
    if (Date.now() - ultimoUso < APAGAR_SIN_USO_MS) {
      reintentarDesde = Date.now() + REINTENTAR_MS;
      estado = { conexion: "error", cancion: null, detalle: "No se pudo leer el panel multimedia de Windows." };
    }
  });
}

function apagar() {
  if (proceso) { proceso.kill(); proceso = null; }
  estado = { conexion: "sin-consultar", cancion: null };
}

// Último estado conocido. Mantiene el lector encendido mientras alguien pregunte.
function obtener() {
  ultimoUso = Date.now();
  if (process.platform !== "win32") return { conexion: "no-disponible", cancion: null };
  iniciar();
  clearTimeout(tApagar);
  tApagar = setTimeout(apagar, APAGAR_SIN_USO_MS);
  return estado;
}

function obtenerPortada(id) {
  return portada && portada.id === id ? portada : null;
}

process.on("exit", () => { if (proceso) proceso.kill(); });

module.exports = { obtener, obtenerPortada };
