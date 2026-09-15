require('dotenv').config();
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function cleanAndFix() {
  console.log('🚀 1. Desativando RLS para permitir visualização completa no Neon Console...');
  
  await sql`ALTER TABLE psicanalistas DISABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE pacientes DISABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE consultas DISABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE horarios_disponiveis DISABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE prontuarios_notas DISABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE prontuarios_anexos DISABLE ROW LEVEL SECURITY`;
  console.log('   ✅ RLS desativado. O console web do Neon agora exibe todos os registros.');

  console.log('\n🧹 2. Deletando dados fictícios de teste...');
  await sql`DELETE FROM consultas`;
  await sql`DELETE FROM prontuarios_notas`;
  await sql`DELETE FROM prontuarios_anexos`;
  await sql`DELETE FROM pacientes`;
  console.log('   ✅ Consultas, notas, anexos e pacientes fictícios foram removidos.');

  console.log('\n👩‍⚕️ 3. Garantindo cadastro oficial da Psicanalista Cristina Martins...');
  const targetEmail = 'cris_asmartins@hotmail.com';
  const defaultPass = process.env.ADMIN_PASSWORD || 'cris2026psi';
  const passwordHash = await bcrypt.hash(defaultPass, 10);

  const psiCheck = await sql`SELECT * FROM psicanalistas WHERE LOWER(email) = ${targetEmail.toLowerCase()}`;
  let psiId;
  if (psiCheck.length === 0) {
    const inserted = await sql`
      INSERT INTO psicanalistas (nome, email, senha_hash)
      VALUES ('Psicanalista Cristina Martins', ${targetEmail}, ${passwordHash})
      RETURNING *
    `;
    psiId = inserted[0].id;
    console.log('   ✅ Psicanalista Cristina Martins inserida com sucesso:', inserted[0]);
  } else {
    psiId = psiCheck[0].id;
    await sql`
      UPDATE psicanalistas
      SET nome = 'Psicanalista Cristina Martins',
          senha_hash = ${passwordHash}
      WHERE id = ${psiId}
    `;
    console.log('   ✅ Psicanalista Cristina Martins atualizada com sucesso (ID:', psiId, ')');
  }

  console.log('\n📅 4. Verificando grade semanal padrão para agendamentos...');
  const existingHorarios = await sql`SELECT count(*) FROM horarios_disponiveis WHERE psicanalista_id = ${psiId}`;
  console.log(`   Total de horários configurados: ${existingHorarios[0].count}`);

  console.log('\n📊 === ESTADO FINAL DO BANCO DE DADOS NEON ===');
  const psicanalistas = await sql`SELECT id, nome, email, created_at FROM psicanalistas`;
  console.log('PSICANALISTAS:', psicanalistas);

  const pacientes = await sql`SELECT * FROM pacientes`;
  console.log('PACIENTES (deve estar vazio):', pacientes);

  const consultas = await sql`SELECT * FROM consultas`;
  console.log('CONSULTAS (deve estar vazio):', consultas);

  console.log('\n🎉 LIMPEZA E AJUSTE CONCLUÍDOS COM SUCESSO!');
}

cleanAndFix().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
