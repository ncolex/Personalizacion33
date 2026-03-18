# Personalizacion33

Aplicación Node.js sin dependencias externas que consulta la API pública de GitHub y muestra los repositorios del usuario configurado. Sirve tanto un HTML más completo, sin depender de `cdn.tailwindcss.com`, como endpoints JSON para automatizaciones y permite ajustar el usuario objetivo mediante variables de entorno.

## Uso local

```bash
npm install
npm start
```

La aplicación expone:

- `GET /` – Página HTML con estilo oscuro integrado, tarjetas de repositorios ordenadas por última actualización y un formulario opcional para probar Gemini sin exponer la clave al cliente.
- `GET /api/repos` – Respuesta JSON con la misma información para consumirla desde otras apps.
- `GET /api/config` – Devuelve configuración pública mínima para que un cliente sepa si Gemini y apihub33 están habilitados sin exponer secretos.
- `POST /api/gemini/generate` – Genera texto con Gemini sin exponer la clave API al cliente. Recibe `{ "prompt": "..." }` y responde con `{ "result": "..." }`.
- `GET /api/apihub33?endpoint=/health` – Proxy configurable para consumir un endpoint de apihub33 definido por la variable de entorno `APIHUB33_BASE_URL`. Devuelve el JSON remoto en `{ "data": ... }` y opcionalmente envía `Authorization: Bearer` si se define `APIHUB33_API_KEY`.
- `GET /health` – End-point sencillo para monitoreo.

Variables de entorno disponibles:

- `PORT`: Puerto donde escuchará el servidor (por defecto `3000`).
- `GITHUB_USER`: Usuario del cual se obtendrán los repos (por defecto `ncolex`).
- `CACHE_TTL_MS`: Duración del caché en milisegundos (por defecto 300000 ms = 5 min).
- `GEMINI_API_KEY`: Clave privada de Gemini usada por el endpoint de generación de texto. Puede
  omitirse si defines `API_KEY` (alias aceptado por la app). Si no está definida, `/api/gemini/generate` responderá `503`, el formulario de la portada permanecerá deshabilitado y la UI mostrará un aviso informativo en lugar de depender de errores en consola.
- `APIHUB33_BASE_URL`: URL base de apihub33 que se utilizará para el proxy (`https://...`).
- `APIHUB33_API_KEY`: Token opcional que se envía como `Authorization: Bearer ...` en las peticiones a apihub33.

> Cuando GitHub no es accesible el servicio responde con el último resultado en caché o un conjunto pequeño de datos de respaldo (`data/fallback-repos.json`), evitando así errores 500.

## Docker

Para construir y ejecutar la imagen publicada por el flujo de trabajo:

```bash
docker build -t personalizacion33 .
docker run -p 3000:3000 -e GITHUB_USER=ncolex personalizacion33
```

La imagen también copia `data/fallback-repos.json`, por lo que el modo de respaldo funciona igual dentro y fuera de Docker.

## Flujo de publicación

El workflow `docker-publish.yml` compila y publica la imagen en GitHub Container Registry cuando se genera un tag semántico (`v*.*.*`) o se actualiza la rama `main`. Asegúrate de configurar `GHCR` como destino y de contar con un token con permiso `packages:write` en los secretos del repositorio.
