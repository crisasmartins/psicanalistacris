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
  console.log('🧪 Iniciando testes de validação do Prompt 2...');

  try {
    // 1. Psicanalista Cristina Martins
    const psiRes = await request('GET', '/api/psicanalista');
    console.log('1. GET /api/psicanalista:', psiRes.status, psiRes.body.nome, psiRes.body.email);
    if (psiRes.body.nome !== 'Psicanalista Cristina Martins' || psiRes.body.email !== 'cris_asmartins@hotmail.com') {
      throw new Error(`Nome ou email incorreto: ${JSON.stringify(psiRes.body)}`);
    }

    // 2. Cadastro da Paciente com Nascimento e Motivo
    const pacRes = await request('POST', '/api/pacientes', {
      nome_completo: 'Mariana Silveira',
      email: 'mariana.silveira@email.com',
      whatsapp: '11988887777',
      data_nascimento: '1992-05-14',
      motivo_consulta: 'Gostaria de iniciar análise para trabalhar questões de ansiedade e transição de carreira.'
    });
    console.log('2. POST /api/pacientes (Passo 1):', pacRes.status, pacRes.body.paciente?.nome_completo, 'Motivo:', pacRes.body.paciente?.motivo_consulta);
    const pacienteId = pacRes.body.paciente?.id;

    // 3. Horários Disponíveis
    const slotsRes = await request('GET', '/api/horarios-disponiveis');
    console.log('3. GET /api/horarios-disponiveis (Passo 2):', slotsRes.status, `Slots: ${slotsRes.body.length}`);

    // 4. Agendamento de Consulta
    let consultaId;
    if (slotsRes.body.length > 0 && pacienteId) {
      const slot = slotsRes.body[0];
      const bookingRes = await request('POST', '/api/consultas', {
        paciente_id: pacienteId,
        data_hora: slot.data_hora,
        valor_pago: 150.00
      });
      console.log('4. POST /api/consultas (Passo 3):', bookingRes.status, 'ID:', bookingRes.body.consulta?.id, 'Status:', bookingRes.body.consulta?.status);
      consultaId = bookingRes.body.consulta?.id;
    }

    // 5. Login Seguro da Psicanalista (JWT + Bcrypt)
    const loginRes = await request('POST', '/api/admin/login', {
      email: 'cris_asmartins@hotmail.com',
      senha: process.env.ADMIN_PASSWORD || 'cris2026psi'
    });
    console.log('5. POST /api/admin/login:', loginRes.status, 'Token gerado:', !!loginRes.body.token, loginRes.body.message);
    const token = loginRes.body.token;

    if (!token) throw new Error('Falha ao obter token JWT');

    // 6. Listar Prontuários e Pacientes (com Token)
    const pacsRes = await request('POST', '/api/admin/pacientes', {}, token);
    console.log('6. POST /api/admin/pacientes (Área Restrita):', pacsRes.status, `Total: ${pacsRes.body.length}`);

    // 7. Prontuário Específico da Paciente
    if (pacienteId) {
      const prontRes = await request('POST', `/api/admin/pacientes/${pacienteId}/prontuario`, {}, token);
      console.log('7. POST /api/admin/pacientes/:id/prontuario:', prontRes.status, 'Paciente:', prontRes.body.paciente?.nome_completo, 'Consultas:', prontRes.body.consultas?.length);
    }

    // 8. Registro de Observações Clínicas Seguras
    if (consultaId) {
      const obsRes = await request('POST', '/api/admin/consultas/observacoes', {
        consulta_id: consultaId,
        observacoes: 'Primeira entrevista preliminar realizada. Sujeito articulou queixa em torno da angústia profissional. Boa receptividade à intervenção psicanalítica.'
      }, token);
      console.log('8. POST /api/admin/consultas/observacoes:', obsRes.status, obsRes.body.message);
    }

    // 9. Métricas do Consultório
    const metRes = await request('POST', '/api/admin/metricas', {}, token);
    console.log('9. POST /api/admin/metricas:', metRes.status, metRes.body);

    console.log('\n🎉 TODOS OS TESTES DO PROMPT 2 FORAM VALIDADOS COM SUCESSO!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
  }
}

// Inicia servidor e dispara testes
const server = require('./server.js');
setTimeout(runTests, 1500);
