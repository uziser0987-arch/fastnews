# ⚡ Fast News v2

Red social de noticias con inicio de sesión en **PostgreSQL (pgAdmin)**, subida de fotos y videos, likes, comentarios, seguidores, historias con efecto de luz, reels con control de volumen, perfil estilo Instagram/TikTok y quiz. Diseño oscuro moderno (negro / gris / azul) para teléfono y computadora.

## Requisitos
- Node.js (https://nodejs.org)
- PostgreSQL + pgAdmin

## Instalación (5 pasos)

### 1. Crear la base de datos en pgAdmin
1. Abre pgAdmin → clic derecho en **Databases** → **Create → Database**
2. Nómbrala: `fastnews`
3. Clic derecho sobre `fastnews` → **Query Tool**
4. Abre `database.sql`, pégalo y presiona **▶ Ejecutar**

> Si ya tenías la versión anterior instalada, vuelve a ejecutar `database.sql`: es seguro y solo agrega las tablas nuevas (`likes`, `comentarios`, `seguidores`).

### 2. Configurar tu contraseña
En `server.js` edita con tus datos de pgAdmin:

```js
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "fastnews",
  user: "postgres",
  password: "TU_PASSWORD"   // ← tu contraseña de PostgreSQL
});
```

### 3. Instalar dependencias
```bash
npm install
```

### 4. Iniciar el servidor
```bash
npm start
```

### 5. Abrir la app
**http://localhost:3000** (desde el celular en la misma red WiFi: `http://IP-de-tu-PC:3000`).

## Tu logo
Coloca tu imagen como `public/logo.png` y aparecerá automáticamente en el login y las barras. Mientras no exista se muestra el ⚡ como marcador.

## Novedades
- **Subir fotos a publicaciones**: casilla para arrastrar o seleccionar JPG / PNG / WEBP con vista previa, se guardan en la carpeta `uploads/` del servidor
- **Subir videos a reels**: MP4 / WEBM hasta 80 MB (o pegar un enlace de YouTube), con reproducción estilo TikTok: tocas para reproducir/pausar y tiene **control de volumen** propio (botón de silencio + barra deslizante)
- **Historias con foto subida** y visor con **efecto de luz**: barrido luminoso diagonal y pulso de contraste/brillo sobre la imagen
- **Reacciones**: likes con corazón animado en publicaciones, reels e historias, y **comentarios** en publicaciones y reels (burbujas estilo Messenger)
- **Perfil estilo Instagram/TikTok**: foto con anillo, contadores de **Publicaciones · Seguidores · Siguiendo · Reels**, biografía, cuadrícula 3×3 de publicaciones, y al tocar el nombre o foto de cualquier persona en el feed/reels se abre su perfil con botón **Seguir / Siguiendo**
- Todo responsive: funciona igual en computadora (barra lateral) y en teléfono (barra inferior)

## Verificar los datos en pgAdmin
```sql
SELECT * FROM usuarios;
SELECT * FROM publicaciones;
SELECT * FROM likes;
SELECT * FROM comentarios;
SELECT * FROM seguidores;
```

## Novedades de la v3
- **100 plantillas de publicaciones FN** (10 por categoría, estilo comunicado de noticias) y **40 plantillas de reels**: tocas el botón "📋 Usar plantilla", eliges una y **se abre tu galería al instante** para agregar la foto o el video y publicar — funciona igual en celular y computadora
- **QR de descarga**: botón "Compartir app" (barra lateral en PC, ícono QR arriba a la derecha en el celular). Muestra un código QR con la dirección de tu app en la red WiFi, botón "📲 Enviar enlace" (lo comparte por WhatsApp, etc.) y "Copiar enlace"
- **App instalable con ícono FN**: al abrir el enlace en un celular, menú del navegador → "Añadir a pantalla de inicio" y la app queda instalada con el ícono azul **FN** (archivos `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`)

> Nota: el QR funciona para dispositivos conectados a tu misma red WiFi. Para que cualquier persona la descargue desde internet, necesitarías subir la app a un hosting (Render, Railway, etc.).
