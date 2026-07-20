// api/webhook-stripe.js
//
// Recebe o evento do Stripe confirmando que o pagamento foi aprovado de verdade
// (payment_intent.succeeded). Só a partir daqui: cria o evento na agenda do
// atendimento@ e do admissoes@ (as duas, já que a sincronização de verdade
// entre as contas fica pra depois, como combinado), e envia os 3 emails.
//
// Precisa da variável STRIPE_WEBHOOK_SECRET (pegar no painel do Stripe
// depois de cadastrar esse endpoint em Developers > Webhooks).

const crypto = require('crypto');
const { getAccessTokenFor, CALENDAR_ID, ADMISSOES_CALENDAR_ID } = require('./_lib/googleAuth');

const FROM_EMAIL = 'Facilitta Academy <aplicacoes@facilitta.org>';
const ADMISSOES_EMAIL = 'admissoes@facilitta.org';
const ASSESSORIA_EMAIL = 'assessoria@facilitta.org';
const RESEND_API_URL = 'https://api.resend.com/emails';

// Vercel: precisamos do corpo cru (não parseado) pra validar a assinatura do Stripe
module.exports.config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Valida a assinatura do webhook manualmente (sem depender do SDK do Stripe)
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY não configurada.');
    return;
  }
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error('Erro ao enviar email:', await res.text());
  }
}

async function criarEventoNaAgenda(impersonateEmail, { aluno, agendamento }) {
  const accessToken = await getAccessTokenFor(impersonateEmail);
  const eventBody = {
    summary: `Facilitta Academy — Primeira reunião de assessoria (${aluno.nome} ${aluno.sobrenome || ''})`.trim(),
    description: `Contato: ${agendamento.contato?.nome}\nE-mail: ${agendamento.contato?.email}\nWhatsApp: ${agendamento.contato?.whatsapp}\nAluno: ${aluno.nome} ${aluno.sobrenome || ''}`,
    start: { dateTime: agendamento.start, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: agendamento.end, timeZone: 'America/Sao_Paulo' },
    attendees: [{ email: agendamento.contato?.email }],
  };

  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(impersonateEmail)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    }
  );
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Erro ao criar evento em ${impersonateEmail}: ${text}`);
  }
  return createRes.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Método não permitido.');
    return;
  }

  const rawBody = (await buffer(req)).toString('utf8');
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
    console.error('Assinatura do webhook do Stripe inválida.');
    res.status(400).send('Assinatura inválida.');
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).send('Payload inválido.');
    return;
  }

  if (event.type !== 'payment_intent.succeeded') {
    // Não é o evento que nos interessa; confirma recebimento e ignora.
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  const paymentIntent = event.data.object;
  const metadata = paymentIntent.metadata || {};

  let aluno = {}, pais = {}, escola = {}, agendamento = {};
  try { aluno = JSON.parse(metadata.aluno || '{}'); } catch (e) {}
  try { pais = JSON.parse(metadata.pais || '{}'); } catch (e) {}
  try { escola = JSON.parse(metadata.escola || '{}'); } catch (e) {}
  try { agendamento = JSON.parse(metadata.agendamento || '{}'); } catch (e) {}

  const receiptUrl = paymentIntent.charges?.data?.[0]?.receipt_url || '';
  const valorPago = (paymentIntent.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: paymentIntent.currency.toUpperCase() });
  const dataLabel = new Date(agendamento.start).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const horaLabel = agendamento.label || new Date(agendamento.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  try {
    // 1. Cria o evento nas duas agendas (atendimento e admissões)
    await Promise.all([
      criarEventoNaAgenda(CALENDAR_ID, { aluno, agendamento }),
      criarEventoNaAgenda(ADMISSOES_CALENDAR_ID, { aluno, agendamento }),
    ]);

    // 2. Email pro admissões: formulário completo + comprovante de pagamento
    await sendEmail({
      from: FROM_EMAIL,
      to: [ADMISSOES_EMAIL],
      subject: `Nova matrícula confirmada — ${aluno.nome || ''} ${aluno.sobrenome || ''}`.trim(),
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif; max-width:560px; margin:0 auto; padding:24px;">
          <h2 style="color:#E8391D;">Matrícula confirmada</h2>
          <p><strong>Valor pago:</strong> ${valorPago}</p>
          <p><strong>Comprovante:</strong> ${receiptUrl ? `<a href="${receiptUrl}">${receiptUrl}</a>` : 'indisponível'}</p>
          <hr style="margin:20px 0; border:none; border-top:1px solid #eee;">
          <h3>Dados do aluno</h3>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:13px;">${escapeHtml(JSON.stringify(aluno, null, 2))}</pre>
          <h3>Dados dos pais</h3>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:13px;">${escapeHtml(JSON.stringify(pais, null, 2))}</pre>
          <h3>Dados da escola</h3>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:13px;">${escapeHtml(JSON.stringify(escola, null, 2))}</pre>
          <h3>Agendamento</h3>
          <p>${dataLabel} às ${horaLabel}</p>
        </div>
      `,
    });

    // 3. Email pra assessoria: só o formulário + horário (sem o comprovante de pagamento)
    await sendEmail({
      from: FROM_EMAIL,
      to: [ASSESSORIA_EMAIL],
      subject: `Nova reunião de assessoria — ${aluno.nome || ''} ${aluno.sobrenome || ''}`.trim(),
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif; max-width:560px; margin:0 auto; padding:24px;">
          <h2 style="color:#E8391D;">Nova reunião agendada</h2>
          <p><strong>Aluno:</strong> ${escapeHtml(aluno.nome)} ${escapeHtml(aluno.sobrenome)}</p>
          <p><strong>Data:</strong> ${dataLabel} às ${horaLabel}</p>
          <hr style="margin:20px 0; border:none; border-top:1px solid #eee;">
          <h3>Dados do aluno</h3>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:13px;">${escapeHtml(JSON.stringify(aluno, null, 2))}</pre>
          <h3>Dados dos pais</h3>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:13px;">${escapeHtml(JSON.stringify(pais, null, 2))}</pre>
        </div>
      `,
    });

    // 4. Email pro aluno: confirmação da compra + comprovante + parabéns
    if (aluno.email) {
      await sendEmail({
        from: FROM_EMAIL,
        to: [aluno.email],
        subject: 'Parabéns! Sua matrícula foi confirmada — Facilitta Academy',
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif; max-width:520px; margin:0 auto; background:#f5f5f7; padding:32px 16px;">
            <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e5e7;">
              <div style="background:#E8391D; padding:20px 28px;">
                <p style="margin:0; color:#ffffff; font-size:16px; font-weight:700;">Facilitta Academy</p>
              </div>
              <div style="padding:24px 28px;">
                <p style="margin:0 0 16px; color:#1d1d1f; font-size:15px; line-height:1.6;">Parabéns, ${escapeHtml(aluno.nome)}! Sua matrícula foi confirmada com sucesso. Seja muito bem-vindo(a) à Facilitta Academy.</p>
                <p style="margin:0 0 8px; color:#6e6e73; font-size:12px;">Valor pago</p>
                <p style="margin:0 0 20px; color:#1d1d1f; font-size:14px; font-weight:600;">${valorPago}</p>
                ${receiptUrl ? `<p style="margin:0 0 20px;"><a href="${receiptUrl}" style="color:#E8391D; font-size:14px;">Ver comprovante de pagamento</a></p>` : ''}
                <p style="margin:0 0 8px; color:#6e6e73; font-size:12px;">Sua primeira reunião de assessoria</p>
                <p style="margin:0; color:#1d1d1f; font-size:14px; font-weight:600;">${dataLabel} às ${horaLabel}</p>
              </div>
            </div>
          </div>
        `,
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro ao processar pagamento confirmado:', err);
    // Retorna 500 pra o Stripe tentar reenviar o webhook depois
    res.status(500).json({ error: 'Erro ao processar confirmação.' });
  }
};
