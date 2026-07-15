// api/agendar.js
//
// Recebe o horário escolhido + dados de contato da pessoa que está marcando
// (nome, email, whatsapp), cria o evento na agenda do atendimento@facilitta.org,
// e envia dois emails:
//   1. Pra pessoa que marcou — "Application agendado" (recomendações + cancelamento)
//   2. Pro atendimento@facilitta.org — "Novo agendamento - Nome - Horário" (aviso interno)
//
// Não usa Google Meet nem lembrete automático: a equipe acompanha a agenda do dia
// e entra em contato pessoalmente (WhatsApp/email) antes de cada reunião.

const crypto = require('crypto');
const { getAccessToken, CALENDAR_ID } = require('./_lib/googleAuth');

const FROM_EMAIL = 'Facilitta Academy <aplicacoes@facilitta.org>';
const ATENDIMENTO_EMAIL = 'atendimento@facilitta.org';
const SITE_URL = 'https://facilitta.org';
const WHATSAPP_CONTATO = 'https://wa.me/5521995204080';

function signToken(eventId) {
  const secret = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 'fallback-secret';
  return crypto.createHmac('sha256', secret).update(eventId).digest('hex');
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
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

  const { start, end, label, contato, aluno, responsavel, programa } = body;

  if (!start || !end || !contato?.nome || !contato?.email || !contato?.whatsapp) {
    res.status(400).json({ error: 'Preencha nome, e-mail e WhatsApp para confirmar o horário.' });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const descricaoPartes = [
      `Contato: ${contato.nome}`,
      `E-mail: ${contato.email}`,
      `WhatsApp: ${contato.whatsapp}`,
    ];
    if (aluno?.nome) descricaoPartes.push(`Aluno (da application): ${aluno.nome}`);
    if (programa?.nome) descricaoPartes.push(`Programa: ${programa.nome}`);
    if (responsavel?.nome) descricaoPartes.push(`Responsável (da application): ${responsavel.nome}`);

    const eventBody = {
      summary: `Facilitta Academy — Conversa com ${contato.nome}`,
      description: descricaoPartes.join('\n'),
      start: { dateTime: start, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: end, timeZone: 'America/Sao_Paulo' },
      attendees: [{ email: contato.email }],
    };

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?sendUpdates=all`,
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
    const eventId = event.id;
    const sig = signToken(eventId);
    const cancelUrl = `${SITE_URL}/api/cancelar?event=${encodeURIComponent(eventId)}&sig=${sig}`;
    const dataLabel = formatDateLabel(start);
    const horaLabel = label || new Date(start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      // ── Email 1: pra pessoa que marcou ──────────────────────────
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [contato.email],
          subject: 'Application agendado',
          html: `
            <div style="font-family:Helvetica,Arial,sans-serif; max-width:520px; margin:0 auto; background:#f5f5f7; padding:32px 16px;">
              <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e5e7;">
                <div style="background:#E8391D; padding:20px 28px;">
                  <p style="margin:0; color:#ffffff; font-size:16px; font-weight:700;">Facilitta Academy</p>
                </div>
                <div style="padding:24px 28px;">
                  <p style="margin:0 0 16px; color:#1d1d1f; font-size:15px; line-height:1.6;">Olá, ${escapeHtml(contato.nome)}! Seu horário de conversa com a Facilitta Academy está confirmado para <strong>${dataLabel} às ${horaLabel}</strong>.</p>

                  <p style="margin:0 0 8px; color:#E8391D; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Recomendações pra reunião</p>
                  <ul style="margin:0 0 20px; padding-left:18px; color:#1d1d1f; font-size:14px; line-height:1.8;">
                    <li>Verifique se você estará num lugar tranquilo, sem barulho</li>
                    <li>Fique disponível pelo menos 5 minutos antes do horário marcado</li>
                    <li>Em caso de atraso de mais de 10 minutos, a reunião será cancelada</li>
                  </ul>

                  <p style="margin:0 0 8px; color:#6e6e73; font-size:12px;">Qualquer dúvida, fale com a gente pelo WhatsApp</p>
                  <p style="margin:0 0 24px;"><a href="${WHATSAPP_CONTATO}" style="color:#E8391D; font-size:14px;">${WHATSAPP_CONTATO}</a></p>

                  <p style="margin:0;"><a href="${cancelUrl}" style="color:#6e6e73; font-size:12px;">Cancelar este horário</a></p>
                </div>
              </div>
            </div>
          `,
        }),
      });

      // ── Email 2: aviso interno pro atendimento ──────────────────
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [ATENDIMENTO_EMAIL],
          reply_to: contato.email,
          subject: `Novo agendamento - ${contato.nome} - ${horaLabel}`,
          html: `
            <div style="font-family:Helvetica,Arial,sans-serif; max-width:520px; margin:0 auto; padding:24px;">
              <p style="font-size:15px; color:#1d1d1f;"><strong>${escapeHtml(contato.nome)}</strong> marcou uma conversa para <strong>${dataLabel} às ${horaLabel}</strong>.</p>
              <table style="width:100%; border-collapse:collapse; margin-top:16px;">
                <tr><td style="padding:4px 12px 4px 0; color:#6e6e73; font-size:13px;">E-mail</td><td style="padding:4px 0; font-size:14px; font-weight:600;">${escapeHtml(contato.email)}</td></tr>
                <tr><td style="padding:4px 12px 4px 0; color:#6e6e73; font-size:13px;">WhatsApp</td><td style="padding:4px 0; font-size:14px; font-weight:600;">${escapeHtml(contato.whatsapp)}</td></tr>
                ${aluno?.nome ? `<tr><td style="padding:4px 12px 4px 0; color:#6e6e73; font-size:13px;">Aluno</td><td style="padding:4px 0; font-size:14px; font-weight:600;">${escapeHtml(aluno.nome)}</td></tr>` : ''}
                ${programa?.nome ? `<tr><td style="padding:4px 12px 4px 0; color:#6e6e73; font-size:13px;">Programa</td><td style="padding:4px 0; font-size:14px; font-weight:600;">${escapeHtml(programa.nome)}</td></tr>` : ''}
              </table>
            </div>
          `,
        }),
      });
    }

    res.status(200).json({ ok: true, eventId });
  } catch (err) {
    console.error('Erro ao agendar:', err);
    res.status(500).json({ error: 'Não foi possível confirmar o agendamento agora. Tente novamente.' });
  }
};
