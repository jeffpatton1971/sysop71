const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pipeline } = require('node:stream/promises');

const publicRoot = path.join(__dirname, 'public');
const indexPath = path.join(publicRoot, 'index.html');
const port = Number(process.env.PORT || 8080);
const apiBaseUrl = stripTrailingSlash(
  process.env.API_BASE_URL || process.env.AZURE_API_BASE_URL || process.env.VITE_API_BASE_URL || '',
);

const mimeTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

http
  .createServer(async (request, response) => {
    try {
      if (request.url?.startsWith('/api/')) {
        await proxyApi(request, response);
        return;
      }

      await serveStaticFile(request, response);
    } catch (error) {
      console.error(error);
      sendText(response, 500, 'Internal server error');
    }
  })
  .listen(port, () => {
    console.log(`sysop71 web app host listening on ${port}`);
  });

async function proxyApi(request, response) {
  if (!apiBaseUrl) {
    sendText(response, 404, 'API base URL is not configured for this Web App.');
    return;
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (!value || isHopByHopHeader(name)) {
      continue;
    }

    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  const apiResponse = await fetch(`${apiBaseUrl}${request.url}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
    duplex: 'half',
  });

  response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));

  if (apiResponse.body) {
    await pipeline(apiResponse.body, response);
    return;
  }

  response.end();
}

async function serveStaticFile(request, response) {
  const requestPath = safeRequestPath(request.url || '/');
  const filePath = await resolveStaticPath(requestPath);

  if (!filePath) {
    sendText(response, 404, 'Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.setHeader('Content-Type', mimeTypes.get(extension) || 'application/octet-stream');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (filePath === indexPath) {
    response.setHeader('Cache-Control', 'no-cache');
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  await pipeline(fs.createReadStream(filePath), response);
}

async function resolveStaticPath(requestPath) {
  const requestedFile = path.join(publicRoot, requestPath === '/' ? 'index.html' : requestPath);
  const normalizedPath = path.normalize(requestedFile);

  if (!normalizedPath.startsWith(publicRoot)) {
    return undefined;
  }

  if (await fileExists(normalizedPath)) {
    return normalizedPath;
  }

  if (path.extname(requestPath)) {
    return undefined;
  }

  return indexPath;
}

function safeRequestPath(value) {
  const parsed = new URL(value, 'http://localhost');
  return decodeURIComponent(parsed.pathname);
}

async function fileExists(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
}

function sendText(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function isHopByHopHeader(name) {
  return [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ].includes(name.toLowerCase());
}
