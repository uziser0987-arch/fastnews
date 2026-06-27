-- ============================================================
-- FAST NEWS · Base de datos PostgreSQL (v2)
-- Cómo usar en pgAdmin:
--   1. Crea una base de datos llamada: fastnews
--   2. Abre Query Tool sobre esa base y ejecuta este archivo completo
--   (Es seguro re-ejecutarlo: usa IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(80)  NOT NULL,
    usuario     VARCHAR(40)  NOT NULL UNIQUE,
    email       VARCHAR(120) NOT NULL UNIQUE,
    password    TEXT         NOT NULL,            -- hash bcrypt
    edad        INT,
    bio         TEXT DEFAULT '',
    avatar_url  TEXT DEFAULT '',
    cumple      DATE,                             -- día de cumpleaños
    pais        VARCHAR(60) DEFAULT 'El Salvador',
    strikes     INT DEFAULT 0,                    -- advertencias de moderación
    suspendido  BOOLEAN DEFAULT FALSE,            -- cuenta suspendida a los 3 strikes
    email_verificado BOOLEAN DEFAULT FALSE,       -- verificación por correo
    codigo_verif VARCHAR(8),                      -- código de verificación temporal
    ultimo_acceso TIMESTAMP DEFAULT NOW(),        -- para borrar inactivas (3 meses)
    creado_en   TIMESTAMP DEFAULT NOW()
);

-- Si la tabla ya existía, agrega las columnas nuevas sin perder datos:
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS strikes INT DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS suspendido BOOLEAN DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cumple DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pais VARCHAR(60) DEFAULT 'El Salvador';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_verif VARCHAR(8);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS publicaciones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    categoria   VARCHAR(40) NOT NULL,
    etiquetas   TEXT DEFAULT '',        -- categorías extra separadas por coma
    titulo      VARCHAR(200) NOT NULL,
    contenido   TEXT NOT NULL,
    imagen_url  TEXT DEFAULT '',
    expira_en   TIMESTAMP DEFAULT (NOW() + INTERVAL '3 days'),
    creado_en   TIMESTAMP DEFAULT NOW()
);
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP DEFAULT (NOW() + INTERVAL '3 days');
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS etiquetas TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS historias (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    imagen_url  TEXT NOT NULL,
    texto       VARCHAR(160) DEFAULT '',
    creado_en   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reels (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    video_url   TEXT NOT NULL,
    descripcion VARCHAR(200) DEFAULT '',
    etiquetas   TEXT DEFAULT '',        -- categorías del reel separadas por coma
    expira_en   TIMESTAMP DEFAULT (NOW() + INTERVAL '3 days'),
    creado_en   TIMESTAMP DEFAULT NOW()
);
ALTER TABLE reels ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP DEFAULT (NOW() + INTERVAL '3 days');
ALTER TABLE reels ADD COLUMN IF NOT EXISTS etiquetas TEXT DEFAULT '';

-- ============ NUEVO: reacciones, comentarios y seguidores ============

-- Likes en publicaciones, reels e historias
CREATE TABLE IF NOT EXISTS likes (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('post','reel','historia')),
    item_id     INT NOT NULL,
    creado_en   TIMESTAMP DEFAULT NOW(),
    UNIQUE (usuario_id, tipo, item_id)
);

-- Comentarios en publicaciones y reels
CREATE TABLE IF NOT EXISTS comentarios (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('post','reel')),
    item_id     INT NOT NULL,
    texto       VARCHAR(300) NOT NULL,
    creado_en   TIMESTAMP DEFAULT NOW()
);

-- Seguidores (quién sigue a quién)
CREATE TABLE IF NOT EXISTS seguidores (
    seguidor_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
    seguido_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en   TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (seguidor_id, seguido_id),
    CHECK (seguidor_id <> seguido_id)
);

-- Reacciones con emojis (aparte del like)
CREATE TABLE IF NOT EXISTS reacciones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(10) NOT NULL,   -- post, reel
    item_id     INT NOT NULL,
    emoji       VARCHAR(8) NOT NULL,
    creado_en   TIMESTAMP DEFAULT NOW(),
    UNIQUE (usuario_id, tipo, item_id)
);

-- Notificaciones (likes, comentarios, seguidores, contenido nuevo)
-- Relaciones entre usuarios (amistad, noviazgo, familia)
CREATE TABLE IF NOT EXISTS relaciones (
    id          SERIAL PRIMARY KEY,
    de_id       INT REFERENCES usuarios(id) ON DELETE CASCADE,
    para_id     INT REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(20) NOT NULL,   -- amistad, noviazgo, familia
    estado      VARCHAR(12) DEFAULT 'pendiente',  -- pendiente, aceptada
    creado_en   TIMESTAMP DEFAULT NOW(),
    UNIQUE (de_id, para_id)
);

-- Mensajes directos entre usuarios
CREATE TABLE IF NOT EXISTS mensajes (
    id          SERIAL PRIMARY KEY,
    de_id       INT REFERENCES usuarios(id) ON DELETE CASCADE,
    para_id     INT REFERENCES usuarios(id) ON DELETE CASCADE,
    texto       TEXT NOT NULL,
    leido       BOOLEAN DEFAULT FALSE,
    creado_en   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_par ON mensajes (de_id, para_id, creado_en);

CREATE TABLE IF NOT EXISTS notificaciones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,  -- a quién le llega
    actor_id    INT REFERENCES usuarios(id) ON DELETE CASCADE,  -- quién la generó
    tipo        VARCHAR(20) NOT NULL,   -- like, comentario, seguidor, post, reel, historia
    texto       VARCHAR(200) NOT NULL,
    leida       BOOLEAN DEFAULT FALSE,
    creado_en   TIMESTAMP DEFAULT NOW()
);

-- Categorías vistas (personaliza el quiz)
CREATE TABLE IF NOT EXISTS vistas (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    categoria   VARCHAR(40) NOT NULL,
    visto_en    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_preguntas (
    id          SERIAL PRIMARY KEY,
    categoria   VARCHAR(40) NOT NULL,
    pregunta    TEXT NOT NULL,
    opcion_a    TEXT NOT NULL,
    opcion_b    TEXT NOT NULL,
    opcion_c    TEXT NOT NULL,
    opcion_d    TEXT NOT NULL,
    correcta    CHAR(1) NOT NULL CHECK (correcta IN ('a','b','c','d'))
);

CREATE TABLE IF NOT EXISTS quiz_resultados (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,
    categoria   VARCHAR(40) NOT NULL,
    puntaje     INT NOT NULL,
    total       INT NOT NULL,
    fecha       TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Preguntas de quiz: 10 por categoría, educativas sobre El Salvador
-- (solo se insertan si la tabla está vacía)
-- ============================================================
INSERT INTO quiz_preguntas (categoria, pregunta, opcion_a, opcion_b, opcion_c, opcion_d, correcta)
SELECT * FROM (VALUES
-- ===== CIENCIA =====
('Ciencia','¿Cuál es el volcán más alto de El Salvador?','Volcán de Izalco','Volcán de Santa Ana (Ilamatepec)','Volcán de San Miguel','Volcán de San Salvador','b'),
('Ciencia','¿Cómo se le conoce a El Salvador por su actividad volcánica y sísmica?','Tierra de Lagos','Valle de las Hamacas','Tierra de Volcanes','País Verde','c'),
('Ciencia','¿Cuál es el lago de origen volcánico más grande de El Salvador?','Lago de Ilopango','Lago de Coatepeque','Laguna de Olomega','Lago de Güija','a'),
('Ciencia','¿Qué institución estudia los sismos y volcanes en El Salvador?','MARN','ANDA','MINSAL','CEL','a'),
('Ciencia','¿Cuál es el ave nacional de El Salvador?','El Quetzal','El Torogoz (Talapo)','El Colibrí','La Guacamaya','b'),
('Ciencia','¿Cuál es la flor nacional de El Salvador?','La Rosa','El Izote','La Orquídea','El Girasol','b'),
('Ciencia','¿Cuál es el árbol nacional de El Salvador?','El Maquilishuat','El Bálsamo','El Conacaste','El Cedro','b'),
('Ciencia','¿En qué región del planeta se ubica El Salvador, propensa a terremotos?','Cinturón de Fuego del Pacífico','Cordillera de los Andes','Amazonía','Sahel','a'),
('Ciencia','¿Cuál es el río más largo de El Salvador?','Río Grande de San Miguel','Río Lempa','Río Paz','Río Goascorán','b'),
('Ciencia','¿Qué energía limpia se genera en la zona de Ahuachapán y Berlín?','Solar','Eólica','Geotérmica','Nuclear','c'),
-- ===== CULTURA =====
('Cultura','¿Cuál es el plato típico más famoso de El Salvador?','La pupusa','El tamal','La baleada','El casamiento','a'),
('Cultura','¿Qué día se celebra el Día Nacional de la Pupusa?','Primer domingo de noviembre','13 de noviembre','Segundo domingo de noviembre','1 de noviembre','c'),
('Cultura','¿Cómo se llama la moneda tradicional salvadoreña antes del dólar?','Peso','Colón','Quetzal','Lempira','b'),
('Cultura','¿Qué escritor salvadoreño es autor de "Cuentos de Barro"?','Roque Dalton','Salarrué','Claudia Lars','Manlio Argueta','b'),
('Cultura','¿Cuál es una bebida tradicional salvadoreña hecha de maíz?','El atol de elote','El horchata de Jamaica','El café con leche','La chicha de uva','a'),
('Cultura','¿Qué festividad religiosa importante se celebra en agosto en San Salvador?','Las Bolas de Fuego','Las Fiestas Agostinas','La Calabiuza','El Carnaval','b'),
('Cultura','¿En qué pueblo se realiza la tradición de "Las Bolas de Fuego"?','Nejapa','Suchitoto','Panchimalco','Izalco','a'),
('Cultura','¿Qué poeta salvadoreño escribió "Poema de Amor"?','Salarrué','Roque Dalton','Francisco Gavidia','David Escobar Galindo','b'),
('Cultura','¿Cuál es un dulce típico salvadoreño hecho con leche?','El dulce de panela','Los nuégados','El arroz con leche','Todas las anteriores','d'),
('Cultura','¿Qué artesanía es famosa del pueblo de La Palma, Chalatenango?','Hamacas','Artesanías de madera coloridas (estilo Llort)','Cerámica negra','Tejidos de algodón','b'),
-- ===== DEPORTES =====
('Deportes','¿Cuál es el deporte más popular en El Salvador?','Baloncesto','Fútbol','Béisbol','Voleibol','b'),
('Deportes','¿Cómo se le conoce a la Selección Nacional de Fútbol de El Salvador?','La Azul','La Selecta','Los Cuscatlecos','Todas las anteriores','d'),
('Deportes','¿En qué Copas del Mundo ha participado El Salvador?','1970 y 1982','1990 y 1994','2002 y 2006','Nunca ha clasificado','a'),
('Deportes','¿En qué estadio juega de local la Selecta en San Salvador?','Estadio Las Delicias','Estadio Cuscatlán','Estadio Jorge Mágico González','Estadio Quiteño','b'),
('Deportes','¿Quién fue "Mágico" González, leyenda del fútbol salvadoreño?','Jorge Alberto González','Raúl Díaz Arce','Jaime Rodríguez','Mauricio Cienfuegos','a'),
('Deportes','¿Qué surfista salvadoreña ha destacado a nivel internacional?','Katherine Díaz','Marcela Valladares','Ana Menéndez','Sofía Ramírez','a'),
('Deportes','¿Por qué El Salvador es reconocido en el surf mundial?','Sus olas en la costa del Pacífico (El Tunco, El Sunzal)','Sus piscinas olímpicas','Sus ríos','Sus lagos','a'),
('Deportes','¿Qué evento internacional de surf se ha realizado en El Salvador?','Mundial ISA Surf','Copa América','Juegos Olímpicos','Mundial de Atletismo','a'),
('Deportes','¿En qué deporte de playa también compite El Salvador?','Hockey','Vóleibol de playa','Esquí','Curling','b'),
('Deportes','¿Cómo se llama el clásico del fútbol salvadoreño entre los equipos más populares?','Clásico Nacional (Águila vs FAS)','El Derbi Capitalino','El Súper Clásico','El Clásico del Pacífico','a'),
-- ===== ECONOMÍA =====
('Economía','¿Qué moneda usa actualmente El Salvador junto al dólar desde 2021?','Euro','Bitcoin','Peso','Quetzal','b'),
('Economía','¿En qué año adoptó El Salvador el dólar estadounidense como moneda?','2001','2005','1999','2010','a'),
('Economía','¿Cuál es uno de los principales productos de exportación tradicional de El Salvador?','El café','El petróleo','El trigo','El oro','a'),
('Economía','¿Qué representan una parte importante de la economía salvadoreña, enviadas por compatriotas?','Las remesas','Las regalías','Los impuestos','Las donaciones','a'),
('Economía','¿Cuál es la capital y centro económico de El Salvador?','Santa Ana','San Miguel','San Salvador','La Libertad','c'),
('Economía','¿Qué producto agrícola es tradicional en la economía rural salvadoreña?','El maíz','El arroz','La caña de azúcar','Todas las anteriores','d'),
('Economía','¿Qué puerto es importante para el comercio en El Salvador?','Puerto de Acajutla','Puerto de Veracruz','Puerto de Colón','Puerto Cortés','a'),
('Economía','¿Qué sector ha crecido como fuente de ingresos por las playas y volcanes?','El turismo','La minería','La pesca de altura','La ganadería','a'),
('Economía','¿Cómo se llama el aeropuerto internacional principal de El Salvador?','Aeropuerto de Ilopango','Aeropuerto Internacional de El Salvador (Monseñor Romero)','Aeropuerto de Comalapa Norte','Aeropuerto de San Miguel','b'),
('Economía','¿Qué institución emite los reportes económicos oficiales del país?','Banco Central de Reserva','La Bolsa de Nueva York','El FMI','La ONU','a'),
-- ===== EDUCACIÓN =====
('Educación','¿Cómo se llama el ministerio encargado de la educación en El Salvador?','MINED (Ministerio de Educación)','MINSAL','MARN','MOP','a'),
('Educación','¿Cuál es la universidad pública más antigua de El Salvador?','UCA','Universidad de El Salvador (UES)','UTEC','Universidad Don Bosco','b'),
('Educación','¿En qué año se fundó la Universidad de El Salvador?','1841','1900','1950','1810','a'),
('Educación','¿Cuántos años dura la educación básica en El Salvador?','6 años','9 años','12 años','3 años','b'),
('Educación','¿Cómo se llama el nivel educativo antes de la universidad en El Salvador?','Bachillerato','Preparatoria','Secundaria','Liceo','a'),
('Educación','¿Qué prueba evaluaba a los estudiantes de bachillerato (hasta años recientes)?','PAES','SAT','ICFES','ENLACE','a'),
('Educación','¿Qué idioma se habla oficialmente en El Salvador?','Inglés','Español','Náhuat','Portugués','b'),
('Educación','¿Qué lengua indígena se intenta preservar en El Salvador?','El Maya','El Náhuat (Pipil)','El Quechua','El Lenca','b'),
('Educación','¿Qué programa entrega útiles y uniformes gratuitos en escuelas públicas?','Paquetes Escolares','Beca Universal','Plan Lector','Escuela Abierta','a'),
('Educación','¿Cuántos departamentos tiene El Salvador, dato básico que se enseña en la escuela?','12','14','16','10','b'),
-- ===== ENTRETENIMIENTO =====
('Entretenimiento','¿Qué género musical tradicional acompaña las fiestas salvadoreñas?','La cumbia','El tango','El flamenco','El reggae','a'),
('Entretenimiento','¿Qué instrumento es típico de la música folclórica salvadoreña?','La marimba','El violín','El arpa','La gaita','a'),
('Entretenimiento','¿Cómo se llama el muñeco gigante tradicional de las fiestas salvadoreñas?','El Gigante y la Gigantona','El Torito Pinto','La Carreta Chillona','Ambos a y b','d'),
('Entretenimiento','¿Qué festival de música y cultura es popular entre jóvenes salvadoreños?','Festivales en pueblos vivos','Coachella','Tomorrowland','Rock al Parque','a'),
('Entretenimiento','¿Qué leyenda salvadoreña habla de una mujer que asusta a los hombres de noche?','La Siguanaba','La Llorona','La Sayona','La Tunda','a'),
('Entretenimiento','¿Qué personaje de leyenda salvadoreña es un niño con sombrero grande?','El Cipitío','El Duende','El Sombrerón','El Cadejo','a'),
('Entretenimiento','¿Qué criatura mítica protege (blanco) o asusta (negro) a los viajeros nocturnos?','El Cadejo','La Carreta','El Justo Juez','La Descarnada','a'),
('Entretenimiento','¿Qué red social usan mucho los jóvenes salvadoreños para tendencias?','TikTok','LinkedIn','Pinterest','Reddit','a'),
('Entretenimiento','¿Qué tipo de música urbana es muy escuchada por la juventud actual?','El reguetón','La ópera','El jazz clásico','La zarzuela','a'),
('Entretenimiento','¿Qué pueblo es famoso por su Ruta de las Flores y eventos culturales?','Nahuizalco y Juayúa','Soyapango','Apopa','Mejicanos','a'),
-- ===== MUNDO =====
('Mundo','¿En qué continente se encuentra El Salvador?','América (Centroamérica)','Europa','Asia','África','a'),
('Mundo','¿Con qué países comparte frontera El Salvador?','Guatemala y Honduras','México y Belice','Nicaragua y Costa Rica','Panamá y Colombia','a'),
('Mundo','¿Qué océano baña las costas de El Salvador?','Atlántico','Pacífico','Índico','Ártico','b'),
('Mundo','¿A qué organización regional centroamericana pertenece El Salvador?','SICA','Unión Europea','ASEAN','OTAN','a'),
('Mundo','¿Es El Salvador el país más pequeño de Centroamérica en territorio?','Sí','No','Es el más grande','Es del tamaño de México','a'),
('Mundo','¿Cómo se le llama a El Salvador por su tamaño y energía?','El Pulgarcito de América','El Gigante del Norte','La Perla del Caribe','El Corazón Verde','a'),
('Mundo','¿Qué huso horario usa El Salvador?','GMT-6','GMT+1','GMT-3','GMT 0','a'),
('Mundo','¿A qué organización mundial pertenece El Salvador desde 1945?','La ONU','La OTAN','La Unión Africana','El G7','a'),
('Mundo','¿Cuál es la capital de Guatemala, país vecino de El Salvador?','Tegucigalpa','Ciudad de Guatemala','Managua','San José','b'),
('Mundo','¿Cuál es la capital de Honduras, país vecino de El Salvador?','Tegucigalpa','San Pedro Sula','Comayagua','La Ceiba','a'),
-- ===== POLÍTICA =====
('Política','¿Cuál es la forma de gobierno de El Salvador?','República democrática','Monarquía','Dictadura militar','Imperio','a'),
('Política','¿Cada cuántos años se elige al presidente de El Salvador?','3 años','5 años','4 años','6 años','b'),
('Política','¿Cómo se llama el órgano que hace las leyes en El Salvador?','Asamblea Legislativa','El Senado','La Cámara de Lores','El Congreso de Diputados','a'),
('Política','¿Cuántos órganos del Estado existen en El Salvador?','Tres (Ejecutivo, Legislativo, Judicial)','Dos','Cuatro','Uno','a'),
('Política','¿Qué documento es la ley máxima de El Salvador?','La Constitución','El Código Penal','La Biblia','El Reglamento','a'),
('Política','¿En qué año se firmaron los Acuerdos de Paz en El Salvador?','1992','1980','2000','1975','a'),
('Política','¿Dónde se firmaron los Acuerdos de Paz de El Salvador?','Castillo de Chapultepec, México','Casa Blanca, EE.UU.','Palacio Nacional','La ONU en Ginebra','a'),
('Política','¿Cómo se llama el documento de identidad de los salvadoreños?','DUI','INE','Cédula','Pasaporte interno','a'),
('Política','¿Qué institución organiza las elecciones en El Salvador?','TSE (Tribunal Supremo Electoral)','La Asamblea','La Corte Suprema','El MINED','a'),
('Política','¿Qué color predomina en la bandera de El Salvador?','Azul y blanco','Rojo y negro','Verde y amarillo','Naranja','a'),
-- ===== SALUD =====
('Salud','¿Cuántas horas de sueño se recomiendan para un adolescente?','4-5 horas','8-10 horas','2-3 horas','12-14 horas','b'),
('Salud','¿Qué ministerio se encarga de la salud pública en El Salvador?','MINSAL','MINED','MARN','MOP','a'),
('Salud','¿Qué enfermedad transmitida por zancudos es común en temporada lluviosa?','El dengue','La gripe común','La varicela','El sarampión','a'),
('Salud','¿Qué se recomienda eliminar para evitar criaderos de zancudos?','Agua estancada','Plantas','Comida','Basura reciclable','a'),
('Salud','¿Qué hábito mejora la salud mental de los jóvenes?','Hacer ejercicio y dormir bien','Pasar toda la noche despierto','Saltarse comidas','Aislarse siempre','a'),
('Salud','¿Qué bebida es más saludable para hidratarse?','El agua','Las gaseosas','Las bebidas energéticas','El alcohol','a'),
('Salud','¿Cada cuánto se recomienda lavarse las manos para prevenir enfermedades?','Frecuentemente, sobre todo antes de comer','Una vez al día','Una vez por semana','Nunca','a'),
('Salud','¿Qué alimento es rico en vitaminas y se cultiva en El Salvador?','Las frutas tropicales (mango, jocote)','Las golosinas','Los frituras','Los refrescos','a'),
('Salud','¿Qué institución brinda atención médica a trabajadores en El Salvador?','El ISSS','El MINED','El TSE','La ANDA','a'),
('Salud','¿Qué es importante para una buena salud según los expertos?','Alimentación balanceada y ejercicio','Comer solo dulces','No dormir','Estar siempre sentado','a'),
-- ===== HISTORIA / GENERAL =====
('Historia','¿En qué año se independizó El Salvador de España?','1821','1492','1900','1950','a'),
('Historia','¿Quién es considerado prócer de la independencia salvadoreña?','José Matías Delgado','Cristóbal Colón','Simón Bolívar','Benito Juárez','a'),
('Historia','¿Cómo se llamaba el territorio salvadoreño en la época prehispánica?','Cuscatlán','Tenochtitlán','El Dorado','Tikal','a'),
('Historia','¿Qué pueblo indígena habitaba el territorio salvadoreño?','Los Pipiles','Los Incas','Los Mayas únicamente','Los Aztecas','a'),
('Historia','¿Qué sitio arqueológico salvadoreño es Patrimonio de la Humanidad?','Joya de Cerén','Machu Picchu','Chichén Itzá','Tikal','a'),
('Historia','¿Por qué Joya de Cerén es famosa mundialmente?','Es la "Pompeya de América" preservada por ceniza volcánica','Por sus pirámides altas','Por su oro','Por sus playas','a'),
('Historia','¿Quién fue Monseñor Óscar Arnulfo Romero?','Un arzobispo defensor de los derechos humanos','Un futbolista','Un presidente','Un cantante','a'),
('Historia','¿En qué año fue canonizado (declarado santo) Monseñor Romero?','2018','2000','1990','2010','a'),
('Historia','¿Qué se conmemora cada 15 de septiembre en El Salvador?','La Independencia de Centroamérica','El Día del Trabajo','La Navidad','El Día de la Madre','a'),
('Historia','¿Qué prócer salvadoreño es llamado "El Padre de la Patria"?','José Matías Delgado','Gerardo Barrios','Manuel José Arce','Francisco Morazán','a')
) AS v(categoria,pregunta,opcion_a,opcion_b,opcion_c,opcion_d,correcta)
WHERE NOT EXISTS (SELECT 1 FROM quiz_preguntas);
