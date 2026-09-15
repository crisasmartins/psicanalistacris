require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function test() {
  console.log('--- TESTANDO INSERT PACIENTE ---');
  try {
    const psi = await sql`SELECT id FROM psicanalistas WHERE email = 'cris_asmartins@hotmail.com'`;
    console.log('PSI ID:', psi[0].id);

    const res = await sql`
      INSERT INTO pacientes (psicanalista_id, nome_completo, email, whatsapp, data_nascimento, motivo_consulta)
      VALUES (${psi[0].id}, 'Mariana Silva', 'teste@gmail.com', '(11) 99999-9555', '1985-03-20', 'fsdfd')
      RETURNING *
    `;
    console.log('SUCESSO:', res);
  } catch (err) {
    console.error('ERRO EXATO DO POSTGRES:', err);
  }
}

test();
