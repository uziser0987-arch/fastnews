// ============================================================
// FAST NEWS · Servidor v2 (Node.js + Express + PostgreSQL)
// Login en PostgreSQL + subida de fotos/videos + likes,
// comentarios y seguidores
// ============================================================
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
// Encabezados de seguridad (protegen contra ataques comunes)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");        // evita que embeban la app en iframes
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=()");
  next();
});
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Carpeta donde se guardan las fotos y videos subidos
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);
app.use("/uploads", express.static(UPLOADS));

// ----- CONEXIÓN A LA BASE DE DATOS -----
// En tu computadora usa pgAdmin (configura abajo tu contraseña).
// En el hosting (Render) usa automáticamente la variable DATABASE_URL de Neon.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host: "localhost",
      port: 5432,
      database: "fastnews",   // la base que creaste en pgAdmin
      user: "postgres",       // tu usuario de PostgreSQL
      password: "jaeckyun" // tu contraseña de PostgreSQL
    });

const SECRET = "fastnews_secret_cambiame";
const DURACION_SESION = "365d"; // la sesión dura todo el año, como Instagram/Facebook
const PORT = process.env.PORT || 3000;

// Limpieza automática y mantenimiento
async function limpiarExpirados(){
  try{
    // Posts y reels duran 24 horas (se eliminan de todas las cuentas)
    await pool.query("DELETE FROM publicaciones WHERE creado_en < NOW() - INTERVAL '24 hours'");
    await pool.query("DELETE FROM reels WHERE creado_en < NOW() - INTERVAL '24 hours'");
    await pool.query("DELETE FROM historias WHERE creado_en < NOW() - INTERVAL '24 hours'");
    // Elimina cuentas inactivas por más de 3 meses (sin iniciar sesión)
    await pool.query("DELETE FROM usuarios WHERE ultimo_acceso < NOW() - INTERVAL '3 months'");
    // Felicitación de cumpleaños (una vez al día por usuario que cumple hoy)
    await pool.query(`
      INSERT INTO notificaciones (usuario_id, actor_id, tipo, texto)
      SELECT id, id, 'cumple', '🎂 ¡Feliz cumpleaños! Fast News te desea un gran día'
      FROM usuarios u
      WHERE cumple IS NOT NULL
        AND EXTRACT(MONTH FROM cumple)=EXTRACT(MONTH FROM NOW())
        AND EXTRACT(DAY FROM cumple)=EXTRACT(DAY FROM NOW())
        AND NOT EXISTS (
          SELECT 1 FROM notificaciones n
          WHERE n.usuario_id=u.id AND n.tipo='cumple' AND n.creado_en::date = NOW()::date)`);
  }catch(e){ console.error("Limpieza:", e.message); }
}
setInterval(limpiarExpirados, 30 * 60 * 1000); // cada 30 minutos
limpiarExpirados();

// Blindaje: si algo falla, se registra el error pero el servidor NUNCA se apaga
process.on("unhandledRejection", err => console.error("⚠ Error no manejado:", err.message));
process.on("uncaughtException", err => console.error("⚠ Excepción no capturada:", err.message));

// URL de la app en la red WiFi (para el QR de descarga)
const os = require("os");
app.get("/api/red", (_req, res) => {
  let ip = "localhost";
  for (const red of Object.values(os.networkInterfaces()))
    for (const i of red || [])
      if (i.family === "IPv4" && !i.internal) { ip = i.address; break; }
  res.json({ url: `http://${ip}:${PORT}` });
});

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Inicia sesión para continuar" });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: "Sesión expirada, inicia sesión de nuevo" }); }
}

// ================= SUBIDA DE ARCHIVOS (fotos JPG/PNG y videos) =================
const TIPOS_OK = ["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"];
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, Date.now() + "-" + Math.round(Math.random()*1e6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB: fotos y videos en buena resolución
  fileFilter: (_req, file, cb) =>
    TIPOS_OK.includes(file.mimetype) ? cb(null, true)
      : cb(new Error("Formato no permitido. Usa JPG, PNG, WEBP, MP4 o WEBM"))
});

app.post("/api/upload", auth, (req, res) => {
  upload.single("archivo")(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });
    const esImagen = req.file.mimetype.startsWith("image/");
    if (esImagen) {
      // Las fotos se guardan como base64 para que NO se borren al reiniciar Render.
      // (El disco del plan gratis es temporal; base64 vive en la base de datos.)
      try {
        const buf = fs.readFileSync(req.file.path);
        const b64 = `data:${req.file.mimetype};base64,${buf.toString("base64")}`;
        fs.unlink(req.file.path, () => {}); // borra el temporal, ya no se necesita
        return res.json({ url: b64, tipo: req.file.mimetype });
      } catch (e) {
        console.error("base64:", e.message);
        return res.json({ url: "/uploads/" + req.file.filename, tipo: req.file.mimetype });
      }
    }
    // Los videos quedan en el disco (son muy grandes para base64)
    res.json({ url: "/uploads/" + req.file.filename, tipo: req.file.mimetype });
  });
});

// ================= MODERACIÓN DE CONTENIDO (IA) =================
// Detecta contenido sexual/inapropiado. A la 3ra advertencia la cuenta se suspende.
// Puedes agregar o quitar palabras de esta lista según tus reglas.
const PALABRAS_PROHIBIDAS = [
  "porno","pornografia","xxx","desnudo","desnuda","desnudos","nudes","pack caliente",
  "onlyfans","masturb","felacion","prostitut","escort sexual","sexo explicito",
  "verga","pija","tetas","coño","pene erecto","vagina expuesta","follar","orgia",
  "pedofil","zoofilia","incesto","violacion infantil","abuso sexual infantil",
  "puta","puto","mierda","pendejo","maldito imbecil","hijo de perra","marica asqueroso"
];
const normTxt = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
function contenidoInapropiado(...textos){
  const t = " " + normTxt(textos.join(" ")) + " ";
  return PALABRAS_PROHIBIDAS.some(p => t.includes(normTxt(p)));
}
async function estaSuspendido(id){
  const r = await pool.query("SELECT suspendido FROM usuarios WHERE id=$1", [id]);
  return r.rows[0]?.suspendido === true;
}
// Devuelve true si bloqueó la publicación (y ya respondió al usuario)
async function moderar(req, res, ...textos){
  if (await estaSuspendido(req.user.id)) {
    res.status(403).json({ error: "🚫 Tu cuenta está suspendida por incumplir las normas de contenido de Fast News." });
    return true;
  }
  if (!contenidoInapropiado(...textos)) return false;
  const r = await pool.query("UPDATE usuarios SET strikes = strikes + 1 WHERE id=$1 RETURNING strikes", [req.user.id]);
  const s = r.rows[0].strikes;
  if (s >= 3) {
    await pool.query("UPDATE usuarios SET suspendido=TRUE WHERE id=$1", [req.user.id]);
    res.status(403).json({ error: "🚫 Tu cuenta ha sido SUSPENDIDA: el sistema de moderación detectó contenido inapropiado por 3ra vez." });
  } else {
    res.status(400).json({ error: `⚠ Moderación IA: tu publicación contiene contenido inapropiado y fue bloqueada. Advertencia ${s} de 3 — a la tercera tu cuenta será suspendida.` });
  }
  return true;
}

// ================= ELIMINAR CONTENIDO PROPIO =================
const TABLA_DE = { posts: "publicaciones", reels: "reels", historias: "historias" };
const TIPO_DE  = { posts: "post", reels: "reel", historias: "historia" };
app.delete("/api/:tipo(posts|reels|historias)/:id", auth, async (req, res) => {
  try {
    const tabla = TABLA_DE[req.params.tipo];
    const r = await pool.query(
      `DELETE FROM ${tabla} WHERE id=$1 AND usuario_id=$2 RETURNING id`,
      [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(403).json({ error: "Solo puedes eliminar tu propio contenido" });
    await pool.query("DELETE FROM likes WHERE tipo=$1 AND item_id=$2", [TIPO_DE[req.params.tipo], req.params.id]);
    await pool.query("DELETE FROM comentarios WHERE tipo=$1 AND item_id=$2", [TIPO_DE[req.params.tipo], req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// ================= MENSAJES DIRECTOS =================
// Lista de conversaciones (última persona con quien hablaste)
app.get("/api/mensajes", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT ON (otro.id) otro.id, otro.usuario, otro.nombre, otro.avatar_url,
        m.texto AS ultimo, m.creado_en, m.de_id AS ultimo_de,
        (SELECT COUNT(*)::int FROM mensajes x WHERE x.de_id=otro.id AND x.para_id=$1 AND x.leido=FALSE) AS no_leidos,
        (SELECT tipo FROM relaciones rel WHERE (rel.de_id=$1 AND rel.para_id=otro.id) OR (rel.de_id=otro.id AND rel.para_id=$1) LIMIT 1) AS relacion
      FROM mensajes m
      JOIN usuarios otro ON otro.id = CASE WHEN m.de_id=$1 THEN m.para_id ELSE m.de_id END
      WHERE m.de_id=$1 OR m.para_id=$1
      ORDER BY otro.id, m.creado_en DESC`, [req.user.id]);
    // ordena por fecha del último mensaje
    r.rows.sort((a,b) => new Date(b.creado_en) - new Date(a.creado_en));
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Conversación con un usuario específico
app.get("/api/mensajes/:usuario", auth, async (req, res) => {
  try {
    const u = await pool.query("SELECT id, usuario, nombre, avatar_url FROM usuarios WHERE usuario=$1",
      [req.params.usuario.toLowerCase()]);
    if (!u.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const otro = u.rows[0];
    const r = await pool.query(`
      SELECT id, de_id, para_id, texto, creado_en FROM mensajes
      WHERE (de_id=$1 AND para_id=$2) OR (de_id=$2 AND para_id=$1)
      ORDER BY creado_en ASC LIMIT 200`, [req.user.id, otro.id]);
    // marca como leídos los que te mandó
    await pool.query("UPDATE mensajes SET leido=TRUE WHERE de_id=$1 AND para_id=$2", [otro.id, req.user.id]);
    res.json({ otro, mensajes: r.rows, yo: req.user.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Enviar un mensaje
app.post("/api/mensajes", auth, async (req, res) => {
  try {
    const { para, texto } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ error: "Escribe un mensaje" });
    if (await moderar(req, res, texto)) return;
    const u = await pool.query("SELECT id, usuario FROM usuarios WHERE usuario=$1", [String(para).toLowerCase()]);
    if (!u.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const paraId = u.rows[0].id;
    const r = await pool.query(
      "INSERT INTO mensajes (de_id, para_id, texto) VALUES ($1,$2,$3) RETURNING *",
      [req.user.id, paraId, texto.trim().slice(0, 1000)]);
    const quien = await nombreDe(req.user.id);
    await notificar(paraId, req.user.id, "mensaje", `@${quien} te envió un mensaje 💬`);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Total de mensajes no leídos (para el badge)
app.get("/api/mensajes-nuevos", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM mensajes WHERE para_id=$1 AND leido=FALSE", [req.user.id]);
    res.json({ n: r.rows[0].n });
  } catch (e) { res.status(500).json({ error: "Error" }); }
});

// ================= RELACIONES (amistad, noviazgo, familia) =================
app.get("/api/relacion/:usuario", auth, async (req, res) => {
  try {
    const u = await pool.query("SELECT id FROM usuarios WHERE usuario=$1", [req.params.usuario.toLowerCase()]);
    if (!u.rows.length) return res.json({ tipo: null });
    const otroId = u.rows[0].id;
    const r = await pool.query(
      `SELECT tipo, estado, de_id FROM relaciones
       WHERE (de_id=$1 AND para_id=$2) OR (de_id=$2 AND para_id=$1) LIMIT 1`,
      [req.user.id, otroId]);
    res.json(r.rows[0] || { tipo: null });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/relacion", auth, async (req, res) => {
  try {
    const { usuario, tipo } = req.body;
    const tiposOk = ["amistad", "noviazgo", "familia"];
    const u = await pool.query("SELECT id FROM usuarios WHERE usuario=$1", [String(usuario).toLowerCase()]);
    if (!u.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const otroId = u.rows[0].id;
    if (otroId === req.user.id) return res.status(400).json({ error: "No puedes relacionarte contigo mismo" });
    if (tipo === "quitar") {
      await pool.query("DELETE FROM relaciones WHERE (de_id=$1 AND para_id=$2) OR (de_id=$2 AND para_id=$1)",
        [req.user.id, otroId]);
      return res.json({ tipo: null });
    }
    if (!tiposOk.includes(tipo)) return res.status(400).json({ error: "Tipo no válido" });
    await pool.query(
      `INSERT INTO relaciones (de_id, para_id, tipo, estado) VALUES ($1,$2,$3,'pendiente')
       ON CONFLICT (de_id, para_id) DO UPDATE SET tipo=$3`,
      [req.user.id, otroId, tipo]);
    const quien = await nombreDe(req.user.id);
    const etiqueta = tipo === "amistad" ? "amigo/a" : tipo === "noviazgo" ? "pareja 💕" : "familiar";
    await notificar(otroId, req.user.id, "seguidor", `@${quien} te marcó como ${etiqueta}`);
    res.json({ tipo, estado: "pendiente" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/relacion/aceptar", auth, async (req, res) => {
  try {
    const { usuario } = req.body;
    const u = await pool.query("SELECT id FROM usuarios WHERE usuario=$1", [String(usuario).toLowerCase()]);
    if (!u.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    await pool.query("UPDATE relaciones SET estado='aceptada' WHERE de_id=$1 AND para_id=$2",
      [u.rows[0].id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// ================= NOTIFICACIONES =================
async function notificar(usuarioId, actorId, tipo, texto){
  if (usuarioId === actorId) return; // no te notificas a ti mismo
  try{
    await pool.query(
      "INSERT INTO notificaciones (usuario_id, actor_id, tipo, texto) VALUES ($1,$2,$3,$4)",
      [usuarioId, actorId, tipo, texto]);
  }catch(e){ console.error("notif:", e.message); }
}
// Avisar a tus seguidores cuando subes algo nuevo
async function notificarSeguidores(actorId, tipo, texto){
  try{
    const segs = await pool.query("SELECT seguidor_id FROM seguidores WHERE seguido_id=$1", [actorId]);
    for(const s of segs.rows) await notificar(s.seguidor_id, actorId, tipo, texto);
  }catch(e){ console.error("notifSeg:", e.message); }
}
async function nombreDe(id){
  const r = await pool.query("SELECT usuario FROM usuarios WHERE id=$1", [id]);
  return r.rows[0]?.usuario || "alguien";
}

app.get("/api/notificaciones", auth, async (req, res) => {
  try{
    const r = await pool.query(
      `SELECT n.*, u.usuario AS actor_usuario, u.nombre AS actor_nombre, u.avatar_url AS actor_avatar
       FROM notificaciones n LEFT JOIN usuarios u ON u.id=n.actor_id
       WHERE n.usuario_id=$1 ORDER BY n.creado_en DESC LIMIT 40`, [req.user.id]);
    const noLeidas = await pool.query(
      "SELECT COUNT(*)::int AS n FROM notificaciones WHERE usuario_id=$1 AND leida=FALSE", [req.user.id]);
    res.json({ lista: r.rows, noLeidas: noLeidas.rows[0].n });
  }catch(e){ console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/notificaciones/leer", auth, async (req, res) => {
  try{
    await pool.query("UPDATE notificaciones SET leida=TRUE WHERE usuario_id=$1", [req.user.id]);
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: "Error del servidor" }); }
});

app.delete("/api/notificaciones/:id", auth, async (req, res) => {
  try{
    await pool.query("DELETE FROM notificaciones WHERE id=$1 AND usuario_id=$2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: "Error del servidor" }); }
});

app.delete("/api/notificaciones", auth, async (req, res) => {
  try{
    await pool.query("DELETE FROM notificaciones WHERE usuario_id=$1", [req.user.id]);
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: "Error del servidor" }); }
});

// Eliminar una notificación
app.delete("/api/notificaciones/:id", auth, async (req, res) => {
  try{
    await pool.query("DELETE FROM notificaciones WHERE id=$1 AND usuario_id=$2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: "Error del servidor" }); }
});

// Borrar todas las notificaciones
app.delete("/api/notificaciones", auth, async (req, res) => {
  try{
    await pool.query("DELETE FROM notificaciones WHERE usuario_id=$1", [req.user.id]);
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: "Error del servidor" }); }
});

// ================= AUTENTICACIÓN =================
app.post("/api/registro", async (req, res) => {
  try {
    const { nombre, usuario, email, password, edad, cumple } = req.body;
    if (!nombre || !usuario || !email || !password)
      return res.status(400).json({ error: "Completa todos los campos" });
    if (String(password).length < 6)
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: "El correo electrónico no es válido" });
    const hash = await bcrypt.hash(password, 10);
    const codigo = String(Math.floor(100000 + Math.random() * 900000)); // código de 6 dígitos
    const r = await pool.query(
      `INSERT INTO usuarios (nombre, usuario, email, password, edad, cumple, codigo_verif)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nombre, usuario, email, edad, bio, avatar_url, cumple`,
      [nombre, usuario.toLowerCase(), email.toLowerCase(), hash, edad || null, cumple || null, codigo]
    );
    const u = r.rows[0];
    const token = jwt.sign({ id: u.id, usuario: u.usuario }, SECRET, { expiresIn: DURACION_SESION });
    // En un servidor real se enviaría el código por correo. Aquí se devuelve para mostrarlo en pantalla.
    res.json({ token, user: u, codigo_demo: codigo });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Ese usuario o email ya existe" });
    console.error(e); res.status(500).json({ error: "Error del servidor" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: "Escribe tu usuario y contraseña" });
    const r = await pool.query("SELECT * FROM usuarios WHERE usuario=$1 OR email=$1",
      [String(usuario || "").toLowerCase()]);
    if (!r.rows.length) return res.status(400).json({ error: "Usuario no encontrado. Verifica tu usuario o email." });
    const u = r.rows[0];
    if (u.suspendido) return res.status(403).json({ error: "🚫 Esta cuenta fue suspendida por incumplir las normas de contenido de Fast News." });
    // Verificación segura de identidad: compara la contraseña con el hash guardado
    const ok = await bcrypt.compare(password || "", u.password);
    if (!ok) return res.status(400).json({ error: "Contraseña incorrecta. Inténtalo de nuevo." });
    // Actualiza el último acceso (evita que la cuenta se borre por inactividad)
    await pool.query("UPDATE usuarios SET ultimo_acceso=NOW() WHERE id=$1", [u.id]);
    const token = jwt.sign({ id: u.id, usuario: u.usuario }, SECRET, { expiresIn: DURACION_SESION });
    delete u.password; delete u.codigo_verif;
    res.json({ token, user: u });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Verificar el código enviado al correo
app.post("/api/verificar", auth, async (req, res) => {
  try {
    const { codigo } = req.body;
    const r = await pool.query("SELECT codigo_verif FROM usuarios WHERE id=$1", [req.user.id]);
    if (r.rows[0]?.codigo_verif === String(codigo).trim()) {
      await pool.query("UPDATE usuarios SET email_verificado=TRUE, codigo_verif=NULL WHERE id=$1", [req.user.id]);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: "Código incorrecto. Revisa e intenta de nuevo." });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Eliminar la cuenta completamente (y todo su contenido por las claves ON DELETE CASCADE)
app.delete("/api/cuenta", auth, async (req, res) => {
  try {
    const { password } = req.body;
    const r = await pool.query("SELECT password FROM usuarios WHERE id=$1", [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Cuenta no encontrada" });
    // Por seguridad, pide la contraseña antes de borrar todo
    if (!await bcrypt.compare(password || "", r.rows[0].password))
      return res.status(400).json({ error: "Contraseña incorrecta. No se eliminó la cuenta." });
    await pool.query("DELETE FROM usuarios WHERE id=$1", [req.user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// ================= PERFIL (propio) =================
async function statsDe(id) {
  const r = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM publicaciones WHERE usuario_id=$1) AS posts,
      (SELECT COUNT(*)::int FROM reels WHERE usuario_id=$1) AS reels,
      (SELECT COUNT(*)::int FROM seguidores WHERE seguido_id=$1) AS seguidores,
      (SELECT COUNT(*)::int FROM seguidores WHERE seguidor_id=$1) AS siguiendo`, [id]);
  return r.rows[0];
}

const POSTS_DE = `
  SELECT p.id, p.titulo, p.contenido, p.imagen_url, p.categoria, p.creado_en,
    (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='post' AND l.item_id=p.id) AS likes,
    (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='post' AND c.item_id=p.id) AS comentarios,
    EXISTS(SELECT 1 FROM likes l WHERE l.tipo='post' AND l.item_id=p.id AND l.usuario_id=$2) AS me_gusta
  FROM publicaciones p WHERE p.usuario_id=$1 AND p.creado_en > NOW() - INTERVAL '24 hours' ORDER BY p.creado_en DESC`;
const REELS_DE = `
  SELECT r.id, r.video_url, r.descripcion, r.creado_en,
    (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id) AS likes,
    (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='reel' AND c.item_id=r.id) AS comentarios,
    EXISTS(SELECT 1 FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id AND l.usuario_id=$2) AS me_gusta
  FROM reels r WHERE r.usuario_id=$1 AND r.creado_en > NOW() - INTERVAL '24 hours' ORDER BY r.creado_en DESC`;

app.get("/api/perfil", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, nombre, usuario, email, edad, bio, avatar_url, cumple, email_verificado, creado_en FROM usuarios WHERE id=$1",
      [req.user.id]);
    const posts = await pool.query(POSTS_DE, [req.user.id, req.user.id]);
    const reels = await pool.query(REELS_DE, [req.user.id, req.user.id]);
    res.json({ ...r.rows[0], stats: await statsDe(req.user.id),
               posts: posts.rows, reels: reels.rows, es_mio: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.put("/api/perfil", auth, async (req, res) => {
  const { nombre, edad, bio, avatar_url, cumple } = req.body;
  const r = await pool.query(
    `UPDATE usuarios SET nombre=COALESCE($1,nombre), edad=$2, bio=COALESCE($3,bio),
     avatar_url=COALESCE($4,avatar_url), cumple=$5 WHERE id=$6
     RETURNING id, nombre, usuario, email, edad, bio, avatar_url, cumple`,
    [nombre, edad || null, bio, avatar_url, cumple || null, req.user.id]);
  res.json(r.rows[0]);
});

// ================= PERFIL DE OTRO USUARIO + SEGUIR =================
app.get("/api/usuarios/:usuario", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, nombre, usuario, edad, bio, avatar_url, cumple, creado_en FROM usuarios WHERE usuario=$1",
      [req.params.usuario.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const u = r.rows[0];
    const posts = await pool.query(POSTS_DE, [u.id, req.user.id]);
    const reels = await pool.query(REELS_DE, [u.id, req.user.id]);
    const sigo = await pool.query(
      "SELECT 1 FROM seguidores WHERE seguidor_id=$1 AND seguido_id=$2", [req.user.id, u.id]);
    res.json({ ...u, stats: await statsDe(u.id), posts: posts.rows, reels: reels.rows,
               lo_sigo: sigo.rows.length > 0, es_mio: u.id === req.user.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Listas de seguidores y seguidos (para verlas estilo Instagram)
app.get("/api/seguidores/:id", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.avatar_url,
         EXISTS(SELECT 1 FROM seguidores x WHERE x.seguidor_id=$2 AND x.seguido_id=u.id) AS lo_sigo
       FROM seguidores s JOIN usuarios u ON u.id = s.seguidor_id
       WHERE s.seguido_id=$1 ORDER BY s.creado_en DESC`, [req.params.id, req.user.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.get("/api/siguiendo/:id", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.avatar_url,
         EXISTS(SELECT 1 FROM seguidores x WHERE x.seguidor_id=$2 AND x.seguido_id=u.id) AS lo_sigo
       FROM seguidores s JOIN usuarios u ON u.id = s.seguido_id
       WHERE s.seguidor_id=$1 ORDER BY s.creado_en DESC`, [req.params.id, req.user.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Búsqueda inteligente: noticias, reels y personas en una sola consulta
app.get("/api/buscar", auth, async (req, res) => {
  try {
    const q = "%" + String(req.query.q || "").trim() + "%";
    const posts = await pool.query(
      `SELECT p.*, u.nombre, u.usuario, u.avatar_url,
         (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='post' AND l.item_id=p.id) AS likes,
         (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='post' AND c.item_id=p.id) AS comentarios,
         EXISTS(SELECT 1 FROM likes l WHERE l.tipo='post' AND l.item_id=p.id AND l.usuario_id=$1) AS me_gusta
       FROM publicaciones p JOIN usuarios u ON u.id=p.usuario_id
       WHERE p.titulo ILIKE $2 OR p.contenido ILIKE $2 OR p.categoria ILIKE $2
       ORDER BY p.creado_en DESC LIMIT 15`, [req.user.id, q]);
    const reels = await pool.query(
      `SELECT r.*, u.nombre, u.usuario, u.avatar_url,
         (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id) AS likes,
         EXISTS(SELECT 1 FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id AND l.usuario_id=$1) AS me_gusta
       FROM reels r JOIN usuarios u ON u.id=r.usuario_id
       WHERE r.descripcion ILIKE $2 ORDER BY r.creado_en DESC LIMIT 10`, [req.user.id, q]);
    const usuarios = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.avatar_url,
         (SELECT COUNT(*)::int FROM seguidores s WHERE s.seguido_id=u.id) AS seguidores,
         EXISTS(SELECT 1 FROM seguidores x WHERE x.seguidor_id=$1 AND x.seguido_id=u.id) AS lo_sigo
       FROM usuarios u WHERE (u.nombre ILIKE $2 OR u.usuario ILIKE $2) AND u.id<>$1
       ORDER BY seguidores DESC LIMIT 8`, [req.user.id, q]);
    res.json({ posts: posts.rows, reels: reels.rows, usuarios: usuarios.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Recomendado para ti: primero lo de quienes sigues, luego tus categorías más vistas
app.get("/api/recomendado", auth, async (req, res) => {
  try {
    const cats = await pool.query(
      `SELECT categoria FROM vistas WHERE usuario_id=$1
       GROUP BY categoria ORDER BY COUNT(*) DESC LIMIT 3`, [req.user.id]);
    const favoritas = cats.rows.map(c => c.categoria);
    const r = await pool.query(
      `SELECT p.*, u.nombre, u.usuario, u.avatar_url,
         (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='post' AND l.item_id=p.id) AS likes,
         (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='post' AND c.item_id=p.id) AS comentarios,
         EXISTS(SELECT 1 FROM likes l WHERE l.tipo='post' AND l.item_id=p.id AND l.usuario_id=$1) AS me_gusta
       FROM publicaciones p JOIN usuarios u ON u.id=p.usuario_id
       ORDER BY
         CASE WHEN p.usuario_id IN (SELECT seguido_id FROM seguidores WHERE seguidor_id=$1) THEN 0 ELSE 1 END,
         CASE WHEN p.categoria = ANY($2::text[]) THEN 0 ELSE 1 END,
         p.creado_en DESC
       LIMIT 20`, [req.user.id, favoritas]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/seguir/:id", auth, async (req, res) => {
  try {
    const seguido = parseInt(req.params.id);
    if (seguido === req.user.id) return res.status(400).json({ error: "No puedes seguirte a ti" });
    const del = await pool.query(
      "DELETE FROM seguidores WHERE seguidor_id=$1 AND seguido_id=$2 RETURNING 1",
      [req.user.id, seguido]);
    if (!del.rows.length) {
      await pool.query(
        "INSERT INTO seguidores (seguidor_id, seguido_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [req.user.id, seguido]);
      const quien = await nombreDe(req.user.id);
      await notificar(seguido, req.user.id, "seguidor", `@${quien} empezó a seguirte 👤`);
    }
    const n = await pool.query("SELECT COUNT(*)::int AS n FROM seguidores WHERE seguido_id=$1", [seguido]);
    res.json({ siguiendo: !del.rows.length, seguidores: n.rows[0].n });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Descubrir usuarios: todas las cuentas (populares y nuevas), con buscador opcional
app.get("/api/descubrir", auth, async (req, res) => {
  try {
    const q = "%" + String(req.query.q || "").trim() + "%";
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.avatar_url, u.bio,
         (SELECT COUNT(*)::int FROM seguidores s WHERE s.seguido_id=u.id) AS seguidores,
         (SELECT COUNT(*)::int FROM publicaciones p WHERE p.usuario_id=u.id) AS posts,
         EXISTS(SELECT 1 FROM seguidores x WHERE x.seguidor_id=$1 AND x.seguido_id=u.id) AS lo_sigo
       FROM usuarios u
       WHERE u.id<>$1 AND u.suspendido=FALSE AND (u.nombre ILIKE $2 OR u.usuario ILIKE $2)
       ORDER BY seguidores DESC, u.creado_en DESC LIMIT 50`, [req.user.id, q]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// Sugerencias de usuarios para seguir (los más populares que aún no sigues)
app.get("/api/sugerencias", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT u.id, u.nombre, u.usuario, u.avatar_url,
       (SELECT COUNT(*)::int FROM seguidores s WHERE s.seguido_id=u.id) AS seguidores,
       (SELECT COUNT(*)::int FROM publicaciones p WHERE p.usuario_id=u.id) AS posts
     FROM usuarios u
     WHERE u.id <> $1
       AND NOT EXISTS (SELECT 1 FROM seguidores s WHERE s.seguidor_id=$1 AND s.seguido_id=u.id)
     ORDER BY seguidores DESC, posts DESC, RANDOM()
     LIMIT 8`, [req.user.id]);
  res.json(r.rows);
});

// ================= LIKES y COMENTARIOS =================
app.post("/api/like", auth, async (req, res) => {
  try {
    const { tipo, item_id } = req.body;
    if (!["post","reel","historia"].includes(tipo)) return res.status(400).json({ error: "Tipo inválido" });
    const del = await pool.query(
      "DELETE FROM likes WHERE usuario_id=$1 AND tipo=$2 AND item_id=$3 RETURNING 1",
      [req.user.id, tipo, item_id]);
    if (!del.rows.length)
      await pool.query(
        "INSERT INTO likes (usuario_id, tipo, item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.user.id, tipo, item_id]);
    const n = await pool.query("SELECT COUNT(*)::int AS n FROM likes WHERE tipo=$1 AND item_id=$2",
      [tipo, item_id]);
    if (!del.rows.length) {  // si fue un like nuevo, notifica al dueño
      const tablaMap = { post: "publicaciones", reel: "reels", historia: "historias" };
      const dueno = await pool.query(`SELECT usuario_id FROM ${tablaMap[tipo]} WHERE id=$1`, [item_id]);
      if (dueno.rows.length) {
        const quien = await nombreDe(req.user.id);
        const queCosa = tipo === "post" ? "tu publicación" : tipo === "reel" ? "tu reel" : "tu historia";
        await notificar(dueno.rows[0].usuario_id, req.user.id, "like", `@${quien} le dio me gusta a ${queCosa} ❤️`);
      }
    }
    res.json({ liked: !del.rows.length, total: n.rows[0].n });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.get("/api/comentarios/:tipo/:id", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT c.*, u.nombre, u.usuario, u.avatar_url FROM comentarios c
     JOIN usuarios u ON u.id=c.usuario_id
     WHERE c.tipo=$1 AND c.item_id=$2 ORDER BY c.creado_en ASC`,
    [req.params.tipo, req.params.id]);
  res.json(r.rows);
});

app.post("/api/comentarios", auth, async (req, res) => {
  const { tipo, item_id, texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: "Escribe un comentario" });
  if (await moderar(req, res, texto)) return;
  const r = await pool.query(
    `INSERT INTO comentarios (usuario_id, tipo, item_id, texto) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, tipo, item_id, texto.trim().slice(0, 300)]);
  try {
    const tablaMap = { post: "publicaciones", reel: "reels" };
    const dueno = await pool.query(`SELECT usuario_id FROM ${tablaMap[tipo]} WHERE id=$1`, [item_id]);
    if (dueno.rows.length) {
      const quien = await nombreDe(req.user.id);
      await notificar(dueno.rows[0].usuario_id, req.user.id, "comentario", `@${quien} comentó en tu ${tipo === "post" ? "publicación" : "reel"} 💬`);
    }
  } catch(e){ console.error(e.message); }
  res.json(r.rows[0]);
});

// ================= PUBLICACIONES =================
app.get("/api/posts", auth, async (req, res) => {
  try {
    const { categoria } = req.query;
    const params = [req.user.id];
    let where = "WHERE p.creado_en > NOW() - INTERVAL '24 hours'";
    if (categoria && categoria !== "Todas") { where += " AND p.categoria=$2"; params.push(categoria); }
    const r = await pool.query(
      `SELECT p.*, u.nombre, u.usuario, u.avatar_url,
         (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='post' AND l.item_id=p.id) AS likes,
         (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='post' AND c.item_id=p.id) AS comentarios,
         EXISTS(SELECT 1 FROM likes l WHERE l.tipo='post' AND l.item_id=p.id AND l.usuario_id=$1) AS me_gusta
       FROM publicaciones p JOIN usuarios u ON u.id=p.usuario_id
       ${where} ORDER BY p.creado_en DESC LIMIT 25`, params);
    res.json(r.rows);
  } catch (e) { console.error("posts:", e.message); res.status(500).json({ error: "Error al cargar noticias" }); }
});

app.post("/api/posts", auth, async (req, res) => {
  const { categoria, titulo, contenido, imagen_url, etiquetas } = req.body;
  if (!categoria || !titulo || !contenido)
    return res.status(400).json({ error: "Categoría, título y contenido son obligatorios" });
  if (await moderar(req, res, titulo, contenido)) return;
  const etq = Array.isArray(etiquetas) ? etiquetas.join(",") : (etiquetas || "");
  const r = await pool.query(
    `INSERT INTO publicaciones (usuario_id, categoria, titulo, contenido, imagen_url, etiquetas)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, categoria, titulo, contenido, imagen_url || "", etq]);
  const quienP = await nombreDe(req.user.id);
  notificarSeguidores(req.user.id, "post", `@${quienP} publicó una noticia nueva 📰`);
  res.json(r.rows[0]);
});

app.post("/api/vistas", auth, async (req, res) => {
  const { categoria } = req.body;
  if (categoria && categoria !== "Todas")
    await pool.query("INSERT INTO vistas (usuario_id, categoria) VALUES ($1,$2)", [req.user.id, categoria]);
  res.json({ ok: true });
});

// ================= HISTORIAS =================
app.get("/api/historias", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT h.*, u.nombre, u.usuario, u.avatar_url,
       (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='historia' AND l.item_id=h.id) AS likes,
       EXISTS(SELECT 1 FROM likes l WHERE l.tipo='historia' AND l.item_id=h.id AND l.usuario_id=$1) AS me_gusta
     FROM historias h JOIN usuarios u ON u.id=h.usuario_id
     WHERE h.creado_en > NOW() - INTERVAL '24 hours'
     ORDER BY h.creado_en DESC`, [req.user.id]);
  res.json(r.rows);
});

app.post("/api/historias", auth, async (req, res) => {
  const { imagen_url, texto } = req.body;
  if (!imagen_url) return res.status(400).json({ error: "Agrega una foto para tu historia" });
  if (await moderar(req, res, texto)) return;
  const r = await pool.query(
    "INSERT INTO historias (usuario_id, imagen_url, texto) VALUES ($1,$2,$3) RETURNING *",
    [req.user.id, imagen_url, texto || ""]);
  res.json(r.rows[0]);
});

// ================= REELS =================
app.get("/api/reels", auth, async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, u.nombre, u.usuario, u.avatar_url,
       (SELECT COUNT(*)::int FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id) AS likes,
       (SELECT COUNT(*)::int FROM comentarios c WHERE c.tipo='reel' AND c.item_id=r.id) AS comentarios,
       EXISTS(SELECT 1 FROM likes l WHERE l.tipo='reel' AND l.item_id=r.id AND l.usuario_id=$1) AS me_gusta
     FROM reels r JOIN usuarios u ON u.id=r.usuario_id
     WHERE r.creado_en > NOW() - INTERVAL '24 hours' ORDER BY r.creado_en DESC LIMIT 40`, [req.user.id]);
  res.json(r.rows);
});

app.post("/api/reels", auth, async (req, res) => {
  const { video_url, descripcion, etiquetas } = req.body;
  if (!video_url) return res.status(400).json({ error: "Sube o enlaza un video" });
  if (await moderar(req, res, descripcion)) return;
  const etq = Array.isArray(etiquetas) ? etiquetas.join(",") : (etiquetas || "");
  const r = await pool.query(
    "INSERT INTO reels (usuario_id, video_url, descripcion, etiquetas) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.user.id, video_url, descripcion || "", etq]);
  const quienR = await nombreDe(req.user.id);
  notificarSeguidores(req.user.id, "reel", `@${quienR} subió un nuevo reel 🎬`);
  res.json(r.rows[0]);
});

// ================= REACCIONES CON EMOJIS (aparte del like) =================
app.get("/api/reacciones/:tipo/:id", auth, async (req, res) => {
  try {
    const { tipo, id } = req.params;
    const conteo = await pool.query(
      "SELECT emoji, COUNT(*)::int AS n FROM reacciones WHERE tipo=$1 AND item_id=$2 GROUP BY emoji",
      [tipo, id]);
    const mia = await pool.query(
      "SELECT emoji FROM reacciones WHERE tipo=$1 AND item_id=$2 AND usuario_id=$3",
      [tipo, id, req.user.id]);
    res.json({ conteo: conteo.rows, mia: mia.rows[0]?.emoji || null });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/reacciones", auth, async (req, res) => {
  try {
    const { tipo, item_id, emoji } = req.body;
    // Si ya tenía esa misma reacción, la quita (toggle). Si no, la cambia/agrega.
    const previa = await pool.query(
      "SELECT emoji FROM reacciones WHERE usuario_id=$1 AND tipo=$2 AND item_id=$3",
      [req.user.id, tipo, item_id]);
    if (previa.rows[0]?.emoji === emoji) {
      await pool.query("DELETE FROM reacciones WHERE usuario_id=$1 AND tipo=$2 AND item_id=$3",
        [req.user.id, tipo, item_id]);
    } else {
      await pool.query(
        `INSERT INTO reacciones (usuario_id, tipo, item_id, emoji) VALUES ($1,$2,$3,$4)
         ON CONFLICT (usuario_id, tipo, item_id) DO UPDATE SET emoji=$4, creado_en=NOW()`,
        [req.user.id, tipo, item_id, emoji]);
    }
    const conteo = await pool.query(
      "SELECT emoji, COUNT(*)::int AS n FROM reacciones WHERE tipo=$1 AND item_id=$2 GROUP BY emoji",
      [tipo, item_id]);
    const mia = await pool.query(
      "SELECT emoji FROM reacciones WHERE tipo=$1 AND item_id=$2 AND usuario_id=$3",
      [tipo, item_id, req.user.id]);
    res.json({ conteo: conteo.rows, mia: mia.rows[0]?.emoji || null });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

// ================= QUIZ =================
app.get("/api/quiz/categorias", auth, async (req, res) => {
  const cats = await pool.query("SELECT DISTINCT categoria FROM quiz_preguntas ORDER BY categoria");
  const vistas = await pool.query(
    `SELECT categoria, COUNT(*) AS n FROM vistas WHERE usuario_id=$1
     GROUP BY categoria ORDER BY n DESC`, [req.user.id]);
  res.json({ categorias: cats.rows.map(c => c.categoria),
             recomendadas: vistas.rows.map(v => v.categoria) });
});

app.get("/api/quiz/:categoria", auth, async (req, res) => {
  try {
    const cat = req.params.categoria;
    // Preguntas fijas educativas de la categoría
    const fijas = await pool.query(
      `SELECT id, categoria, pregunta, opcion_a, opcion_b, opcion_c, opcion_d, correcta
       FROM quiz_preguntas WHERE categoria=$1 ORDER BY RANDOM() LIMIT 5`, [cat]);
    // La IA arma preguntas con noticias REALES subidas a la app en esa categoría
    const noticias = await pool.query(
      `SELECT titulo FROM publicaciones WHERE categoria=$1 AND creado_en > NOW() - INTERVAL '24 hours'
       ORDER BY RANDOM() LIMIT 3`, [cat]);
    const dinamicas = noticias.rows.map((n, i) => {
      const otras = ["Ninguna de las anteriores", "No se ha publicado esa noticia", "Es información falsa"];
      return {
        id: "ia-" + i,
        categoria: cat,
        pregunta: `📰 Según Fast News, ¿qué noticia se publicó recientemente en ${cat}?`,
        opcion_a: n.titulo.slice(0, 90),
        opcion_b: otras[0], opcion_c: otras[1], opcion_d: otras[2],
        correcta: "a"
      };
    });
    // Mezcla preguntas educativas + de actualidad
    const todas = [...fijas.rows, ...dinamicas].sort(() => Math.random() - 0.5).slice(0, 5);
    res.json(todas);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error del servidor" }); }
});

app.post("/api/quiz/resultado", auth, async (req, res) => {
  const { categoria, puntaje, total } = req.body;
  await pool.query(
    "INSERT INTO quiz_resultados (usuario_id, categoria, puntaje, total) VALUES ($1,$2,$3,$4)",
    [req.user.id, categoria, puntaje, total]);
  res.json({ ok: true });
});

// Manejador de errores: si algo falla, responde sin tumbar el servidor
app.use((err, req, res, next) => {
  console.error("Error capturado:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Algo salió mal, intenta de nuevo" });
});

// Evita que el servidor se caiga por errores no controlados
process.on("uncaughtException", e => console.error("uncaughtException:", e.message));
process.on("unhandledRejection", e => console.error("unhandledRejection:", e && e.message));

app.listen(PORT, () =>
  console.log(`⚡ Fast News v3 corriendo en http://localhost:${PORT}`));
