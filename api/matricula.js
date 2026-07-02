export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { programa, pagamento, aluno, responsavel } = req.body;

  if (!programa || !aluno || !responsavel) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const pagLabel = pagamento?.tipo === 'parcelado'
    ? `Parcelado em ${pagamento.parcelas}x`
    : 'À vista';

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:680px;margin:0 auto;color:#1d1d1f;">
      <div style="background:#E8391D;padding:32px 36px;border-radius:14px 14px 0 0;">
        <p style="color:rgba(255,255,255,.7);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Nova Matrícula</p>
        <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;">${programa.nome}</h1>
        <p style="color:rgba(255,255,255,.75);margin:6px 0 0;font-size:14px;">${pagLabel} — ${programa.preco}</p>
      </div>

      <div style="background:#fff;padding:32px 36px;border:1px solid #e8e8ed;border-top:none;border-radius:0 0 14px 14px;">

        <h2 style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#E8391D;margin:0 0 16px;">Dados do Aluno</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px;">
          <tr><td style="padding:8px 0;color:#6e6e73;width:40%;">Nome</td><td style="padding:8px 0;font-weight:600;">${aluno.nome}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Nascimento</td><td style="padding:8px 0;font-weight:600;">${aluno.nasc}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">CPF</td><td style="padding:8px 0;font-weight:600;">${aluno.cpf || 'Não informado'}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">E-mail</td><td style="padding:8px 0;font-weight:600;">${aluno.email}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Telefone</td><td style="padding:8px 0;font-weight:600;">${aluno.tel}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Endereço</td><td style="padding:8px 0;font-weight:600;">${aluno.rua}, ${aluno.num}${aluno.comp ? ` (${aluno.comp})` : ''} — ${aluno.bairro ? aluno.bairro + ', ' : ''}${aluno.cidade}/${aluno.estado} — CEP ${aluno.cep}</td></tr>
        </table>

        <hr style="border:none;border-top:1px solid #e8e8ed;margin:0 0 24px;">

        <h2 style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#E8391D;margin:0 0 16px;">Dados do Responsável</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px;">
          <tr><td style="padding:8px 0;color:#6e6e73;width:40%;">Nome</td><td style="padding:8px 0;font-weight:600;">${responsavel.nome}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Parentesco</td><td style="padding:8px 0;font-weight:600;">${responsavel.parentesco}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">CPF</td><td style="padding:8px 0;font-weight:600;">${responsavel.cpf}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">E-mail</td><td style="padding:8px 0;font-weight:600;">${responsavel.email}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Telefone</td><td style="padding:8px 0;font-weight:600;">${responsavel.tel}</td></tr>
        </table>

        <hr style="border:none;border-top:1px solid #e8e8ed;margin:0 0 24px;">

        <h2 style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#E8391D;margin:0 0 16px;">Programa</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:#6e6e73;width:40%;">Programa</td><td style="padding:8px 0;font-weight:600;">${programa.nome}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Valor</td><td style="padding:8px 0;font-weight:600;">${programa.preco}</td></tr>
          <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#6e6e73;">Pagamento</td><td style="padding:8px 0;font-weight:600;">${pagLabel}</td></tr>
        </table>

        <div style="margin-top:28px;padding:16px 20px;background:#f5f5f7;border-radius:10px;font-size:12px;color:#6e6e73;">
          Pagamento processado via Stripe. Verifique o dashboard do Stripe para confirmação.
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Facilitta Academy <noreply@facilitta.org>',
        to: 'Suporte@facilitta.org',
        reply_to: aluno.email,
        subject: `[Nova Matrícula] ${programa.nome} — ${aluno.nome}`,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Erro ao enviar email' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
