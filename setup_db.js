require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida no .env');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function runSetup() {
  console.log('🚀 Iniciando sincronização no banco Neon "Projeto Psicanalista"...');

  try {
    // 1. Extensão pgcrypto
    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

    // 2. Criação / Migração da tabela psicanalistas
    await sql`
      CREATE TABLE IF NOT EXISTS psicanalistas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`ALTER TABLE psicanalistas ADD COLUMN IF NOT EXISTS senha_hash TEXT`;

    // 3. Tabela pacientes
    await sql`
      CREATE TABLE IF NOT EXISTS pacientes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        psicanalista_id UUID REFERENCES psicanalistas(id) ON DELETE CASCADE,
        nome_completo TEXT NOT NULL,
        cpf TEXT,
        whatsapp TEXT,
        email TEXT,
        data_nascimento DATE,
        motivo_consulta TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS psicanalista_id UUID REFERENCES psicanalistas(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS cpf TEXT`;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS data_nascimento DATE`;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS motivo_consulta TEXT`;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS valor_base_sessao NUMERIC(10, 2) DEFAULT 180.00`;
    await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS creditos_sessoes INTEGER DEFAULT 0`;

    // 4. Tabela consultas
    await sql`
      CREATE TABLE IF NOT EXISTS consultas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
        data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
        status TEXT DEFAULT 'agendado' CHECK (status IN ('agendado', 'pago', 'cancelado', 'realizado')),
        valor_pago NUMERIC(10, 2),
        observacoes TEXT,
        transacao_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(10, 2)`;
    await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS observacoes TEXT`;
    await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS transacao_id UUID`;

    // 5. Tabela horarios_disponiveis
    await sql`
      CREATE TABLE IF NOT EXISTS horarios_disponiveis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        psicanalista_id UUID REFERENCES psicanalistas(id) ON DELETE CASCADE,
        dia_semana INTEGER CHECK (dia_semana BETWEEN 0 AND 6),
        hora_inicio TIME NOT NULL,
        hora_fim TIME NOT NULL,
        data_bloqueio DATE
      )
    `;
    await sql`ALTER TABLE horarios_disponiveis ADD COLUMN IF NOT EXISTS hora_fim TIME`;
    await sql`ALTER TABLE horarios_disponiveis ADD COLUMN IF NOT EXISTS data_bloqueio DATE`;

    // 6. Tabela prontuarios_notas (Criptografia AES-256)
    await sql`
      CREATE TABLE IF NOT EXISTS prontuarios_notas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
        consulta_id UUID REFERENCES consultas(id) ON DELETE SET NULL,
        titulo TEXT,
        tipo_nota TEXT DEFAULT 'evolucao',
        conteudo_cifrado TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 7. Tabela prontuarios_anexos
    await sql`
      CREATE TABLE IF NOT EXISTS prontuarios_anexos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
        nome_arquivo TEXT NOT NULL,
        tipo_mime TEXT NOT NULL,
        tamanho_bytes INTEGER NOT NULL,
        dados_base64 TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 8. Tabela transacoes_pagamentos (Módulo Financeiro & Gateway)
    await sql`
      CREATE TABLE IF NOT EXISTS transacoes_pagamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
        consulta_id UUID REFERENCES consultas(id) ON DELETE SET NULL,
        tipo_pacote TEXT NOT NULL CHECK (tipo_pacote IN ('avulso', 'mensal', 'trimestral', 'semestral')),
        quantidade_sessoes INTEGER NOT NULL DEFAULT 1,
        valor_base_unitario NUMERIC(10, 2) NOT NULL,
        desconto_percentual NUMERIC(5, 2) DEFAULT 0.00,
        valor_total NUMERIC(10, 2) NOT NULL,
        forma_pagamento TEXT NOT NULL CHECK (forma_pagamento IN ('pix', 'cartao_credito')),
        parcelas INTEGER DEFAULT 1,
        valor_parcela NUMERIC(10, 2),
        status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado', 'estornado')),
        pix_copia_cola TEXT,
        pix_qrcode_base64 TEXT,
        cartao_ultimos_digitos TEXT,
        cartao_bandeira TEXT,
        gateway_id TEXT,
        gateway_resposta JSONB,
        pago_em TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 9. Tabela notificacoes_admin
    await sql`
      CREATE TABLE IF NOT EXISTS notificacoes_admin (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titulo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        tipo TEXT DEFAULT 'pagamento',
        lida BOOLEAN DEFAULT FALSE,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 10. Desativa RLS para visualização no Neon Console
    await sql`ALTER TABLE psicanalistas DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE pacientes DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE consultas DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE horarios_disponiveis DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE prontuarios_notas DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE prontuarios_anexos DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE transacoes_pagamentos DISABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE notificacoes_admin DISABLE ROW LEVEL SECURITY`;

    // 9. Cadastro Oficial da Psicanalista Cristina Martins
    const defaultPass = process.env.ADMIN_PASSWORD || 'cris2026psi';
    const passwordHash = await bcrypt.hash(defaultPass, 10);
    const targetEmail = 'cris_asmartins@hotmail.com';

    const existingPsi = await sql`SELECT * FROM psicanalistas WHERE LOWER(email) = ${targetEmail.toLowerCase()}`;
    let psiId;
    if (existingPsi.length === 0) {
      const inserted = await sql`
        INSERT INTO psicanalistas (nome, email, senha_hash)
        VALUES ('Psicanalista Cristina Martins', ${targetEmail}, ${passwordHash})
        RETURNING *
      `;
      psiId = inserted[0].id;
      console.log('✅ Psicanalista inserida:', inserted[0]);
    } else {
      psiId = existingPsi[0].id;
      await sql`
        UPDATE psicanalistas
        SET nome = 'Psicanalista Cristina Martins',
            senha_hash = ${passwordHash}
        WHERE id = ${psiId}
      `;
      console.log('✅ Psicanalista atualizada (ID:', psiId, ')');
    }

    // 10. Grade padrão de horários se estiver vazia
    const existingSlots = await sql`SELECT count(*) FROM horarios_disponiveis WHERE psicanalista_id = ${psiId}`;
    if (parseInt(existingSlots[0].count) === 0) {
      console.log('⚡ Criando grade padrão semanal (Seg-Sex, 08:00 - 21:00)...');
      const dias = [1, 2, 3, 4, 5]; // Seg a Sex
      const slots = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
      for (const d of dias) {
        for (const s of slots) {
          const [h, m] = s.split(':');
          const hFim = `${String(parseInt(h) + 1).padStart(2, '0')}:${m || '00'}`;
          await sql`
            INSERT INTO horarios_disponiveis (psicanalista_id, dia_semana, hora_inicio, hora_fim)
            VALUES (${psiId}, ${d}, ${s}, ${hFim})
          `;
        }
      }
      console.log('✅ Grade padrão criada com sucesso!');
    }

    console.log('\n📊 === TABELAS SINCRONIZADAS NO NEON ===');
    const psis = await sql`SELECT id, nome, email, created_at FROM psicanalistas`;
    console.log('PSICANALISTAS:', psis);

    const pacientes = await sql`SELECT count(*) FROM pacientes`;
    console.log('PACIENTES:', pacientes[0].count);

    const consultas = await sql`SELECT count(*) FROM consultas`;
    console.log('CONSULTAS:', consultas[0].count);

    const horarios = await sql`SELECT count(*) FROM horarios_disponiveis`;
    console.log('HORARIOS_DISPONIVEIS:', horarios[0].count);

    console.log('\n🎉 SINCRONIZAÇÃO COMPLETA NO NEON REALIZADA COM SUCESSO!');
  } catch (err) {
    console.error('❌ Erro no setup:', err);
    process.exit(1);
  }
}

runSetup();
