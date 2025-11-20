import http from 'node:http';
import https from 'node:https';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const GITHUB_USER = process.env.GITHUB_USER || 'ncolex';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
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

function readJsonBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;

    const onError = (error) => {
      if (!rejected) {
        rejected = true;
        reject(error);
      }
    };

    const onData = (chunk) => {
      if (rejected) return;

      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        rejected = true;
        const error = new Error('El cuerpo de la solicitud excede el límite permitido.');
        error.statusCode = 413;
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        req.resume();
        reject(error);
      }
    };

    const onEnd = () => {
      if (rejected) return;

      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed);
      } catch (error) {
        reject(new Error('No se pudo interpretar el cuerpo JSON.'));
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);

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

function renderHtml(repos) {
  const items = repos
    .map(
      (repo) => `
      <article>
        <h2><a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">${repo.name}</a></h2>
        <p>${repo.description || 'Sin descripción disponible.'}</p>
        <p><strong>Lenguaje:</strong> ${repo.language || 'N/A'} | <strong>Actualizado:</strong> ${new Date(
        repo.updated_at
      ).toLocaleString()}</p>
        ${repo.homepage ? `<p><a href="${repo.homepage}" target="_blank" rel="noopener noreferrer">Demo</a></p>` : ''}
      </article>`
    )
    .join('\n');

  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Repositorios de ${GITHUB_USER}</title>
      <style>
        :root { color-scheme: dark; }
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2rem; background: #020617; color: #f8fafc; }
        h1 { text-align: center; margin-bottom: 1.5rem; }
        article { background: #0f172a; border-radius: 0.75rem; padding: 1rem 1.25rem; margin-bottom: 1rem; box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.7); }
        a { color: #38bdf8; text-decoration: none; }
        a:hover { text-decoration: underline; }
        footer { text-align: center; margin-top: 2rem; color: #94a3b8; font-size: 0.9rem; }
      </style>
    </head>
    <body>
      <h1>Proyectos públicos de ${GITHUB_USER}</h1>
      ${items || '<p>No hay repositorios públicos disponibles.</p>'}
      <footer>
        Datos actualizados cada ${Math.round(CACHE_TTL_MS / 1000)} segundos.
      </footer>
    </body>
  </html>`;
}

async function generateWithGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('Falta la variable de entorno GEMINI_API_KEY.');
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
      const statusCode = error.statusCode === 413 ? 413 : 502;
      const message =
        statusCode === 413
          ? 'El cuerpo de la solicitud excede el límite permitido.'
          : 'No se pudo procesar la solicitud con Gemini.';

      if (!res.writableEnded) {
        sendJson(res, statusCode, {
          message,
          detail: error.message,
        });
      }
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
