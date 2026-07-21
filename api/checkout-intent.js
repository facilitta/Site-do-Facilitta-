// api/checkout-intent.js
//
// Cria um Payment Intent no Stripe (conta Brasil), com:
//  - Produto configurável (cada um com seu preço em BRL)
//  - Método escolhido: cartão parcelado ou Pix
//  - Suporte a "partes vinculadas": uma matrícula pode ser paga em mais de
//    um Payment Intent (ex: entrada + parcelado), cada parte com seu método.
//    O webhook (api/webhook-stripe.js) só finaliza a matrícula (agenda + emails)
//    quando TODAS as partes tiverem sido aprovadas — sem precisar de banco de dados,
//    consultando o status de cada parte direto no Stripe.
//
// IMPORTANTE: o parcelamento nativo do Stripe Brasil só funciona em BRL.

// AJUSTAR: valor em dólares que cada produto vale (convertido pro dia usando a cotação atual)
const PRODUTOS_USD = {
  highschool: { nome: 'Facilitta High School', precoUSD: 8000 },
};

let cotacaoCache = null; // { valor, buscadoEm } — evita bater na API a cada clique na mesma invocação

async function getCotacaoDolar() {
  const agora = Date.now();
  if (cotacaoCache && (agora - cotacaoCache.buscadoEm) < 5 * 60 * 1000) {
    return cotacaoCache.valor; // reaproveita por até 5 minutos
  }
  const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
  if (!r.ok) throw new Error('Não foi possível consultar a cotação do dólar.');
  const data = await r.json();
  const valor = parseFloat(data?.USDBRL?.bid);
  if (!valor) throw new Error('Cotação do dólar inválida.');
  cotacaoCache = { valor, buscadoEm: agora };
  return valor;
}

async function getPrecoProdutoCents(produtoId) {
  const produto = PRODUTOS_USD[produtoId];
  if (!produto) return null;
  const cotacao = await getCotacaoDolar();
  const precoCents = Math.round(produto.precoUSD * cotacao * 100);
  return { ...produto, precoCents, cotacao };
}

function escapeMeta(v) { return v === undefined || v === null ? '' : String(v); }

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const produtoId = req.query?.produtoId;
    try {
      const produto = await getPrecoProdutoCents(produtoId);
      if (!produto) {
        res.status(400).json({ error: 'Programa inválido.' });
        return;
      }
      res.status(200).json({
        precoCents: produto.precoCents,
        produtoNome: produto.nome,
        cotacaoDolar: produto.cotacao,
        priceLabel: (produto.precoCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          + ` (U$${produto.precoUSD} na cotação de hoje: R$${produto.cotacao.toFixed(2)})`,
      });
    } catch (err) {
      console.error('Erro ao consultar preço:', err);
      res.status(500).json({ error: 'Não foi possível consultar o preço agora. Tente novamente.' });
    }
    return;
  }

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

  const {
    aluno, pais, escola, agendamento,
    produtoId,               // 'highschool' (por enquanto, só esse programa está disponível aqui)
    metodo,                  // 'card' | 'pix'
    valorCents,               // valor desta parte, em centavos
    matriculaId,              // ID compartilhado entre as partes da mesma matrícula
    parteNumero,              // "1", "2", ...
    totalPartes,              // "1", "2", ...
    isFinalParte,             // 'true' só na última parte
    siblingIntentIds,         // IDs das outras partes já criadas (separados por vírgula)
  } = body;

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

  const produtoInfo = PRODUTOS_USD[produtoId];
  if (!produtoInfo) {
    res.status(400).json({ error: 'Programa inválido.' });
    return;
  }
  if (!['card', 'pix'].includes(metodo)) {
    res.status(400).json({ error: 'Método de pagamento inválido.' });
    return;
  }
  const valor = parseInt(valorCents, 10);
  if (!valor || valor <= 0) {
    res.status(400).json({ error: 'Valor da parte inválido.' });
    return;
  }

  // Compacta os dados em strings curtas pro metadata do Stripe (limite de 500 caracteres por valor)
  const metadata = {
    aluno: JSON.stringify(aluno).slice(0, 490),
    pais: JSON.stringify(pais).slice(0, 490),
    escola: JSON.stringify(escola).slice(0, 490),
    agendamento: JSON.stringify(agendamento).slice(0, 490),
    produto_id: produtoId,
    produto_nome: produtoInfo.nome,
    matricula_id: escapeMeta(matriculaId),
    parte_numero: escapeMeta(parteNumero || '1'),
    total_partes: escapeMeta(totalPartes || '1'),
    is_final_parte: escapeMeta(isFinalParte !== undefined ? isFinalParte : 'true'),
    sibling_intent_ids: escapeMeta(siblingIntentIds || ''),
  };

  try {
    const params = new URLSearchParams();
    params.append('amount', String(valor));
    params.append('currency', 'brl');
    params.append('receipt_email', aluno.email);

    if (metodo === 'card') {
      params.append('payment_method_types[]', 'card');
      params.append('payment_method_options[card][installments][enabled]', 'true');
    } else {
      params.append('payment_method_types[]', 'pix');
    }

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
      paymentIntentId: data.id,
      publishableKey,
      priceLabel: (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    });
  } catch (err) {
    console.error('Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Não foi possível iniciar o pagamento agora. Tente novamente.' });
  }
};
