export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { email, assunto, mensagem } = req.body;

  // Validação básica
  if (!email || !assunto || !mensagem) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Site Facilitta <noreply@facilitta.org>',
        to: 'Suporte@facilitta.org',
        reply_to: email,
        subject: `[Contato] ${assunto}`,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #E8391D;">Nova mensagem pelo site</h2>
            <p><strong>De:</strong> ${email}</p>
            <p><strong>Assunto:</strong> ${assunto}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;" />
            <p><strong>Mensagem:</strong></p>
            <p style="color: #444; line-height: 1.6;">${mensagem.replace(/\n/g, '<br/>')}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #999;">Enviado pelo formulário de contato do site facilitta.org</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Erro ao enviar email' });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
