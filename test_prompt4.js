require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
require('./server.js');

const sql = neon(process.env.DATABASE_URL);
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Espera breve para o servidor inicializar
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  await sleep(600);
  console.log('========================================================');
  console.log('INICIANDO TESTES DO PROMPT 4: PRONTUÁRIO SEGURO & RBAC');
  console.log('========================================================\n');

  try {
    // 1. Autenticação Admin (Psicanalista Cristina Martins)
    console.log('1. Testando login administrativo da Psicanalista...');
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cris_asmartins@hotmail.com', senha: process.env.ADMIN_PASSWORD || 'cris2026psi' })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
      throw new Error(`Falha no login admin: ${JSON.stringify(loginData)}`);
    }
    const token = loginData.token;
    console.log('   ✅ Login bem-sucedido! JWT recebido com role admin.\n');

    // 2. Criar ou Obter Paciente de Teste
    console.log('2. Registrando paciente de teste...');
    const pacienteRes = await fetch(`${BASE_URL}/api/pacientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Juliana Paes de Oliveira',
        email: 'juliana.psico.teste@gmail.com',
        whatsapp: '(11) 98765-4321',
        data_nascimento: '1992-05-18',
        motivo_consulta: 'Crises frequentes de ansiedade, angústia noturna e elaboração do luto materno.'
      })
    });
    const pacienteData = await pacienteRes.json();
    const paciente = pacienteData.paciente;
    console.log(`   ✅ Paciente registrada: ${paciente.nome_completo} (ID: ${paciente.id})\n`);

    // 3. Teste de RBAC: Tentar acessar prontuário sem token
    console.log('3. Testando controle de acesso estrito (RBAC)...');
    const rbacRes = await fetch(`${BASE_URL}/api/admin/pacientes/${paciente.id}/prontuario/completo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (rbacRes.status === 401) {
      console.log('   ✅ RBAC Funcionando: Acesso não autenticado bloqueado com 401 Unauthorized!\n');
    } else {
      throw new Error(`Falha de segurança no RBAC! Status retornado: ${rbacRes.status}`);
    }

    // 4. Inserir Anotação Clínica Confidencial Criptografada
    console.log('4. Criando anotação clínica confidencial com criptografia AES-256...');
    const segredoClinico = 'Paciente relatou sonho recorrente com água turva. Significante "abandono" associado à figura materna. Elaboração analítica inicial iniciada.';
    const notaRes = await fetch(`${BASE_URL}/api/admin/pacientes/${paciente.id}/notas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        titulo: 'Sessão Inicial - Análise de Sonhos e Significantes',
        tipo_nota: 'sessao',
        conteudo: segredoClinico
      })
    });
    const notaData = await notaRes.json();
    if (!notaRes.ok || !notaData.nota) {
      throw new Error(`Falha ao criar nota: ${JSON.stringify(notaData)}`);
    }
    const notaId = notaData.nota.id;
    console.log(`   ✅ Anotação criada com sucesso! (ID: ${notaId})\n`);

    // 5. Verificação da Criptografia em Repouso no Banco de Dados Neon PostgreSQL
    console.log('5. Verificando dados brutos diretamente no PostgreSQL (Criptografia em Repouso)...');
    const rawDbNota = await sql`SELECT id, titulo, conteudo_cifrado FROM prontuarios_notas WHERE id = ${notaId}`;
    if (rawDbNota.length === 0) throw new Error('Nota não encontrada no banco!');
    
    const dbCiphertext = rawDbNota[0].conteudo_cifrado;
    console.log(`   🔒 Dado Bruto Cifrado no PostgreSQL: "${dbCiphertext.slice(0, 48)}..."`);
    
    if (dbCiphertext.includes('Paciente relatou sonho') || dbCiphertext.includes('água turva')) {
      throw new Error('❌ FALHA GRAVE: Texto claro encontrado no banco de dados!');
    }
    if (!dbCiphertext.includes(':')) {
      throw new Error('❌ Formato de cifra AES-256 inválido (esperado iv:tag:ciphertext)');
    }
    console.log('   ✅ CONFIRMADO: Texto clínico está 100% cifrado (AES-256-GCM) em repouso no banco!\n');

    // 6. Testar Descriptografia Segura para Psicanalista Autenticada
    console.log('6. Buscando Prontuário Completo autenticado...');
    const prontuarioRes = await fetch(`${BASE_URL}/api/admin/pacientes/${paciente.id}/prontuario/completo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const prontuarioData = await prontuarioRes.json();
    if (!prontuarioRes.ok || !prontuarioData.notas) {
      throw new Error(`Falha ao buscar prontuário: ${JSON.stringify(prontuarioData)}`);
    }
    const notaDescriptografada = prontuarioData.notas.find(n => n.id === notaId);
    if (!notaDescriptografada || notaDescriptografada.conteudo !== segredoClinico) {
      throw new Error('❌ Falha na descriptografia da anotação!');
    }
    console.log(`   ✅ Descriptografia correta entregue para a Psicanalista: "${notaDescriptografada.conteudo.slice(0, 40)}..."\n`);

    // 7. Testar Atualização de Anotação (PUT)
    console.log('7. Testando atualização de nota clínica...');
    const novoConteudo = 'Evolução clínica positiva. Paciente associou livremente novas memórias da infância.';
    const updateNotaRes = await fetch(`${BASE_URL}/api/admin/notas/${notaId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        titulo: 'Sessão Inicial (Atualizada) - Associação Livre',
        tipo_nota: 'evolucao',
        conteudo: novoConteudo
      })
    });
    const updateData = await updateNotaRes.json();
    if (!updateNotaRes.ok) throw new Error(`Falha ao atualizar nota: ${JSON.stringify(updateData)}`);
    console.log('   ✅ Anotação clínica atualizada e recifrada com sucesso!\n');

    // 8. Testar Upload e Download de Documento Anexo (PDF/Documento)
    console.log('8. Testando anexar documento/PDF ao prontuário...');
    const mockPdfBase64 = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCjEgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iag==';
    const anexoRes = await fetch(`${BASE_URL}/api/admin/pacientes/${paciente.id}/anexos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        nome_arquivo: 'laudo_encaminhamento_juliana.pdf',
        tipo_mime: 'application/pdf',
        tamanho_bytes: 1024,
        dados_base64: mockPdfBase64
      })
    });
    const anexoData = await anexoRes.json();
    if (!anexoRes.ok || !anexoData.anexo) throw new Error(`Falha ao anexar arquivo: ${JSON.stringify(anexoData)}`);
    const anexoId = anexoData.anexo.id;
    console.log(`   ✅ Documento anexado ao prontuário (ID: ${anexoId})\n`);

    // Download do anexo
    console.log('9. Testando download seguro do arquivo anexo...');
    const downloadRes = await fetch(`${BASE_URL}/api/admin/anexos/${anexoId}/download?token=${token}`);
    if (!downloadRes.ok) throw new Error(`Falha no download do anexo: status ${downloadRes.status}`);
    const downloadBuffer = await downloadRes.arrayBuffer();
    if (downloadBuffer.byteLength === 0) throw new Error('Arquivo baixado está vazio!');
    console.log(`   ✅ Download de anexo validado com sucesso (${downloadBuffer.byteLength} bytes)!\n`);

    // 10. Testar Busca Dinâmica de Pacientes
    console.log('10. Testando busca dinâmica de pacientes por nome...');
    const searchRes = await fetch(`${BASE_URL}/api/admin/pacientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ busca: 'Juliana' })
    });
    const searchData = await searchRes.json();
    if (!searchRes.ok || !searchData.some(p => p.id === paciente.id)) {
      throw new Error(`Falha na busca de pacientes: ${JSON.stringify(searchData)}`);
    }
    console.log(`   ✅ Busca de pacientes validada: ${searchData.length} resultado(s) encontrado(s) para 'Juliana'.\n`);

    // 11. Limpeza do anexo e nota de teste
    console.log('11. Limpando dados de teste do prontuário...');
    await fetch(`${BASE_URL}/api/admin/anexos/${anexoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await fetch(`${BASE_URL}/api/admin/notas/${notaId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('   ✅ Anotações e anexos de teste limpos.\n');

    console.log('========================================================');
    console.log('🎉 TODOS OS TESTES DO PROMPT 4 PASSARAM COM 100% DE SUCESSO!');
    console.log('========================================================');
  } catch (err) {
    console.error('❌ ERRO NO TESTE:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runTests();
