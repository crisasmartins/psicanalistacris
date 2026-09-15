require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function check() {
  console.log('--- CONEXÃO ---');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  
  const psicanalistas = await sql`SELECT * FROM psicanalistas`;
  console.log('\n--- PSICANALISTAS ---', psicanalistas);

  const pacientes = await sql`SELECT id, nome_completo, email, whatsapp FROM pacientes`;
  console.log('\n--- PACIENTES ---', pacientes);

  const consultas = await sql`SELECT id, paciente_id, data_hora, status, valor_pago FROM consultas`;
  console.log('\n--- CONSULTAS ---', consultas);

  const horarios = await sql`SELECT id, dia_semana, hora_inicio, data_bloqueio FROM horarios_disponiveis`;
  console.log('\n--- HORARIOS_DISPONIVEIS ---', horarios.length, 'registros');

  const notas = await sql`SELECT id, paciente_id, titulo, tipo_nota FROM prontuarios_notas`;
  console.log('\n--- PRONTUARIOS_NOTAS ---', notas);

  const anexos = await sql`SELECT id, paciente_id, nome_arquivo FROM prontuarios_anexos`;
  console.log('\n--- PRONTUARIOS_ANEXOS ---', anexos);
}

check().catch(console.error);
