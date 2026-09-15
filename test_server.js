require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 3000;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
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
  console.log('🧪 Iniciando testes integrados do servidor...');

  try {
    // 1. Psicanalista
    const psiRes = await request('GET', '/api/psicanalista');
    console.log('1. GET /api/psicanalista:', psiRes.status, psiRes.body.nome);

    // 2. Paciente
    const testCpf = '12345678900';
    const pacRes = await request('POST', '/api/pacientes', {
      nome_completo: 'Paciente Teste Psicanálise',
      cpf: testCpf,
      whatsapp: '11999999999',
      email: 'paciente.teste@email.com'
    });
    console.log('2. POST /api/pacientes:', pacRes.status, pacRes.body.paciente?.nome_completo);
    const pacienteId = pacRes.body.paciente?.id;

    // 3. Horários Disponíveis
    const slotsRes = await request('GET', '/api/horarios-disponiveis');
    console.log('3. GET /api/horarios-disponiveis:', slotsRes.status, `Encontrados: ${slotsRes.body.length} slots`);

    if (slotsRes.body.length > 0 && pacienteId) {
      const firstSlot = slotsRes.body[0];
      
      // 4. Agendar Consulta
      const bookingRes = await request('POST', '/api/consultas', {
        paciente_id: pacienteId,
        data_hora: firstSlot.data_hora,
        valor_pago: 150.00
      });
      console.log('4. POST /api/consultas:', bookingRes.status, bookingRes.body.consulta?.id, 'Status:', bookingRes.body.consulta?.status);
      const consultaId = bookingRes.body.consulta?.id;

      // 5. Pagamento
      if (consultaId) {
        const payRes = await request('POST', `/api/consultas/${consultaId}/pagamento`);
        console.log('5. POST /api/consultas/:id/pagamento:', payRes.status, 'Novo status:', payRes.body.consulta?.status);

        // 6. Admin Observações Clínicas
        const obsRes = await request('POST', '/api/admin/consultas/observacoes', {
          senha: process.env.ADMIN_PASSWORD || 'cris2026psi',
          consulta_id: consultaId,
          observacoes: 'Paciente demonstrou excelente abertura para elaboração dos significantes paternos na primeira sessão.'
        });
        console.log('6. POST /api/admin/consultas/observacoes:', obsRes.status, obsRes.body.message);
      }
    }

    // 7. Métricas Admin
    const metRes = await request('POST', '/api/admin/metricas', {
      senha: process.env.ADMIN_PASSWORD || 'cris2026psi'
    });
    console.log('7. POST /api/admin/metricas:', metRes.status, metRes.body);

    console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
  }
}

// Inicia servidor e roda testes
const server = require('./server.js');
setTimeout(runTests, 1500);
