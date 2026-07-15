// api/cancelar.js
//
// Recebe ?event=ID&sig=ASSINATURA (do link no email de confirmação),
// confere a assinatura, e cancela o evento na agenda se for válida.
// Não usa banco de dados: a "segurança" vem da assinatura HMAC do ID do evento.

const crypto = require('crypto');
const { getAccessToken, CALENDAR_ID } = require('./_lib/googleAuth');

function verifyToken(eventId, sig) {
  const secret = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 'fallback-secret';
  const expected = crypto.createHmac('sha256', secret).update(eventId).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig || ''));
  } catch (e) {
    return false;
  }
}

function htmlPage(message) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Cancelamento — Facilitta Academy</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; background: #f5f5f7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { background: #fff; padding: 40px; border-radius: 16px; max-width: 420px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
    h1 { color: #1d1d1f; font-size: 22px; margin: 0 0 12px; }
    p { color: #6e6e73; font-size: 15px; margin: 0; }
    a { color: #E8391D; text-decoration: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Facilitta Academy</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  const { event, sig } = req.query;

  if (!event || !sig || !verifyToken(event, sig)) {
    res.status(400).send(htmlPage('Link de cancelamento inválido ou expirado.'));
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const delRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(event)}?sendUpdates=all`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!delRes.ok && delRes.status !== 410 && delRes.status !== 404) {
      const text = await delRes.text();
      throw new Error(text);
    }

    res.status(200).send(htmlPage('Seu horário foi cancelado com sucesso. Se quiser reagendar, entre em contato com nossa equipe.'));
  } catch (err) {
    console.error('Erro ao cancelar:', err);
    res.status(500).send(htmlPage('Não foi possível cancelar o horário agora. Entre em contato com nossa equipe pelo WhatsApp ou email.'));
  }
};
