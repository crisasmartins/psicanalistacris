-- =============================================================================
-- PROJETO PSICANALISTA - ESQUEMA DO BANCO DE DADOS (POSTGRESQL)
-- Atualizado para Prompt 4 (Prontuário Seguro & Criptografia)
-- =============================================================================

-- Habilita extensão para geração de UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. TABELA: psicanalistas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS psicanalistas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 2. TABELA: pacientes
-- -----------------------------------------------------------------------------
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
);

-- -----------------------------------------------------------------------------
-- 3. TABELA: consultas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
    data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT DEFAULT 'agendado' CHECK (status IN ('agendado', 'pago', 'cancelado', 'realizado')),
    valor_pago NUMERIC(10, 2),
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 4. TABELA: horarios_disponiveis
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horarios_disponiveis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    psicanalista_id UUID REFERENCES psicanalistas(id) ON DELETE CASCADE,
    dia_semana INTEGER CHECK (dia_semana BETWEEN 0 AND 6),
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    data_bloqueio DATE
);

-- -----------------------------------------------------------------------------
-- 5. TABELA: prontuarios_notas (Anotações Clínicas Criptografadas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prontuarios_notas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
    consulta_id UUID REFERENCES consultas(id) ON DELETE SET NULL,
    titulo TEXT,
    tipo_nota TEXT DEFAULT 'evolucao', -- 'evolucao', 'sessao', 'observacao', 'hipotese_analitica'
    conteudo_cifrado TEXT NOT NULL,    -- Criptografado com AES-256-GCM
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 6. TABELA: prontuarios_anexos (Arquivos, Laudos e PDFs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prontuarios_anexos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
    nome_arquivo TEXT NOT NULL,
    tipo_mime TEXT NOT NULL,
    tamanho_bytes INTEGER NOT NULL,
    dados_base64 TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- ÍNDICES DE OTIMIZAÇÃO
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pacientes_psicanalista ON pacientes(psicanalista_id);
CREATE INDEX IF NOT EXISTS idx_pacientes_email ON pacientes(email);
CREATE INDEX IF NOT EXISTS idx_consultas_paciente ON consultas(paciente_id);
CREATE INDEX IF NOT EXISTS idx_consultas_data_hora ON consultas(data_hora);
CREATE INDEX IF NOT EXISTS idx_horarios_psicanalista ON horarios_disponiveis(psicanalista_id);
CREATE INDEX IF NOT EXISTS idx_prontuarios_notas_paciente ON prontuarios_notas(paciente_id);
CREATE INDEX IF NOT EXISTS idx_prontuarios_anexos_paciente ON prontuarios_anexos(paciente_id);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) - Desativado para visibilidade total no Neon Console
-- -----------------------------------------------------------------------------
ALTER TABLE psicanalistas DISABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE consultas DISABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_disponiveis DISABLE ROW LEVEL SECURITY;
ALTER TABLE prontuarios_notas DISABLE ROW LEVEL SECURITY;
ALTER TABLE prontuarios_anexos DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- POLÍTICAS DE ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS psicanalistas_isolation_policy ON psicanalistas;
CREATE POLICY psicanalistas_isolation_policy ON psicanalistas
FOR ALL
USING (
    current_user = 'neondb_owner' 
    OR id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
)
WITH CHECK (
    current_user = 'neondb_owner' 
    OR id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
);

DROP POLICY IF EXISTS pacientes_isolation_policy ON pacientes;
CREATE POLICY pacientes_isolation_policy ON pacientes
FOR ALL
USING (
    current_user = 'neondb_owner'
    OR psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
)
WITH CHECK (
    current_user = 'neondb_owner'
    OR psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
);

DROP POLICY IF EXISTS consultas_isolation_policy ON consultas;
CREATE POLICY consultas_isolation_policy ON consultas
FOR ALL
USING (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
)
WITH CHECK (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
);

DROP POLICY IF EXISTS horarios_disponiveis_isolation_policy ON horarios_disponiveis;
CREATE POLICY horarios_disponiveis_isolation_policy ON horarios_disponiveis
FOR ALL
USING (
    current_user = 'neondb_owner'
    OR psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
)
WITH CHECK (
    current_user = 'neondb_owner'
    OR psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
);

DROP POLICY IF EXISTS prontuarios_notas_isolation_policy ON prontuarios_notas;
CREATE POLICY prontuarios_notas_isolation_policy ON prontuarios_notas
FOR ALL
USING (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
)
WITH CHECK (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
);

DROP POLICY IF EXISTS prontuarios_anexos_isolation_policy ON prontuarios_anexos;
CREATE POLICY prontuarios_anexos_isolation_policy ON prontuarios_anexos
FOR ALL
USING (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
)
WITH CHECK (
    current_user = 'neondb_owner'
    OR paciente_id IN (
        SELECT id FROM pacientes 
        WHERE psicanalista_id = NULLIF(current_setting('app.current_psicanalista_id', true), '')::UUID
    )
);
