require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function fix() {
  console.log('--- REMOVENDO CONSTRAINT NOT NULL DE CPF ---');
  await sql`ALTER TABLE pacientes ALTER COLUMN cpf DROP NOT NULL`;
  console.log('✅ Constraint NOT NULL de cpf removida com sucesso!');

  // Testando inserção de paciente sem CPF
  const psi = await sql`SELECT id FROM psicanalistas WHERE email = 'cris_asmartins@hotmail.com'`;
  const res = await sql`
    INSERT INTO pacientes (psicanalista_id, nome_completo, email, whatsapp, data_nascimento, motivo_consulta)
    VALUES (${psi[0].id}, 'Mariana Silva Teste', 'mariana.silva@gmail.com', '(11) 99999-9555', '1985-03-20', 'Busca por autoconhecimento e psicoterapia')
    RETURNING *
  `;
  console.log('✅ Paciente inserida no Neon com sucesso:', res[0]);

  // Limpando teste
  await sql`DELETE FROM pacientes WHERE id = ${res[0].id}`;
  console.log('✅ Limpeza concluída.');
}

fix().catch(console.error);
