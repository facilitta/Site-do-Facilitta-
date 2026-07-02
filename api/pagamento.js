// Preços definidos no servidor (nunca confiar no cliente)
// Atualize os valores `amount` em centavos (ex: R$ 997,00 = 99700)
const PRODUCTS = {
  highschool: { name: 'High School Diploma', amount: 0 },
  tecnico:    { name: 'Curso Técnico',        amount: 0 },
  ingles:     { name: 'Curso de Inglês',      amount: 0 },
  pos:        { name: 'Pós-graduação',         amount: 0 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { produtoId } = req.body;

  const produto = PRODUCTS[produtoId];
  if (!produto) {
    return res.status(400).json({ error: 'Produto inválido' });
  }

  if (!produto.amount || produto.amount <= 0) {
    return res.status(400).json({ error: 'Preço ainda não configurado. Entre em contato.' });
  }

  try {
    const body = new URLSearchParams({
      amount: produto.amount,
      currency: 'brl',
      'metadata[produto]': produtoId,
      'metadata[nome_produto]': produto.name,
      'automatic_payment_methods[enabled]': 'true',
    });

    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Stripe error:', err);
      return res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
    }

    const paymentIntent = await response.json();
    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
