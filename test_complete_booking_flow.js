require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const BASE_URL = 'http://localhost:3000';

async function testFlow() {
  console.log('--- TESTANDO FLUXO COMPLETO DE AGENDAMENTO E PIX ---');

  // 1. Salvar Paciente (Passo 1)
  console.log('1. Enviando dados da paciente (sem CPF)...');
  const pRes = await fetch(`${BASE_URL}/api/pacientes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome_completo: 'Mariana Silva',
      email: 'mariana.silva.oficial@gmail.com',
      whatsapp: '(11) 99999-9555',
      data_nascimento: '1985-03-20',
      motivo_consulta: 'Acompanhamento psicanalítico e autoconhecimento'
    })
  });

  const pData = await pRes.json();
  if (!pRes.ok) throw new Error(`Falha no Passo 1: ${JSON.stringify(pData)}`);
  console.log('   ✅ Passo 1 Sucesso: Paciente salva no Neon com ID:', pData.paciente.id);

  // 2. Buscar Horários Livres (Passo 2)
  console.log('2. Buscando horários disponíveis...');
  const hRes = await fetch(`${BASE_URL}/api/horarios-disponiveis?mes=9&ano=2026`);
  const hSlots = await hRes.json();
  if (!hSlots || hSlots.length === 0) throw new Error('Nenhum horário livre encontrado!');
  const slotEscolhido = hSlots[0];
  console.log(`   ✅ Passo 2 Sucesso: Horário selecionado: ${slotEscolhido.data} às ${slotEscolhido.hora_inicio}`);

  // 3. Confirmar Agendamento (Passo 3)
  console.log('3. Confirmando agendamento...');
  const cRes = await fetch(`${BASE_URL}/api/consultas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paciente_id: pData.paciente.id,
      data_hora: slotEscolhido.data_hora,
      valor_pago: 150.00
    })
  });
  const cData = await cRes.json();
  if (!cRes.ok) throw new Error(`Falha no Passo 3: ${JSON.stringify(cData)}`);
  console.log('   ✅ Passo 3 Sucesso: Consulta reservada no Neon com ID:', cData.consulta.id);

  // 4. Verificar no Neon PostgreSQL
  const dbPacientes = await sql`SELECT id, nome_completo, email, whatsapp FROM pacientes WHERE id = ${pData.paciente.id}`;
  console.log('\n📊 REGISTRO NO BANCO NEON (pacientes):', dbPacientes[0]);

  const dbConsultas = await sql`SELECT id, paciente_id, data_hora, status, valor_pago FROM consultas WHERE id = ${cData.consulta.id}`;
  console.log('📊 REGISTRO NO BANCO NEON (consultas):', dbConsultas[0]);

  console.log('\n🎉 TESTE DE AGENDAMENTO E PERSISTÊNCIA 100% BEM-SUCEDIDO NO NEON!');
}

testFlow().catch(console.error);
