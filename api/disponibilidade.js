// api/disponibilidade.js
//
// Recebe uma data (?data=YYYY-MM-DD) e devolve os horários livres daquele dia,
// consultando a agenda do atendimento@facilitta.org via Google Calendar API.
//
// Regras: reuniões de 45min, das 9h às 16h30, Seg a Sex, horário de Brasília,
// só até 14 dias no futuro.

const { getAccessToken, CALENDAR_ID } = require('./_lib/googleAuth');

const SLOT_MINUTES = 45;
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 16.5; // 16h30
const TZ_OFFSET = '-03:00'; // America/Sao_Paulo (sem horário de verão)
const MAX_DAYS_AHEAD = 14;

function buildSlotsForDay(dateStr) {
  const slots = [];
  let h = DAY_START_HOUR;
  while (h + SLOT_MINUTES / 60 <= DAY_END_HOUR + 0.0001) {
    const startH = Math.floor(h);
    const startM = Math.round((h - startH) * 60);
    const start = new Date(`${dateStr}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00${TZ_OFFSET}`);
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
    slots.push({ start, end });
    h += SLOT_MINUTES / 60;
  }
  return slots;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const { data } = req.query;
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    res.status(400).json({ error: 'Data inválida.' });
    return;
  }

  const requestedDate = new Date(`${data}T12:00:00${TZ_OFFSET}`);
  if (isNaN(requestedDate.getTime())) {
    res.status(400).json({ error: 'Data inválida.' });
    return;
  }

  const now = new Date();
  const diffDays = Math.floor((requestedDate - now) / 86400000);
  const dayOfWeek = requestedDate.getUTCDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    res.status(200).json({ slots: [] }); // fim de semana
    return;
  }
  if (diffDays < 0 || diffDays > MAX_DAYS_AHEAD) {
    res.status(200).json({ slots: [] });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const dayStart = new Date(`${data}T00:00:00${TZ_OFFSET}`);
    const dayEnd = new Date(`${data}T23:59:59${TZ_OFFSET}`);

    const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: CALENDAR_ID }],
      }),
    });

    if (!fbRes.ok) {
      const text = await fbRes.text();
      throw new Error(text);
    }

    const fbData = await fbRes.json();
    const busy = fbData.calendars?.[CALENDAR_ID]?.busy || [];

    const allSlots = buildSlotsForDay(data);
    const freeSlots = allSlots.filter((slot) => {
      const isBusy = busy.some((b) => {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        return slot.start < bEnd && slot.end > bStart;
      });
      return !isBusy && slot.start > now;
    });

    res.status(200).json({
      slots: freeSlots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        label: s.start.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo',
        }),
      })),
    });
  } catch (err) {
    console.error('Erro ao consultar disponibilidade:', err);
    res.status(500).json({ error: 'Não foi possível consultar os horários disponíveis agora.' });
  }
};
