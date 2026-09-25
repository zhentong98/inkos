import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createVerifier({ issuer, audience, email, keys }) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer ?? '') ||
      !audience?.trim() || !email?.includes('@')) throw new Error('Invalid Access configuration');
  const jwks = keys ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
  return async (token) => {
    if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('Missing assertion');
    const { payload } = await jwtVerify(token, jwks, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'],
    });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error('Identity denied');
    }
    return payload;
  };
}

export function createAccessServer(verify) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/healthz') { response.writeHead(200).end('ok'); return; }
    if (request.url !== '/verify' || request.method !== 'GET') { response.writeHead(404).end(); return; }
    try {
      await verify(request.headers['cf-access-jwt-assertion']);
      response.writeHead(204).end();
    } catch { response.writeHead(401).end('Unauthorized'); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const verify = createVerifier({
    issuer: process.env.ACCESS_ISSUER, audience: process.env.ACCESS_AUDIENCE, email: process.env.ACCESS_EMAIL,
  });
  createAccessServer(verify).listen(4568, '0.0.0.0');
}
