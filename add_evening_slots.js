require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const psi = await sql`SELECT id, nome, email FROM psicanalistas LIMIT 1`;
  if (psi.length === 0) {
    console.error('Nenhum psicanalista encontrado');
    process.exit(1);
  }
  const psiId = psi[0].id;
  console.log(`Psicanalista: ${psi[0].nome} (${psiId})`);

  const currentSlots = await sql`
    SELECT id, dia_semana, hora_inicio, hora_fim 
    FROM horarios_disponiveis 
    WHERE psicanalista_id = ${psiId}
    ORDER BY dia_semana, hora_inicio
  `;
  console.log(`Slots atuais: ${currentSlots.length}`);

  // Dias 1 (Seg) a 5 (Sex)
  const dias = [1, 2, 3, 4, 5];
  const newSlots = ['18:00', '19:00', '20:00', '21:00'];

  for (const dia of dias) {
    for (const inicio of newSlots) {
      const [h, m] = inicio.split(':');
      const fim = `${String(parseInt(h) + 1).padStart(2, '0')}:${m || '00'}`;

      // Verifica se já existe
      const exists = currentSlots.some(
        s => s.dia_semana === dia && String(s.hora_inicio).startsWith(inicio)
      );

      if (!exists) {
        await sql`
          INSERT INTO horarios_disponiveis (psicanalista_id, dia_semana, hora_inicio, hora_fim)
          VALUES (${psiId}, ${dia}, ${inicio}, ${fim})
        `;
        console.log(`+ Inserido slot Dia ${dia}: ${inicio} - ${fim}`);
      } else {
        console.log(`= Slot já existe Dia ${dia}: ${inicio} - ${fim}`);
      }
    }
  }

  const allSlots = await sql`
    SELECT id, dia_semana, hora_inicio, hora_fim 
    FROM horarios_disponiveis 
    WHERE psicanalista_id = ${psiId}
    ORDER BY dia_semana, hora_inicio
  `;
  console.log(`Total slots agora: ${allSlots.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
