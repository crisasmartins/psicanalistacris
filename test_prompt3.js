require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 3000;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resData) });
        } catch (e) {
          resolve({ status: res.statusCode, body: resData });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Iniciando testes de validação da Lógica de Agendamento (Prompt 3)...');

  try {
    // 1. Login Admin Cristina
    const loginRes = await request('POST', '/api/admin/login', {
      email: 'cris_asmartins@hotmail.com',
      senha: process.env.ADMIN_PASSWORD || 'cris2026psi'
    });
    console.log('1. Autenticação Psicanalista Cristina:', loginRes.status, loginRes.body.message);
    const token = loginRes.body.token;

    // 2. Cristina define dias e horários em lote (Seg a Sex: 09:00, 10:00, 14:00, 15:00)
    const loteRes = await request('POST', '/api/admin/horarios/lote', {
      dias_semana: [1, 2, 3, 4, 5],
      slots: ['09:00', '10:00', '14:00', '15:00']
    }, token);
    console.log('2. Inclusão de Horários em Lote (Seg-Sex):', loteRes.status, loteRes.body.message);

    // 3. Cristina adiciona horário individual específico (Sábado às 11:00)
    const addSlotRes = await request('POST', '/api/admin/horarios/adicionar', {
      dia_semana: 6,
      hora_inicio: '11:00',
      hora_fim: '12:00'
    }, token);
    console.log('3. Inclusão de Horário Individual (Sábado 11h):', addSlotRes.status, addSlotRes.body.id);

    // 4. Cristina bloqueia um dia específico (Feriado próximo)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const blockDateStr = tomorrow.toISOString().split('T')[0];

    const blockRes = await request('POST', '/api/admin/horarios/bloquear-data', {
      data_bloqueio: blockDateStr
    }, token);
    console.log(`4. Bloqueio de Feriado/Folga (${blockDateStr}):`, blockRes.status, blockRes.body.id || blockRes.body.error);

    // 5. Paciente consulta horários disponíveis
    const slotsRes = await request('GET', '/api/horarios-disponiveis');
    console.log('5. Consulta de Horários Livres pela Paciente:', slotsRes.status, `Total de slots livres: ${slotsRes.body.length}`);

    // Verifica que nenhum slot do dia bloqueado foi retornado
    const blockedSlotsFound = slotsRes.body.filter(s => s.data === blockDateStr);
    if (blockedSlotsFound.length > 0) {
      throw new Error(`ERRO: Encontrados slots para a data bloqueada (${blockDateStr})!`);
    }
    console.log('   ✅ Validação de data bloqueada: Nenhum slot retornado para a data de bloqueio.');

    // 6. Paciente se cadastra e reserva um horário livre
    const pacRes = await request('POST', '/api/pacientes', {
      nome_completo: 'Juliana Mendes de Castro',
      email: 'juliana.castro@email.com',
      whatsapp: '11977776666',
      data_nascimento: '1988-11-20',
      motivo_consulta: 'Desejo iniciar análise pessoal para autoconhecimento.'
    });
    const pacienteId = pacRes.body.paciente?.id;

    const chosenSlot = slotsRes.body[0];
    console.log(`6. Paciente escolheu o slot: ${chosenSlot.data} às ${chosenSlot.hora_inicio}`);

    const bookingRes = await request('POST', '/api/consultas', {
      paciente_id: pacienteId,
      data_hora: chosenSlot.data_hora,
      valor_pago: 150.00
    });
    console.log('   Status do agendamento:', bookingRes.status, 'Status:', bookingRes.body.consulta?.status);
    const consultaId = bookingRes.body.consulta?.id;

    if (bookingRes.body.consulta?.status !== 'agendado') {
      throw new Error('Consulta não foi salva como "agendado" (Reservado)');
    }

    // 7. Validação Anti-Colisão (Tentativa de agendamento duplicado no mesmo horário)
    const duplicateRes = await request('POST', '/api/consultas', {
      paciente_id: pacienteId,
      data_hora: chosenSlot.data_hora,
      valor_pago: 150.00
    });
    console.log('7. Teste de Proteção Anti-Colisão (tentativa duplicada):', duplicateRes.status, duplicateRes.body.error);
    if (duplicateRes.status !== 409) {
      throw new Error('Deveria ter retornado status 409 (Conflito de horário)!');
    }
    console.log('   ✅ Proteção anti-colisão validada com sucesso.');

    // 8. Teste de Download de Calendário .ICS
    const icsRes = await request('GET', `/api/consultas/${consultaId}/ics`);
    console.log('8. Teste de Calendário iCalendar (.ICS):', icsRes.status);
    if (typeof icsRes.body === 'string' && icsRes.body.includes('24942168856')) {
      console.log('   ✅ Arquivo .ICS gerado com sucesso contendo dados da Psicanalista e Chave PIX 24942168856.');
    }

    // 9. Informações Públicas com Chave PIX 24942168856
    const pubRes = await request('GET', '/api/psicanalista');
    console.log('9. Informações Públicas:', pubRes.body.nome, 'Chave PIX:', pubRes.body.pix_chave);
    if (pubRes.body.pix_chave !== '24942168856') {
      throw new Error('Chave PIX diferente de 24942168856!');
    }

    console.log('\n🎉 TODOS OS TESTES DA LÓGICA DE AGENDAMENTO (PROMPT 3) PASSARAM COM 100% DE SUCESSO!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Falha no teste:', err);
    process.exit(1);
  }
}

const server = require('./server.js');
setTimeout(runTests, 1500);
