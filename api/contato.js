// api/contato.js
//
// Recebe os dados do formulário de contato (email, assunto, mensagem),
// verifica o reCAPTCHA v3, e envia um email pra Suporte@facilitta.org via Resend.

const DESTINATION_EMAIL = 'Suporte@facilitta.org';
const FROM_EMAIL = 'Facilitta Academy <aplicacoes@facilitta.org>';
const RECAPTCHA_MIN_SCORE = 0.5;

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.error('RECAPTCHA_SECRET_KEY não configurada.');
    return { ok: false, reason: 'config' };
  }
  if (!token) return { ok: false, reason: 'missing-token' };

  const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = await verifyRes.json();
  if (!data.success || (typeof data.score === 'number' && data.score < RECAPTCHA_MIN_SCORE)) {
    return { ok: false, reason: 'low-score', data };
  }
  return { ok: true, data };
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

  const { email, assunto, mensagem, recaptchaToken } = body;

  const recaptcha = await verifyRecaptcha(recaptchaToken);
  if (!recaptcha.ok) {
    console.error('Falha na verificação do reCAPTCHA:', recaptcha.reason, recaptcha.data);
    res.status(400).json({ error: 'Não foi possível confirmar que você não é um robô. Tente novamente.' });
    return;
  }

  if (!email || !assunto || !mensagem) {
    res.status(400).json({ error: 'Preencha todos os campos.' });
    return;
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY não configurada.');
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [DESTINATION_EMAIL],
        reply_to: email,
        subject: `Novo contato — ${assunto}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif; max-width:520px; margin:0 auto; background:#f5f5f7; padding:32px 16px;">
            <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e5e7;">
              <div style="background:#E8391D; padding:20px 28px;">
                <p style="margin:0; color:#ffffff; font-size:16px; font-weight:700;">Nova mensagem de contato</p>
              </div>
              <div style="padding:24px 28px;">
                <p style="margin:0 0 6px; color:#6e6e73; font-size:12px;">E-mail</p>
                <p style="margin:0 0 16px; color:#1d1d1f; font-size:14px; font-weight:600;">${escapeHtml(email)}</p>
                <p style="margin:0 0 6px; color:#6e6e73; font-size:12px;">Assunto</p>
                <p style="margin:0 0 16px; color:#1d1d1f; font-size:14px; font-weight:600;">${escapeHtml(assunto)}</p>
                <p style="margin:0 0 6px; color:#6e6e73; font-size:12px;">Mensagem</p>
                <p style="margin:0; color:#1d1d1f; font-size:14px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(mensagem)}</p>
              </div>
            </div>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      throw new Error(text);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar contato:', err);
    res.status(500).json({ error: 'Não foi possível enviar sua mensagem agora. Tente novamente.' });
  }
};
