// api/agendar.js
//
// Recebe o horário escolhido + dados do aluno/responsável e cria o evento
// direto na agenda do atendimento@facilitta.org, com Google Meet automático,
// convidando aluno e responsável, e envia um email de confirmação com o
// link da reunião e um link de cancelamento assinado.

const crypto = require('crypto');
const { getAccessToken, CALENDAR_ID } = require('./_lib/googleAuth');

const FROM_EMAIL = 'Facilitta Academy <aplicacoes@facilitta.org>';
const SITE_URL = 'https://facilitta.org';

function signToken(eventId) {
  const secret = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 'fallback-secret';
  return crypto.createHmac('sha256', secret).update(eventId).digest('hex');
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const { start, end, aluno, responsavel, programa } = body;

  if (!start || !end || !aluno?.email || !aluno?.nome || !responsavel?.email) {
    res.status(400).json({ error: 'Dados incompletos para o agendamento.' });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const eventBody = {
      summary: `Facilitta Academy — Conversa sobre application (${aluno.nome})`,
      description: `Conversa sobre a application de ${aluno.nome} para o programa ${programa?.nome || ''}.`,
      start: { dateTime: start, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: end, timeZone: 'America/Sao_Paulo' },
      attendees: [{ email: aluno.email }, { email: responsavel.email }],
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(text);
    }

    const event = await createRes.json();
    const meetLink = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || '';
    const eventId = event.id;
    const sig = signToken(eventId);
    const cancelUrl = `${SITE_URL}/api/cancelar?event=${encodeURIComponent(eventId)}&sig=${sig}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [aluno.email, responsavel.email],
          subject: 'Horário confirmado — Facilitta Academy',
          html: `
            <div style="font-family:Helvetica,Arial,sans-serif; max-width:520px; margin:0 auto; background:#f5f5f7; padding:32px 16px;">
              <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e5e7;">
                <div style="background:#E8391D; padding:20px 28px;">
                  <p style="margin:0; color:#ffffff; font-size:16px; font-weight:700;">Horário confirmado</p>
                </div>
                <div style="padding:24px 28px;">
                  <p style="margin:0 0 16px; color:#1d1d1f; font-size:14px; line-height:1.6;">Olá, ${escapeHtml(aluno.nome)}! Seu horário de conversa com a Facilitta Academy foi confirmado.</p>
                  <p style="margin:0 0 8px; color:#6e6e73; font-size:12px;">Link da reunião (Google Meet)</p>
                  <p style="margin:0 0 20px;"><a href="${meetLink}" style="color:#E8391D; font-size:14px;">${meetLink}</a></p>
                  <p style="margin:0;"><a href="${cancelUrl}" style="color:#6e6e73; font-size:12px;">Cancelar este horário</a></p>
                </div>
              </div>
            </div>
          `,
        }),
      });
    }

    res.status(200).json({ ok: true, meetLink, eventId });
  } catch (err) {
    console.error('Erro ao agendar:', err);
    res.status(500).json({ error: 'Não foi possível confirmar o agendamento agora. Tente novamente.' });
  }
};
