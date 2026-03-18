import http from 'node:http';
import https from 'node:https';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const GITHUB_USER = process.env.GITHUB_USER || 'ncolex';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.API_KEY || '';
const APIHUB33_BASE_URL = process.env.APIHUB33_BASE_URL || '';
const APIHUB33_API_KEY = process.env.APIHUB33_API_KEY || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = path.join(__dirname, '..', 'data', 'fallback-repos.json');
const FALLBACK_REPOS = (() => {
  try {
    const contents = readFileSync(FALLBACK_PATH, 'utf-8');
    return JSON.parse(contents);
  } catch (error) {
    console.warn('No se pudo cargar el fallback de repositorios:', error);
    return [];
  }
})();

let cachedRepos = null;
let cacheTimestamp = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const lib = requestUrl.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        ...options,
        hostname: requestUrl.hostname,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Personalizacion33-App',
          Accept: 'application/vnd.github+json',
          ...(options.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error('Respuesta JSON inválida de GitHub.'));
            }
          } else {
            reject(new Error(`GitHub respondió con ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

function ensureLeadingSlash(value) {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function readJsonBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error('El cuerpo de la solicitud excede el límite permitido.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed);
      } catch (error) {
        reject(new Error('No se pudo interpretar el cuerpo JSON.'));
      }
    });

    req.on('error', reject);
  });
}

async function fetchRepos() {
  const now = Date.now();
  if (cachedRepos && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRepos;
  }

  try {
    const data = await fetchJson(
      `https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=100`
    );
    cachedRepos = data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      description: repo.description,
      language: repo.language,
      html_url: repo.html_url,
      homepage: repo.homepage,
      updated_at: repo.updated_at,
    }));
    cacheTimestamp = now;
    return cachedRepos;
  } catch (error) {
    console.error('Fallo al consultar GitHub:', error.message);
    const fallback = cachedRepos && cachedRepos.length ? cachedRepos : FALLBACK_REPOS;
    cachedRepos = fallback;
    cacheTimestamp = now;
    return fallback;
  }
}

function buildApiHub33Url(endpoint = 'health') {
  const sanitizedEndpoint = String(endpoint || '')
    .replace(/^\//, '')
    .trim();

  const base = APIHUB33_BASE_URL.endsWith('/')
    ? APIHUB33_BASE_URL
    : `${APIHUB33_BASE_URL}/`;

  return new URL(sanitizedEndpoint || 'health', base);
}

async function fetchApiHub33(endpoint = 'health') {
  if (!APIHUB33_BASE_URL) {
    throw new Error('Falta la variable de entorno APIHUB33_BASE_URL.');
  }

  const target = buildApiHub33Url(endpoint);
  const headers = APIHUB33_API_KEY
    ? {
        Authorization: `Bearer ${APIHUB33_API_KEY}`,
      }
    : {};

  return fetchJson(target.toString(), { headers });
}

function getPublicConfig() {
  return {
    githubUser: GITHUB_USER,
    cacheTtlMs: CACHE_TTL_MS,
    geminiEnabled: Boolean(GEMINI_API_KEY),
    geminiStatusMessage: GEMINI_API_KEY
      ? 'Gemini está listo para generar texto desde el servidor.'
      : 'Gemini está deshabilitado hasta configurar GEMINI_API_KEY o API_KEY en el servidor.',
    apiHub33Enabled: Boolean(APIHUB33_BASE_URL),
  };
}

function renderHtml(repos) {
  const geminiEnabled = Boolean(GEMINI_API_KEY);
  const items = repos
    .map(
      (repo) => `
      <article class="repo-card">
        <div class="repo-card__header">
          <h2><a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.name)}</a></h2>
          <span class="repo-card__badge">${escapeHtml(repo.language || 'Sin stack definido')}</span>
        </div>
        <p>${escapeHtml(repo.description || 'Sin descripción disponible.')}</p>
        <div class="repo-card__meta">
          <span><strong>Actualizado:</strong> ${escapeHtml(new Date(repo.updated_at).toLocaleString())}</span>
          ${repo.homepage ? `<a href="${escapeHtml(repo.homepage)}" target="_blank" rel="noopener noreferrer">Ver demo</a>` : ''}
        </div>
      </article>`
    )
    .join('\n');

  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Repositorios de ${escapeHtml(GITHUB_USER)}</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #020617;
          --panel: rgba(15, 23, 42, 0.92);
          --panel-border: rgba(148, 163, 184, 0.18);
          --text: #e2e8f0;
          --muted: #94a3b8;
          --accent: #38bdf8;
          --accent-strong: #0ea5e9;
          --success: #22c55e;
          --warning: #f59e0b;
          --shadow: 0 20px 45px rgba(2, 6, 23, 0.45);
        }
        * { box-sizing: border-box; }
        body {
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          margin: 0;
          min-height: 100vh;
          background:
            radial-gradient(circle at top, rgba(14, 165, 233, 0.18), transparent 32%),
            linear-gradient(180deg, #020617 0%, #0f172a 100%);
          color: var(--text);
        }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .container {
          width: min(1100px, calc(100% - 2rem));
          margin: 0 auto;
          padding: 2rem 0 3rem;
        }
        .hero, .panel, .repo-card {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 1.25rem;
          box-shadow: var(--shadow);
          backdrop-filter: blur(12px);
        }
        .hero {
          padding: 2rem;
          display: grid;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        .hero h1 {
          font-size: clamp(2rem, 3vw, 3rem);
          margin: 0;
        }
        .hero p, .panel p, .repo-card p, footer {
          color: var(--muted);
          line-height: 1.6;
        }
        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1rem;
        }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          width: fit-content;
          padding: 0.45rem 0.8rem;
          border-radius: 999px;
          font-size: 0.95rem;
          background: rgba(15, 23, 42, 0.75);
          border: 1px solid var(--panel-border);
        }
        .status-dot {
          width: 0.65rem;
          height: 0.65rem;
          border-radius: 999px;
          background: var(--warning);
        }
        .status-dot--ok { background: var(--success); }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 1.5rem;
          align-items: start;
          margin-bottom: 1.5rem;
        }
        .panel { padding: 1.5rem; }
        .panel h2 { margin-top: 0; }
        .repo-list {
          display: grid;
          gap: 1rem;
        }
        .repo-card {
          padding: 1.25rem;
        }
        .repo-card__header, .repo-card__meta {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        .repo-card__header h2 { margin: 0; font-size: 1.15rem; }
        .repo-card__badge {
          border-radius: 999px;
          border: 1px solid rgba(56, 189, 248, 0.35);
          background: rgba(56, 189, 248, 0.12);
          color: #bae6fd;
          padding: 0.3rem 0.7rem;
          font-size: 0.85rem;
        }
        textarea {
          width: 100%;
          min-height: 160px;
          resize: vertical;
          border-radius: 1rem;
          border: 1px solid var(--panel-border);
          padding: 1rem;
          background: rgba(2, 6, 23, 0.6);
          color: var(--text);
          font: inherit;
        }
        button {
          appearance: none;
          border: none;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
          color: #e0f2fe;
          font: inherit;
          font-weight: 600;
          padding: 0.8rem 1.2rem;
          cursor: pointer;
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .helper-text {
          font-size: 0.95rem;
          color: var(--muted);
        }
        pre {
          white-space: pre-wrap;
          word-break: break-word;
          border-radius: 1rem;
          background: rgba(2, 6, 23, 0.7);
          border: 1px solid var(--panel-border);
          padding: 1rem;
          min-height: 120px;
          margin-bottom: 0;
        }
        footer {
          margin-top: 1.5rem;
          text-align: center;
          font-size: 0.95rem;
        }
        @media (max-width: 880px) {
          .grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <main class="container">
        <section class="hero">
          <div>
            <span class="status-pill"><span class="status-dot status-dot--ok"></span>Sin Tailwind CDN en producción</span>
          </div>
          <div>
            <h1>Proyectos públicos de ${escapeHtml(GITHUB_USER)}</h1>
            <p>Esta portada usa CSS integrado y una integración opcional con Gemini que se ejecuta del lado del servidor, evitando exponer claves en el navegador.</p>
          </div>
          <div class="status-grid">
            <div class="panel">
              <h2>Estado de GitHub</h2>
              <p>Caché activo durante ${escapeHtml(String(Math.round(CACHE_TTL_MS / 1000)))} segundos para reducir llamadas repetidas a la API pública.</p>
            </div>
            <div class="panel">
              <h2>Estado de Gemini</h2>
              <p>${escapeHtml(
                geminiEnabled
                  ? 'Gemini está habilitado. Usa el formulario para probar el endpoint protegido por el servidor.'
                  : 'Gemini está deshabilitado. Configura GEMINI_API_KEY o API_KEY en el servidor para activar el formulario.'
              )}</p>
            </div>
          </div>
        </section>

        <section class="grid">
          <section class="panel">
            <h2>Generar texto con Gemini</h2>
            <p class="helper-text">El navegador nunca necesita conocer la clave. Si la variable no existe, el botón queda desactivado y la interfaz evita mostrar errores innecesarios en consola.</p>
            <form id="gemini-form">
              <label for="prompt">Prompt</label>
              <textarea id="prompt" name="prompt" placeholder="Resume en dos líneas qué hace este portafolio de repositorios."></textarea>
              <div style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; margin-top:1rem;">
                <button type="submit" ${geminiEnabled ? '' : 'disabled'}>${geminiEnabled ? 'Generar respuesta' : 'Gemini no configurado'}</button>
                <span class="helper-text" id="gemini-status">${escapeHtml(
                  geminiEnabled
                    ? 'Gemini listo para responder.'
                    : 'Falta GEMINI_API_KEY o API_KEY en el servidor.'
                )}</span>
              </div>
            </form>
            <pre id="gemini-output">${escapeHtml(
              geminiEnabled
                ? 'La respuesta aparecerá aquí.'
                : 'La generación está desactivada hasta que exista una clave de Gemini en el entorno del servidor.'
            )}</pre>
          </section>

          <section class="panel">
            <h2>Configuración pública</h2>
            <pre>${escapeHtml(JSON.stringify(getPublicConfig(), null, 2))}</pre>
          </section>
        </section>

        <section class="repo-list">
          ${items || '<div class="panel"><p>No hay repositorios públicos disponibles.</p></div>'}
        </section>

        <footer>
          Datos actualizados cada ${escapeHtml(String(Math.round(CACHE_TTL_MS / 1000)))} segundos.
        </footer>
      </main>
      <script>
        const form = document.getElementById('gemini-form');
        const output = document.getElementById('gemini-output');
        const status = document.getElementById('gemini-status');
        const promptField = document.getElementById('prompt');
        const button = form?.querySelector('button');
        const geminiEnabled = ${JSON.stringify(geminiEnabled)};

        if (form && output && status && promptField && button && geminiEnabled) {
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const prompt = promptField.value.trim();
            if (!prompt) {
              status.textContent = 'Escribe un prompt antes de enviar.';
              output.textContent = 'No se envió ninguna solicitud.';
              return;
            }

            button.disabled = true;
            status.textContent = 'Generando respuesta...';
            output.textContent = 'Esperando respuesta del servidor...';

            try {
              const response = await fetch('/api/gemini/generate', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt })
              });

              const payload = await response.json();
              if (!response.ok) {
                status.textContent = 'No se pudo completar la generación.';
                output.textContent = payload.detail || payload.message || 'Error desconocido.';
                return;
              }

              status.textContent = 'Respuesta generada correctamente.';
              output.textContent = payload.result || 'Gemini no devolvió texto.';
            } catch (error) {
              status.textContent = 'Error de red al contactar el servidor.';
              output.textContent = error instanceof Error ? error.message : 'Error inesperado.';
            } finally {
              button.disabled = false;
            }
          });
        }
      </script>
    </body>
  </html>`;
}

async function generateWithGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'Falta la variable de entorno GEMINI_API_KEY (o API_KEY como alias).'
    );
  }

  const payload = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              const text =
                json.candidates?.[0]?.content?.parts
                  ?.map((part) => part.text)
                  .filter(Boolean)
                  .join(' ')
                  .trim() || '';
              resolve({
                text,
                raw: json,
              });
            } catch (error) {
              reject(new Error('Respuesta JSON inválida de Gemini.'));
            }
          } else {
            reject(new Error(`Gemini respondió con ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { message: 'Solicitud inválida' });
    return;
  }

  if (req.url.startsWith('/health')) {
    sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  if (req.url.startsWith('/api/config')) {
    sendJson(res, 200, { data: getPublicConfig() });
    return;
  }

  if (req.url.startsWith('/api/repos')) {
    try {
      const repos = await fetchRepos();
      sendJson(res, 200, { data: repos });
    } catch (error) {
      console.error('Error API repos:', error);
      sendJson(res, 502, { message: 'No se pudieron obtener los repositorios.', detail: error.message });
    }
    return;
  }

  if (req.url.startsWith('/api/gemini/generate') && req.method === 'POST') {
    if (!GEMINI_API_KEY) {
      sendJson(res, 503, {
        message: 'La funcionalidad de Gemini no está habilitada.',
        detail: 'Configura GEMINI_API_KEY o API_KEY en el entorno del servidor.',
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        sendJson(res, 400, { message: 'Se requiere el campo "prompt" en el cuerpo.' });
        return;
      }

      const result = await generateWithGemini(prompt);
      sendJson(res, 200, { result: result.text || null });
    } catch (error) {
      console.error('Error generando con Gemini:', error.message);
      sendJson(res, 502, {
        message: 'No se pudo procesar la solicitud con Gemini.',
        detail: error.message,
      });
    }
    return;
  }

  if (req.url.startsWith('/api/apihub33') && req.method === 'GET') {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const endpoint = requestUrl.searchParams.get('endpoint') || 'health';
      const data = await fetchApiHub33(endpoint);
      sendJson(res, 200, { data });
    } catch (error) {
      console.error('Error API apihub33:', error.message);
      sendJson(res, 502, { message: 'No se pudo contactar con apihub33.', detail: error.message });
    }
    return;
  }

  if (req.url === '/' || req.url.startsWith('/?')) {
    try {
      const repos = await fetchRepos();
      const html = renderHtml(repos);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (error) {
      console.error('Error renderizando HTML:', error);
      sendJson(res, 502, { message: 'No se pudo renderizar la lista de repositorios.', detail: error.message });
    }
    return;
  }

  sendJson(res, 404, { message: 'Ruta no encontrada' });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Listado público de https://github.com/${GITHUB_USER}`);
});
