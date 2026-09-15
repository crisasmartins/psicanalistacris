require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function testLive() {
  console.log('--- TESTANDO INSERÇÃO REAL NO NEON ---');
  
  // 1. Cadastrar um paciente de teste real
  const pResult = await sql`
    INSERT INTO pacientes (nome_completo, email, whatsapp, data_nascimento, motivo_consulta)
    VALUES ('Dra. Cristina Teste', 'cris_asmartins@hotmail.com', '(11) 99999-8888', '1985-06-15', 'Teste de verificação de persistência no Neon')
    RETURNING *
  `;
  console.log('✅ Paciente inserido no Neon:', pResult[0]);

  // 2. Verificar consulta no Neon
  const count = await sql`SELECT count(*) FROM pacientes`;
  console.log('✅ Total de pacientes no Neon agora:', count[0].count);

  // 3. Limpar após teste
  await sql`DELETE FROM pacientes WHERE id = ${pResult[0].id}`;
  console.log('✅ Paciente de teste limpo com sucesso.');
}

testLive().catch(console.error);
