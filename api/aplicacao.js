// api/aplicacao.js
//
// Recebe os dados do formulário de aplicação (compra.html) e envia um email
// para atendimento@facilitta.org com os dados do programa, do aluno e do responsável.
//
// Requer a variável de ambiente RESEND_API_KEY configurada no Vercel
// (Settings → Environment Variables), já usada em api/contato.js.

const DESTINATION_EMAIL = 'atendimento@facilitta.org';
const FROM_EMAIL = 'Facilitta Academy <aplicacoes@facilitta.org>';

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailHtml({ programa, aluno, responsavel, redacao }) {
  const row = (label, value) => `
    <tr>
      <td style="padding:6px 12px 6px 0; color:#6e6e73; font-size:13px; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:6px 0; color:#1d1d1f; font-size:14px; font-weight:600; vertical-align:top;">${escapeHtml(value) || '—'}</td>
    </tr>`;

  const INGLES_LABELS = { basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado', fluente: 'Fluente' };

  return `
  <div style="font-family:Helvetica,Arial,sans-serif; max-width:600px; margin:0 auto; background:#f5f5f7; padding:32px 16px;">
    <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e5e7;">
      <div style="background:#E8391D; padding:20px 28px;">
        <p style="margin:0; color:#ffffff; font-size:16px; font-weight:700;">Nova application recebida</p>
        <p style="margin:4px 0 0; color:rgba(255,255,255,0.85); font-size:13px;">${escapeHtml(programa?.nome)}</p>
      </div>

      <div style="padding:24px 28px;">
        <p style="margin:0 0 8px; color:#E8391D; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Dados do aluno</p>
        <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
          ${row('Nome', aluno?.nome)}
          ${row('Nascimento', aluno?.nasc)}
          ${row('CPF', aluno?.cpf)}
          ${row('E-mail', aluno?.email)}
          ${row('Telefone', aluno?.tel)}
          ${row('Endereço', `${aluno?.rua || ''}, ${aluno?.num || ''} ${aluno?.comp || ''}`.trim())}
          ${row('Bairro', aluno?.bairro)}
          ${row('Cidade / Estado', `${aluno?.cidade || ''} - ${aluno?.estado || ''}`)}
          ${row('CEP', aluno?.cep)}
        </table>

        <p style="margin:0 0 8px; color:#E8391D; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Informações acadêmicas</p>
        <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
          ${row('Escola atual', aluno?.escola)}
          ${row('Ano / série', aluno?.serie)}
          ${row('Nível de inglês', INGLES_LABELS[aluno?.ingles] || aluno?.ingles)}
        </table>

        <p style="margin:0 0 8px; color:#E8391D; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Dados do responsável</p>
        <table style="width:100%; border-collapse:collapse;">
          ${row('Nome', responsavel?.nome)}
          ${row('Parentesco', responsavel?.parentesco)}
          ${row('Nascimento', responsavel?.nasc)}
          ${row('Profissão', responsavel?.profissao)}
          ${row('CPF', responsavel?.cpf)}
          ${row('E-mail', responsavel?.email)}
          ${row('Telefone', responsavel?.tel)}
        </table>

        <p style="margin:0 0 8px; color:#E8391D; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Redação</p>
        <p style="margin:0; color:#1d1d1f; font-size:14px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(redacao) || '—'}</p>
      </div>

      <div style="padding:16px 28px; background:#f5f5f7; border-top:1px solid #e5e5e7;">
        <p style="margin:0; color:#86868b; font-size:12px;">Enviado automaticamente pelo formulário de aplicação em facilitta.org</p>
      </div>
    </div>
  </div>`;
}

const RECAPTCHA_MIN_SCORE = 0.5;

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

  const { programa, aluno, responsavel, redacao, recaptchaToken } = body;

  const recaptcha = await verifyRecaptcha(recaptchaToken);
  if (!recaptcha.ok) {
    console.error('Falha na verificação do reCAPTCHA:', recaptcha.reason, recaptcha.data);
    res.status(400).json({ error: 'Não foi possível confirmar que você não é um robô. Tente novamente.' });
    return;
  }

  // Validação básica no servidor (não confia só no front-end)
  if (!programa || !programa.nome) {
    res.status(400).json({ error: 'Programa não informado.' });
    return;
  }
  if (!aluno || !aluno.nome || !aluno.email || !aluno.tel) {
    res.status(400).json({ error: 'Dados do aluno incompletos.' });
    return;
  }
  if (!responsavel || !responsavel.nome || !responsavel.email || !responsavel.tel) {
    res.status(400).json({ error: 'Dados do responsável incompletos.' });
    return;
  }
  if (!redacao || !redacao.trim()) {
    res.status(400).json({ error: 'Redação não informada.' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY não configurada.');
    res.status(500).json({ error: 'Configuração de envio de email pendente. Tente novamente mais tarde.' });
    return;
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [DESTINATION_EMAIL],
        reply_to: aluno.email,
        subject: `Nova application — ${programa.nome} — ${aluno.nome}`,
        html: buildEmailHtml({ programa, aluno, responsavel, redacao }),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Erro Resend:', errText);
      res.status(502).json({ error: 'Não foi possível enviar a aplicação agora. Tente novamente em instantes.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar aplicação:', err);
    res.status(500).json({ error: 'Erro interno ao enviar a aplicação.' });
  }
};
