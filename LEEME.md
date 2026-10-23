# Simulador comercial Fabcom (versión Node.js para Vercel)

Landing con simulador (arena sílice frente a abrasivos libres de sílice), informe PDF, correo automático y CRM propio con módulo de administración.

Es la misma aplicación de la versión PHP, adaptada a Node.js: el frontend no cambió y el CRM, los cálculos, el PDF y los correos funcionan igual. Las direcciones también son las mismas (`/admin/`, `/pdf.php`, `/api/simular.php`…).

## Qué cambia frente a la versión PHP

| Antes (PHP) | Ahora (Vercel) | Por qué |
|---|---|---|
| Base de datos en un archivo SQLite dentro del hosting | Base de datos **Turso** (SQLite en la nube, plan gratuito) | Vercel no guarda archivos entre una visita y otra |
| Si no había SMTP, se intentaba con el correo del hosting | El **SMTP es obligatorio** | Vercel no tiene correo propio |
| PDF con FPDF | PDF con PDFKit, con el mismo diseño | Librería equivalente en Node.js |
| `config.php` opcional | Variables de entorno en Vercel | Forma estándar de configurar en Vercel |

## 1. Crear la base de datos en Turso

1. Cree una cuenta gratuita en https://turso.tech e instale su consola, o use el panel web.
2. Cree una base de datos, por ejemplo `simulador-fabcom`, en la región más cercana (por ejemplo, `aws-us-east-1`).
3. Copie dos datos:
   - La **URL** de la base: empieza por `libsql://…turso.io`.
   - Un **token** de acceso: en el panel, «Create Token» (o `turso db tokens create simulador-fabcom`).

No hace falta crear tablas: el sistema las crea solo la primera vez que se abre.

## 2. Subir el proyecto a Vercel

1. Suba esta carpeta a un repositorio de GitHub (sin `node_modules`; el `.gitignore` ya lo excluye).
2. En https://vercel.com, «Add New → Project», elija el repositorio. Vercel lee `vercel.json` y `package.json`: no cambie el «Framework Preset» (debe quedar en «Other») ni los comandos.
3. Antes de publicar, en **Environment Variables** agregue:

   | Variable | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | La URL `libsql://…` de Turso |
   | `TURSO_AUTH_TOKEN` | El token de Turso |
   | `BASE_URL` (opcional) | La dirección pública, por ejemplo `https://simulador.fabcomsas.com`. Se usa en los enlaces de los correos y en el enlace personal de cada asesor. |

4. «Deploy». Para usar un dominio propio: Project → Settings → Domains.

También puede publicarse desde la terminal con `npx vercel` y `npx vercel --prod`.

## 3. Primer ingreso y configuración

1. Abra `https://su-dominio/admin/`. En el primer ingreso el sistema pide crear la contraseña de `administrador@fabcomsas.com`. **Hágalo apenas publique**: quien entre primero define esa contraseña.
2. En **Usuarios**, escriba una contraseña para cada asesor (`comercial@`, `comercial.2@`, `comercial.3@`). Mientras no tengan contraseña no pueden ingresar, pero sí reciben alertas.
3. En **Ajustes → Correo saliente**, escriba los datos SMTP de `administrador@fabcomsas.com` y use «Enviarme un correo de prueba». Sin SMTP no salen ni el PDF ni las alertas.
4. En **Usuarios**, pegue el enlace de la agenda de Google Calendar de cada asesor (un «Horario de citas» creado en Google Calendar).
5. En **Ajustes → Empresa y contacto**, escriba el WhatsApp comercial, el teléfono, el sitio web y el enlace a la política de tratamiento de datos.

Nota sobre el correo: Vercel no permite el puerto 25. Use el puerto 587 (STARTTLS) o 465 (SSL), que son los que dan Google Workspace, Microsoft 365 y los hostings de correo.

## Probar en su computador

Necesita Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abra http://localhost:3000 (simulador) y http://localhost:3000/admin/ (CRM). Sin variables de Turso, usa el archivo local `datos/local.db`. Para probar contra la base de Turso, cree un archivo `.env` a partir de `.env.example` y ejecute `node --env-file=.env scripts/local.js`.

## Qué hay en cada parte

| Ruta | Para qué sirve |
|---|---|
| `public/` | Landing pública con el simulador: HTML, estilos, scripts, tipografía e imágenes |
| `api/index.js` | Función de Vercel que atiende todas las rutas dinámicas |
| `server/app.js` | Rutas: `/api/*.php`, `/pdf.php` y `/admin/*.php` |
| `server/api.js` | Registro, simulación y acciones del cliente |
| `server/admin.js` | Páginas del CRM y la administración |
| `server/engine.js` | Motor de cálculo |
| `server/db.js` | Base de datos (Turso / SQLite), tablas y datos iniciales |
| `server/pdf.js` | Informe PDF del cliente |
| `server/mailer.js` | Correos al cliente y alertas a los asesores |
| `server/auth.js` | Sesión del CRM, protección de formularios y plantilla del panel |
| `server/recursos/` | Tipografía Poppins y logotipos para el PDF |
| `scripts/local.js` | Servidor para probar en el computador |
| `vercel.json` | Configuración de Vercel: rutas, función y encabezados |

## Uso diario

- **Leads**: cada persona que completa el simulador. Se asignan por turnos entre los usuarios con «Recibe leads» y a cada uno le llega una alerta por correo.
- **Simular con un cliente**: para reuniones o llamadas. Permite elegir producto y precio especial.
- **Marketing**: embudo, sectores, fuentes de tráfico (UTM), tamaños de proyecto. «Descargar todo en CSV» abre en Excel.
- **Productos y precios**: precio por kg, velocidad y consumo frente a la arena, número de usos y matriz de recomendación.
- **Parámetros**: costos por defecto del cliente, bases técnicas, tasas de cambio y tabla de rendimiento con arena. Cada valor lleva su fuente.

Clientes actuales: en el formulario el cliente marca «Sí, ya tengo asesor» y elige su nombre; las alertas y cada simulación le llegan a ese asesor y no entran en la rotación. Cada asesor tiene un enlace personal (`?asesor=ID`, visible en Usuarios y en Mi cuenta) que deja su nombre ya elegido.

Para medir campañas, enlace la landing con parámetros UTM, por ejemplo:
`https://su-dominio/?utm_source=google&utm_medium=cpc&utm_campaign=arena-silice`

## Qué ve el cliente y qué ve el asesor

- El cliente nunca ve precios de Fabcom. Ve tiempos, combustible, CO₂, residuos y el costo como porcentaje.
- Al cliente se le muestran las filas en las que el abrasivo Fabcom es mejor. El asesor ve todas en la ficha del lead, con el costo total real y el precio de equilibrio.
- Si el costo total con abrasivo no favorece a Fabcom, el cliente ve el ahorro en costo de operación (mano de obra, combustible y disposición) con la nota «no incluye el valor del abrasivo».

## Seguridad

- La sesión del CRM viaja en una cookie firmada; la clave de firma se genera al instalar y se guarda en la base de datos. Para cerrar todas las sesiones abiertas, defina la variable `SESSION_SECRET` en Vercel con un texto largo al azar y vuelva a publicar.
- Las contraseñas se guardan cifradas con bcrypt.
- Los formularios del CRM llevan protección CSRF y el ingreso se bloquea 15 minutos tras 8 intentos fallidos.

## Copias de seguridad

Toda la información (leads, simulaciones, precios, usuarios y la contraseña SMTP) está en la base de Turso. Desde el panel de Turso o con `turso db shell simulador-fabcom .dump > respaldo.sql` puede descargar una copia.

## Licencias de terceros

Express, PDFKit, Nodemailer, bcryptjs y @libsql/client (licencias MIT / Apache 2.0) y Poppins (SIL Open Font License, `public/assets/fonts/OFL.txt`).
