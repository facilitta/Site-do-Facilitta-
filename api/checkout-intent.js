// api/checkout-intent.js
//
// Cria um Payment Intent no Stripe (conta Brasil) com parcelamento habilitado,
// guardando os dados do formulário e do agendamento no metadata do Payment Intent.
// Não usamos banco de dados: o webhook (api/webhook-stripe.js) lê esses dados
// direto do metadata quando o pagamento é confirmado.
//
// IMPORTANTE: o parcelamento nativo do Stripe Brasil só funciona em BRL.
// Ajuste PRICE_BRL_CENTS pro valor em reais combinado (equivalente aos US$ 8.000).

const PRICE_BRL_CENTS = 4000000; // R$ 40.000,00 — AJUSTAR pro valor real combinado

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    res.status(500).json({ error: 'Stripe não configurado no servidor.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const { aluno, pais, escola, agendamento } = body;

  if (!aluno?.email || !aluno?.nome) {
    res.status(400).json({ error: 'Dados do aluno incompletos.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(aluno.email)) {
    res.status(400).json({ error: 'E-mail do aluno em formato inválido.' });
    return;
  }
  if (!agendamento?.start || !agendamento?.contato?.email) {
    res.status(400).json({ error: 'Escolha um horário antes de continuar pro pagamento.' });
    return;
  }

  // Compacta os dados em strings curtas pro metadata do Stripe (limite de 500 caracteres por valor)
  const metadata = {
    aluno: JSON.stringify(aluno).slice(0, 490),
    pais: JSON.stringify(pais).slice(0, 490),
    escola: JSON.stringify(escola).slice(0, 490),
    agendamento: JSON.stringify(agendamento).slice(0, 490),
  };

  try {
    const params = new URLSearchParams();
    params.append('amount', String(PRICE_BRL_CENTS));
    params.append('currency', 'brl');
    params.append('payment_method_types[]', 'card');
    params.append('payment_method_options[card][installments][enabled]', 'true');
    params.append('receipt_email', aluno.email);
    Object.entries(metadata).forEach(([k, v]) => params.append(`metadata[${k}]`, v));

    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok) {
      throw new Error(data.error?.message || 'Erro ao criar o pagamento.');
    }

    res.status(200).json({
      clientSecret: data.client_secret,
      publishableKey,
    });
  } catch (err) {
    console.error('Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Não foi possível iniciar o pagamento agora. Tente novamente.' });
  }
};
