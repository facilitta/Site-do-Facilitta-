// api/_lib/googleAuth.js
//
// Autentica como a Service Account do Google Cloud, impersonando
// atendimento@facilitta.org (via domain-wide delegation), e devolve
// um access_token pra usar na Calendar API.
//
// Requer a variável de ambiente GOOGLE_SERVICE_ACCOUNT_KEY (o conteúdo
// inteiro do arquivo JSON da chave), já configurada no Vercel.

const crypto = require('crypto');

const CALENDAR_ID = 'atendimento@facilitta.org';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY não configurada no Vercel.');
  }

  const key = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: key.client_email,
    sub: CALENDAR_ID, // impersona o atendimento@facilitta.org
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(key.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Falha ao autenticar com o Google: ${text}`);
  }

  const data = await tokenRes.json();
  return data.access_token;
}

module.exports = { getAccessToken, CALENDAR_ID };
