require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { neon } = require('@neondatabase/serverless');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'psicanalista_cristina_martins_jwt_secret_2026_safe';
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'psicanalise_cristina_martins_aes256_key_secreta_2026';

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida no .env');
  process.exit(1);
}

// =====================================================
// HELPER PIX (EMV / BR CODE & QR CODE)
// =====================================================
function formatPixEMV({ chave, nome, cidade, valor, txId }) {
  function formatField(id, value) {
    const len = String(value.length).padStart(2, '0');
    return `${id}${len}${value}`;
  }

  const gui = formatField('00', 'br.gov.bcb.pix');
  const key = formatField('01', chave);
  const accountInfo = formatField('26', `${gui}${key}`);
  const mcc = formatField('52', '0000');
  const currency = formatField('53', '986');
  const amountStr = (valor && Number(valor) > 0) ? Number(valor).toFixed(2) : '';
  const amountField = amountStr ? formatField('54', amountStr) : '';
  const country = formatField('58', 'BR');
  const cleanName = (nome || 'CRISTINA MARTINS').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 25);
  const nameField = formatField('59', cleanName);
  const cleanCity = (cidade || 'SAO PAULO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 15);
  const cityField = formatField('60', cleanCity);
  const refLabel = formatField('05', (txId || 'PSICRIS').slice(0, 25));
  const additional = formatField('62', refLabel);

  let raw = `000201${accountInfo}${mcc}${currency}${amountField}${country}${nameField}${cityField}${additional}6304`;

  let crc = 0xFFFF;
  for (let i = 0; i < raw.length; i++) {
    crc ^= (raw.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
  return `${raw}${crcHex}`;
}

// =====================================================
// HELPER CÁLCULO DE PACOTES E DESCONTOS
// =====================================================
function calcularOpcoesPacotes(valorBase) {
  const vb = Number(valorBase) > 0 ? Number(valorBase) : 180.00;

  const avulsaTotal = vb;
  const mensalTotal = Math.round(4 * vb * 100) / 100;
  const trimestralBruto = Math.round(12 * vb * 100) / 100;
  const trimestralTotal = Math.round(trimestralBruto * 0.95 * 100) / 100;
  const trimestralEconomia = Math.round((trimestralBruto - trimestralTotal) * 100) / 100;

  const semestralBruto = Math.round(24 * vb * 100) / 100;
  const semestralTotal = Math.round(semestralBruto * 0.92 * 100) / 100;
  const semestralEconomia = Math.round((semestralBruto - semestralTotal) * 100) / 100;

  return {
    valor_base_unitario: vb,
    pacotes: {
      avulso: {
        tipo: 'avulso',
        nome: 'Sessão Avulsa',
        sessoes: 1,
        valor_base_unitario: vb,
        valor_bruto: avulsaTotal,
        desconto_percentual: 0,
        valor_total: avulsaTotal,
        economia: 0,
        max_parcelas: 1,
        descricao: 'Atendimento individual pontual de 50 minutos',
        parcelamento_info: '1x de R$ ' + avulsaTotal.toFixed(2).replace('.', ',')
      },
      mensal: {
        tipo: 'mensal',
        nome: 'Pacote Mensal (4 Sessões)',
        sessoes: 4,
        valor_base_unitario: vb,
        valor_bruto: mensalTotal,
        desconto_percentual: 0,
        valor_total: mensalTotal,
        economia: 0,
        max_parcelas: 3,
        descricao: '1 sessão semanal para acompanhamento contínuo',
        parcelamento_info: 'Até 3x de R$ ' + (mensalTotal / 3).toFixed(2).replace('.', ',')
      },
      trimestral: {
        tipo: 'trimestral',
        nome: 'Pacote Trimestral (12 Sessões)',
        badge_desconto: '5% OFF',
        sessoes: 12,
        valor_base_unitario: vb,
        valor_bruto: trimestralBruto,
        desconto_percentual: 5.0,
        valor_total: trimestralTotal,
        economia: trimestralEconomia,
        max_parcelas: 3,
        descricao: 'Aprofundamento terapêutico com 5% de desconto',
        parcelamento_info: 'Até 3x sem juros de R$ ' + (trimestralTotal / 3).toFixed(2).replace('.', ',')
      },
      semestral: {
        tipo: 'semestral',
        nome: 'Pacote Semestral (24 Sessões)',
        badge_desconto: '8% OFF',
        sessoes: 24,
        valor_base_unitario: vb,
        valor_bruto: semestralBruto,
        desconto_percentual: 8.0,
        valor_total: semestralTotal,
        economia: semestralEconomia,
        max_parcelas: 6,
        descricao: 'Percurso analítico continuado com 8% de desconto',
        parcelamento_info: 'Até 6x sem juros de R$ ' + (semestralTotal / 6).toFixed(2).replace('.', ',')
      }
    }
  };
}

// Conexão Neon PostgreSQL
const sql = neon(process.env.DATABASE_URL);

// Middlewares (aumenta limite de JSON para permitir upload de anexos/PDFs em base64)
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// MÓDULO CRIPTOGRÁFICO (AES-256-GCM)
// Garante que anotações confidenciais fiquem criptografadas no banco
// =====================================================
const AES_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

function encryptData(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptData(ciphertext) {
  if (!ciphertext) return '';
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext; // Fallback caso não esteja no formato cifrado
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Erro ao descriptografar dado:', err.message);
    return '[Conteúdo Criptografado com Chave Incompatível]';
  }
}

// Helper para obter dados da Psicanalista Cristina Martins
async function getPsicanalista() {
  const result = await sql`
    SELECT id, nome, email, senha_hash 
    FROM psicanalistas 
    WHERE email = 'cris_asmartins@hotmail.com'
    LIMIT 1
  `;
  if (result.length > 0) return result[0];

  const fallback = await sql`SELECT id, nome, email, senha_hash FROM psicanalistas LIMIT 1`;
  if (fallback.length > 0) return fallback[0];

  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'cris2026psi', 10);
  const created = await sql`
    INSERT INTO psicanalistas (nome, email, senha_hash)
    VALUES ('Psicanalista Cristina Martins', 'cris_asmartins@hotmail.com', ${hash})
    RETURNING id, nome, email, senha_hash
  `;
  return created[0];
}

// Middleware de Autenticação Rigorosa (RBAC)
async function authenticatePsicanalista(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
      ? authHeader.split(' ')[1] 
      : (req.body?.token || req.query?.token);

    const bodySenha = req.body?.senha;
    const adminPass = process.env.ADMIN_PASSWORD || 'cris2026psi';

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.psicanalista = decoded;
      return next();
    } else if (bodySenha && bodySenha === adminPass) {
      req.psicanalista = { email: 'cris_asmartins@hotmail.com' };
      return next();
    }

    return res.status(401).json({ error: 'Acesso restrito. Autentique-se como Administradora/Psicanalista.' });
  } catch (err) {
    return res.status(401).json({ error: 'Sessão expirada ou token inválido.' });
  }
}

// =====================================================
// ROTAS PÚBLICAS (PACIENTES)
// =====================================================

// Informações públicas do consultório
app.get('/api/psicanalista', async (req, res) => {
  try {
    const psi = await getPsicanalista();
    res.json({
      id: psi.id,
      nome: psi.nome,
      email: psi.email,
      pix_chave: '24942168856'
    });
  } catch (err) {
    console.error('Erro ao buscar psicanalista:', err);
    res.status(500).json({ error: 'Erro ao carregar dados do consultório.' });
  }
});

// Horários disponíveis para agendamento (Calendário Interativo)
app.get('/api/horarios-disponiveis', async (req, res) => {
  try {
    const psi = await getPsicanalista();
    const now = new Date();

    const mes = parseInt(req.query.mes) || (now.getMonth() + 1);
    const ano = parseInt(req.query.ano) || now.getFullYear();

    // 1. Busca grade semanal e bloqueios
    const grade = await sql`
      SELECT * FROM horarios_disponiveis 
      WHERE psicanalista_id = ${psi.id}
      ORDER BY dia_semana ASC, hora_inicio ASC
    `;

    const weeklySlots = grade.filter(g => g.dia_semana !== null && g.dia_semana !== undefined);
    const blockedDatesSet = new Set(
      grade
        .filter(g => g.data_bloqueio !== null && g.data_bloqueio !== undefined)
        .map(g => {
          const raw = g.data_bloqueio;
          return typeof raw === 'string' ? raw.split('T')[0] : new Date(raw).toISOString().split('T')[0];
        })
    );

    // 2. Busca consultas ativas
    const bookedConsultas = await sql`
      SELECT data_hora, status FROM consultas 
      WHERE status IN ('agendado', 'pago', 'realizado')
    `;

    const bookedSet = new Set();
    bookedConsultas.forEach(c => {
      const d = new Date(c.data_hora);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      bookedSet.add(`${y}-${m}-${day} ${h}:${min}:00`);
      bookedSet.add(`${y}-${m}-${day} ${h}:${min}`);
      bookedSet.add(`${y}-${m}-${day}T${h}:${min}:00`);
      bookedSet.add(`${y}-${m}-${day}T${h}:${min}`);
    });

    const totalDaysInMonth = new Date(ano, mes, 0).getDate();
    const availableSlots = [];

    // Se não houver horários cadastrados na grade, utiliza padrão até as 21h (Seg a Sex)
    const effectiveWeeklySlots = weeklySlots.length > 0 ? weeklySlots : [
      ...[1, 2, 3, 4, 5].flatMap(d => 
        ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'].map(s => {
          const [h, min] = s.split(':');
          const hFim = `${String(parseInt(h) + 1).padStart(2, '0')}:${min || '00'}`;
          return { dia_semana: d, hora_inicio: s, hora_fim: hFim };
        })
      )
    ];

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dateObj = new Date(ano, mes - 1, day);
      const dayOfWeek = dateObj.getDay();
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Se a data estiver bloqueada por folga/feriado
      if (blockedDatesSet.has(dateStr)) continue;

      const daySlots = effectiveWeeklySlots.filter(s => s.dia_semana === dayOfWeek);

      for (const slot of daySlots) {
        const hInicio = typeof slot.hora_inicio === 'string' ? slot.hora_inicio.slice(0, 5) : '09:00';
        const hFim = slot.hora_fim ? slot.hora_fim.slice(0, 5) : `${String(parseInt(hInicio.split(':')[0]) + 1).padStart(2, '0')}:${hInicio.split(':')[1]}`;
        
        const slotKey1 = `${dateStr} ${hInicio}:00`;
        const slotKey2 = `${dateStr} ${hInicio}`;
        const slotKey3 = `${dateStr}T${hInicio}:00`;
        const slotKey4 = `${dateStr}T${hInicio}`;

        if (bookedSet.has(slotKey1) || bookedSet.has(slotKey2) || bookedSet.has(slotKey3) || bookedSet.has(slotKey4)) {
          continue;
        }

        availableSlots.push({
          id: `${dateStr}_${hInicio}`,
          data: dateStr,
          dia_semana: dayOfWeek,
          hora_inicio: hInicio,
          hora_fim: hFim,
          data_hora: `${dateStr} ${hInicio}:00`
        });
      }
    }

    res.json(availableSlots);
  } catch (err) {
    console.error('Erro ao calcular horários disponíveis:', err);
    res.status(500).json({ error: 'Erro ao carregar horários disponíveis.' });
  }
});


// Cadastro ou identificação da paciente
app.post('/api/pacientes', async (req, res) => {
  try {
    const { nome_completo, email, whatsapp, data_nascimento, motivo_consulta } = req.body;

    if (!nome_completo || !email || !whatsapp) {
      return res.status(400).json({ error: 'Nome completo, e-mail e WhatsApp são obrigatórios.' });
    }

    const psi = await getPsicanalista();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await sql`SELECT * FROM pacientes WHERE LOWER(email) = ${cleanEmail}`;
    let paciente;

    if (existing.length > 0) {
      const updated = await sql`
        UPDATE pacientes
        SET nome_completo = ${nome_completo.trim()},
            whatsapp = ${whatsapp.trim()},
            data_nascimento = ${data_nascimento || existing[0].data_nascimento || null},
            motivo_consulta = ${motivo_consulta ? motivo_consulta.trim() : existing[0].motivo_consulta || null}
        WHERE id = ${existing[0].id}
        RETURNING *
      `;
      paciente = updated[0];
    } else {
      const created = await sql`
        INSERT INTO pacientes (psicanalista_id, nome_completo, email, whatsapp, data_nascimento, motivo_consulta)
        VALUES (${psi.id}, ${nome_completo.trim()}, ${cleanEmail}, ${whatsapp.trim()}, ${data_nascimento || null}, ${motivo_consulta ? motivo_consulta.trim() : null})
        RETURNING *
      `;
      paciente = created[0];
    }

    res.status(200).json({
      message: 'Paciente identificada com sucesso.',
      paciente
    });
  } catch (err) {
    console.error('Erro ao salvar paciente:', err);
    res.status(500).json({ error: 'Erro ao processar dados da paciente.' });
  }
});

// Login paciente por E-mail
app.post('/api/pacientes/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Informe seu e-mail cadastrado.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await sql`SELECT * FROM pacientes WHERE LOWER(email) = ${cleanEmail}`;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada. Preencha o formulário para agendar.' });
    }

    res.json({ paciente: result[0] });
  } catch (err) {
    console.error('Erro no login do paciente:', err);
    res.status(500).json({ error: 'Erro ao acessar perfil da paciente.' });
  }
});

// Opções de Pagamento e Pacientes Personalizadas
app.get('/api/pacientes/:id/opcoes-pagamento', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sql`SELECT id, nome_completo, email, whatsapp, valor_base_sessao, creditos_sessoes FROM pacientes WHERE id = ${id}`;
    if (result.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }
    const paciente = result[0];
    const valorBase = Number(paciente.valor_base_sessao) || 180.00;
    const creditos = parseInt(paciente.creditos_sessoes) || 0;
    const opcoes = calcularOpcoesPacotes(valorBase);

    res.json({
      paciente: {
        id: paciente.id,
        nome_completo: paciente.nome_completo,
        email: paciente.email,
        whatsapp: paciente.whatsapp,
        valor_base_sessao: valorBase,
        creditos_sessoes: creditos
      },
      valor_base_unitario: valorBase,
      creditos_sessoes: creditos,
      pacotes: opcoes.pacotes
    });
  } catch (err) {
    console.error('Erro ao calcular opções de pagamento:', err);
    res.status(500).json({ error: 'Erro ao carregar opções de pagamento.' });
  }
});

// Atualizar Valor Base da Sessão da Paciente (Exclusivo Administradora Cristina)
app.put('/api/admin/pacientes/:id/valor-base', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.params;
    const { valor_base_sessao } = req.body;
    const vb = parseFloat(valor_base_sessao);

    if (isNaN(vb) || vb <= 0) {
      return res.status(400).json({ error: 'Informe um valor base de sessão válido (maior que zero).' });
    }

    const updated = await sql`
      UPDATE pacientes
      SET valor_base_sessao = ${vb}
      WHERE id = ${id}
      RETURNING id, nome_completo, email, valor_base_sessao, creditos_sessoes
    `;

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }

    res.json({
      message: `Valor base por sessão da paciente ${updated[0].nome_completo} atualizado para R$ ${vb.toFixed(2).replace('.', ',')}`,
      paciente: updated[0]
    });
  } catch (err) {
    console.error('Erro ao atualizar valor base da paciente:', err);
    res.status(500).json({ error: 'Erro ao atualizar valor base da paciente.' });
  }
});

// Ajustar Créditos da Paciente (Administradora)
app.put('/api/admin/pacientes/:id/creditos', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.params;
    const { creditos_sessoes } = req.body;
    const creds = parseInt(creditos_sessoes);

    if (isNaN(creds) || creds < 0) {
      return res.status(400).json({ error: 'Informe um saldo de créditos válido.' });
    }

    const updated = await sql`
      UPDATE pacientes
      SET creditos_sessoes = ${creds}
      WHERE id = ${id}
      RETURNING id, nome_completo, email, valor_base_sessao, creditos_sessoes
    `;

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }

    res.json({
      message: `Saldo de créditos atualizado para ${creds} sessões.`,
      paciente: updated[0]
    });
  } catch (err) {
    console.error('Erro ao ajustar créditos da paciente:', err);
    res.status(500).json({ error: 'Erro ao ajustar créditos.' });
  }
});

// Iniciar Checkout & Pagamento Seguro (PIX / Cartão)
app.post('/api/checkout/iniciar', async (req, res) => {
  try {
    const { 
      paciente_id, 
      tipo_pacote, 
      forma_pagamento, 
      parcelas = 1, 
      dados_cartao, 
      consulta_data_hora, 
      observacoes 
    } = req.body;

    if (!paciente_id || !tipo_pacote || !forma_pagamento) {
      return res.status(400).json({ error: 'Dados incompletos para o checkout.' });
    }

    const pacienteResult = await sql`SELECT * FROM pacientes WHERE id = ${paciente_id}`;
    if (pacienteResult.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }
    const paciente = pacienteResult[0];

    const valorBase = Number(paciente.valor_base_sessao) || 180.00;
    const opcoes = calcularOpcoesPacotes(valorBase);
    const pacote = opcoes.pacotes[tipo_pacote];

    if (!pacote) {
      return res.status(400).json({ error: 'Tipo de pacote inválido.' });
    }

    const numParcelas = Math.max(1, Math.min(parseInt(parcelas) || 1, pacote.max_parcelas));
    const valorParcela = Math.round((pacote.valor_total / numParcelas) * 100) / 100;

    // Se estiver agendando uma data diretamente no checkout, valida conflito de horário
    if (consulta_data_hora) {
      const conflict = await sql`
        SELECT id FROM consultas 
        WHERE data_hora = ${consulta_data_hora} AND status != 'cancelado'
      `;
      if (conflict.length > 0) {
        return res.status(409).json({ 
          error: 'Este horário acabou de ser reservado. Por favor, selecione outro horário no calendário.' 
        });
      }
    }

    if (forma_pagamento === 'pix') {
      // 1. Geração de PIX Dinâmico com Copia e Cola e QR Code
      const txCode = 'TX' + Date.now().toString().slice(-8);
      const pixCopiaECola = formatPixEMV({
        chave: '24942168856',
        nome: 'CRISTINA MARTINS',
        cidade: 'SAO PAULO',
        valor: pacote.valor_total,
        txId: txCode
      });

      const qrcodeDataUrl = await QRCode.toDataURL(pixCopiaECola, {
        margin: 1,
        width: 320,
        color: {
          dark: '#1a1a1a',
          light: '#ffffff'
        }
      });

      const meta = {
        consulta_data_hora: consulta_data_hora || null,
        observacoes: observacoes || null,
        tx_code: txCode
      };

      const transacaoResult = await sql`
        INSERT INTO transacoes_pagamentos (
          paciente_id,
          tipo_pacote,
          quantidade_sessoes,
          valor_base_unitario,
          desconto_percentual,
          valor_total,
          forma_pagamento,
          parcelas,
          valor_parcela,
          status,
          pix_copia_cola,
          pix_qrcode_base64,
          gateway_id,
          gateway_resposta
        )
        VALUES (
          ${paciente.id},
          ${pacote.tipo},
          ${pacote.sessoes},
          ${pacote.valor_base_unitario},
          ${pacote.desconto_percentual},
          ${pacote.valor_total},
          'pix',
          1,
          ${pacote.valor_total},
          'pendente',
          ${pixCopiaECola},
          ${qrcodeDataUrl},
          ${txCode},
          ${JSON.stringify(meta)}
        )
        RETURNING *
      `;

      return res.status(201).json({
        success: true,
        status: 'pendente',
        transacao_id: transacaoResult[0].id,
        tipo_pacote: pacote.tipo,
        nome_pacote: pacote.nome,
        valor_total: pacote.valor_total,
        desconto_percentual: pacote.desconto_percentual,
        pix_copia_cola: pixCopiaECola,
        pix_qrcode_base64: qrcodeDataUrl,
        chave_pix: '24942168856',
        beneficiario: 'Psicanalista Cristina Martins',
        expira_em_minutos: 15
      });

    } else if (forma_pagamento === 'cartao_credito') {
      // 2. Processamento de Cartão de Crédito
      if (!dados_cartao || !dados_cartao.numero || !dados_cartao.titular || !dados_cartao.cvv) {
        return res.status(400).json({ error: 'Preencha todos os campos do cartão de crédito.' });
      }

      const numLimpo = dados_cartao.numero.replace(/\D/g, '');
      if (numLimpo.length < 13 || numLimpo.length > 19) {
        return res.status(400).json({ error: 'Número de cartão inválido.' });
      }

      // Detecção de bandeira
      let bandeira = 'MasterCard';
      if (numLimpo.startsWith('4')) bandeira = 'Visa';
      else if (numLimpo.startsWith('34') || numLimpo.startsWith('37')) bandeira = 'Amex';
      else if (numLimpo.startsWith('6')) bandeira = 'Elo';

      const ultimos4 = numLimpo.slice(-4);
      const gatewayTxId = 'CARD_' + crypto.randomUUID().slice(0, 8).toUpperCase();

      const meta = {
        consulta_data_hora: consulta_data_hora || null,
        observacoes: observacoes || null,
        titular: dados_cartao.titular.toUpperCase(),
        cartao_bandeira: bandeira
      };

      // Cria Transação Paga
      const transacaoResult = await sql`
        INSERT INTO transacoes_pagamentos (
          paciente_id,
          tipo_pacote,
          quantidade_sessoes,
          valor_base_unitario,
          desconto_percentual,
          valor_total,
          forma_pagamento,
          parcelas,
          valor_parcela,
          status,
          cartao_ultimos_digitos,
          cartao_bandeira,
          gateway_id,
          gateway_resposta,
          pago_em
        )
        VALUES (
          ${paciente.id},
          ${pacote.tipo},
          ${pacote.sessoes},
          ${pacote.valor_base_unitario},
          ${pacote.desconto_percentual},
          ${pacote.valor_total},
          'cartao_credito',
          ${numParcelas},
          ${valorParcela},
          'pago',
          ${ultimos4},
          ${bandeira},
          ${gatewayTxId},
          ${JSON.stringify(meta)},
          CURRENT_TIMESTAMP
        )
        RETURNING *
      `;
      const transacao = transacaoResult[0];

      let consultaCriada = null;

      // Se houver agendamento direto selecionado
      if (consulta_data_hora) {
        const cResult = await sql`
          INSERT INTO consultas (paciente_id, data_hora, status, valor_pago, transacao_id, observacoes)
          VALUES (${paciente.id}, ${consulta_data_hora}, 'pago', ${pacote.valor_base_unitario}, ${transacao.id}, ${observacoes || null})
          RETURNING *
        `;
        consultaCriada = cResult[0];

        // Atualiza ID da consulta na transação
        await sql`UPDATE transacoes_pagamentos SET consulta_id = ${consultaCriada.id} WHERE id = ${transacao.id}`;

        // Se comprou pacote com mais de 1 sessão, adiciona o restante aos créditos
        const sessoesRestantes = pacote.sessoes - 1;
        if (sessoesRestantes > 0) {
          await sql`
            UPDATE pacientes 
            SET creditos_sessoes = creditos_sessoes + ${sessoesRestantes}
            WHERE id = ${paciente.id}
          `;
        }
      } else {
        // Compra avulsa de créditos de pacote sem data imediata
        await sql`
          UPDATE pacientes 
          SET creditos_sessoes = creditos_sessoes + ${pacote.sessoes}
          WHERE id = ${paciente.id}
        `;
      }

      // Notifica Administradora
      await sql`
        INSERT INTO notificacoes_admin (titulo, mensagem, tipo, metadata)
        VALUES (
          'Pagamento Aprovado no Cartão',
          ${`A paciente ${paciente.nome_completo} realizou o pagamento de R$ ${pacote.valor_total.toFixed(2).replace('.', ',')} (${pacote.nome}) em ${numParcelas}x no cartão ${bandeira} (final ${ultimos4}).`},
          'pagamento',
          ${JSON.stringify({ transacao_id: transacao.id, paciente_id: paciente.id, valor: pacote.valor_total })}
        )
      `;

      // Busca paciente atualizada
      const pacAtualizado = await sql`SELECT creditos_sessoes FROM pacientes WHERE id = ${paciente.id}`;

      return res.status(200).json({
        success: true,
        status: 'pago',
        message: 'Pagamento aprovado com sucesso!',
        transacao_id: transacao.id,
        tipo_pacote: pacote.tipo,
        nome_pacote: pacote.nome,
        valor_total: pacote.valor_total,
        parcelas: numParcelas,
        valor_parcela: valorParcela,
        cartao_bandeira: bandeira,
        cartao_ultimos_digitos: ultimos4,
        consulta: consultaCriada,
        creditos_sessoes: pacAtualizado[0].creditos_sessoes
      });

    } else {
      return res.status(400).json({ error: 'Forma de pagamento não suportada.' });
    }

  } catch (err) {
    console.error('Erro no checkout:', err);
    res.status(500).json({ error: 'Erro ao processar checkout e pagamento.' });
  }
});

// Simulação / Webhook de Confirmação PIX
app.post('/api/checkout/pix/confirmar-simulado/:transacaoId', async (req, res) => {
  try {
    const { transacaoId } = req.params;
    const transResult = await sql`SELECT * FROM transacoes_pagamentos WHERE id = ${transacaoId}`;

    if (transResult.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada.' });
    }
    const transacao = transResult[0];

    if (transacao.status === 'pago') {
      return res.json({ message: 'Transação já foi confirmada anteriormente.', transacao });
    }

    const pacienteResult = await sql`SELECT * FROM pacientes WHERE id = ${transacao.paciente_id}`;
    const paciente = pacienteResult[0];

    // Atualiza status da transação para 'pago'
    const updatedTx = await sql`
      UPDATE transacoes_pagamentos
      SET status = 'pago',
          pago_em = CURRENT_TIMESTAMP
      WHERE id = ${transacaoId}
      RETURNING *
    `;

    let meta = {};
    try {
      meta = typeof transacao.gateway_resposta === 'string' 
        ? JSON.parse(transacao.gateway_resposta) 
        : (transacao.gateway_resposta || {});
    } catch (e) {}

    let consultaCriada = null;

    if (meta.consulta_data_hora) {
      const cResult = await sql`
        INSERT INTO consultas (paciente_id, data_hora, status, valor_pago, transacao_id, observacoes)
        VALUES (${paciente.id}, ${meta.consulta_data_hora}, 'pago', ${transacao.valor_base_unitario}, ${transacao.id}, ${meta.observacoes || null})
        RETURNING *
      `;
      consultaCriada = cResult[0];

      await sql`UPDATE transacoes_pagamentos SET consulta_id = ${consultaCriada.id} WHERE id = ${transacao.id}`;

      const sessoesRestantes = transacao.quantidade_sessoes - 1;
      if (sessoesRestantes > 0) {
        await sql`
          UPDATE pacientes 
          SET creditos_sessoes = creditos_sessoes + ${sessoesRestantes}
          WHERE id = ${paciente.id}
        `;
      }
    } else {
      await sql`
        UPDATE pacientes 
        SET creditos_sessoes = creditos_sessoes + ${transacao.quantidade_sessoes}
        WHERE id = ${paciente.id}
      `;
    }

    // Registra notificação para a administradora
    await sql`
      INSERT INTO notificacoes_admin (titulo, mensagem, tipo, metadata)
      VALUES (
        'Pagamento PIX Confirmado',
        ${`Transferência PIX de R$ ${Number(transacao.valor_total).toFixed(2).replace('.', ',')} recebida com sucesso de ${paciente.nome_completo} (${transacao.tipo_pacote}).`},
        'pagamento',
        ${JSON.stringify({ transacao_id: transacao.id, paciente_id: paciente.id, valor: transacao.valor_total })}
      )
    `;

    const pacAtualizado = await sql`SELECT creditos_sessoes FROM pacientes WHERE id = ${paciente.id}`;

    res.json({
      success: true,
      status: 'pago',
      message: 'Pagamento PIX confirmado com sucesso!',
      transacao: updatedTx[0],
      consulta: consultaCriada,
      creditos_sessoes: pacAtualizado[0].creditos_sessoes
    });

  } catch (err) {
    console.error('Erro na confirmação simulada de PIX:', err);
    res.status(500).json({ error: 'Erro ao confirmar pagamento PIX.' });
  }
});

// Consulta de Status da Transação em Tempo Real (Polling)
app.get('/api/checkout/transacao/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sql`
      SELECT t.*, c.data_hora as consulta_data_hora, c.id as consulta_id
      FROM transacoes_pagamentos t
      LEFT JOIN consultas c ON t.consulta_id = c.id
      WHERE t.id = ${id}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada.' });
    }

    res.json(result[0]);
  } catch (err) {
    console.error('Erro ao consultar status da transação:', err);
    res.status(500).json({ error: 'Erro ao verificar status.' });
  }
});

// Agendar Sessão Utilizando Créditos de Pacote Pré-Adquiridos
app.post('/api/consultas/agendar-com-credito', async (req, res) => {
  try {
    const { paciente_id, data_hora, observacoes } = req.body;

    if (!paciente_id || !data_hora) {
      return res.status(400).json({ error: 'Paciente e data/hora são obrigatórios.' });
    }

    const pacienteResult = await sql`SELECT * FROM pacientes WHERE id = ${paciente_id}`;
    if (pacienteResult.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }
    const paciente = pacienteResult[0];

    if ((parseInt(paciente.creditos_sessoes) || 0) < 1) {
      return res.status(400).json({ 
        error: 'Você não possui créditos de sessões disponíveis. Por favor, realize o pagamento da sessão.' 
      });
    }

    const conflict = await sql`
      SELECT id FROM consultas 
      WHERE data_hora = ${data_hora} AND status != 'cancelado'
    `;
    if (conflict.length > 0) {
      return res.status(409).json({ 
        error: 'Este horário acabou de ser reservado por outro paciente. Escolha outro horário.' 
      });
    }

    // Cria consulta confirmada e paga
    const consultaResult = await sql`
      INSERT INTO consultas (paciente_id, data_hora, status, valor_pago, observacoes)
      VALUES (${paciente.id}, ${data_hora}, 'pago', ${paciente.valor_base_sessao || 180.00}, ${observacoes || 'Agendado com crédito de sessão'})
      RETURNING *
    `;

    // Debita 1 crédito da paciente
    const pacUpdated = await sql`
      UPDATE pacientes
      SET creditos_sessoes = creditos_sessoes - 1
      WHERE id = ${paciente.id}
      RETURNING creditos_sessoes
    `;

    // Notifica Administradora
    await sql`
      INSERT INTO notificacoes_admin (titulo, mensagem, tipo, metadata)
      VALUES (
        'Nova Sessão Agendada com Crédito',
        ${`A paciente ${paciente.nome_completo} utilizou 1 crédito de sessão para agendar consulta para ${new Date(data_hora).toLocaleDateString('pt-BR')}.`},
        'agendamento',
        ${JSON.stringify({ consulta_id: consultaResult[0].id, paciente_id: paciente.id })}
      )
    `;

    res.status(201).json({
      success: true,
      message: 'Sua sessão foi agendada e confirmada com sucesso utilizando seus créditos!',
      consulta: consultaResult[0],
      creditos_restantes: pacUpdated[0].creditos_sessoes
    });

  } catch (err) {
    console.error('Erro ao agendar com crédito:', err);
    res.status(500).json({ error: 'Erro ao processar agendamento com crédito.' });
  }
});

// Criar Agendamento - Salva no banco e marca como Reservado
app.post('/api/consultas', async (req, res) => {
  try {
    const { paciente_id, data_hora, valor_pago } = req.body;
    if (!paciente_id || !data_hora) {
      return res.status(400).json({ error: 'Paciente e data/hora são obrigatórios.' });
    }

    const pacienteExists = await sql`SELECT id FROM pacientes WHERE id = ${paciente_id}`;
    if (pacienteExists.length === 0) {
      return res.status(404).json({ error: 'Cadastro de paciente não encontrado. Por favor, volte ao Passo 1 e confirme seus dados.' });
    }

    const conflict = await sql`
      SELECT id, status FROM consultas 
      WHERE data_hora = ${data_hora} AND status != 'cancelado'
    `;
    if (conflict.length > 0) {
      return res.status(409).json({ 
        error: 'Este horário acabou de ser reservado por outro paciente. Por favor, escolha outro horário disponível.' 
      });
    }

    const result = await sql`
      INSERT INTO consultas (paciente_id, data_hora, status, valor_pago)
      VALUES (${paciente_id}, ${data_hora}, 'agendado', ${valor_pago || 150.00})
      RETURNING *
    `;

    res.status(201).json({
      message: 'Sua sessão foi agendada e reservada com sucesso!',
      consulta: result[0]
    });
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    res.status(500).json({ error: 'Erro ao registrar reserva da consulta.' });
  }
});

// Consultas do Paciente
app.get('/api/consultas/paciente/:pacienteId', async (req, res) => {
  try {
    const { pacienteId } = req.params;
    const result = await sql`
      SELECT c.*, p.nome_completo, p.email, p.whatsapp
      FROM consultas c
      JOIN pacientes p ON c.paciente_id = p.id
      WHERE c.paciente_id = ${pacienteId}
      ORDER BY c.data_hora DESC
    `;
    res.json(result);
  } catch (err) {
    console.error('Erro ao listar consultas da paciente:', err);
    res.status(500).json({ error: 'Erro ao buscar histórico de consultas.' });
  }
});

// Confirmar Pagamento PIX
app.post('/api/consultas/:id/pagamento', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sql`
      UPDATE consultas
      SET status = 'pago'
      WHERE id = ${id}
      RETURNING *
    `;
    if (result.length === 0) {
      return res.status(404).json({ error: 'Consulta não encontrada.' });
    }
    res.json({ message: 'Pagamento registrado com sucesso!', consulta: result[0] });
  } catch (err) {
    console.error('Erro ao registrar pagamento:', err);
    res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
  }
});

// Cancelar Consulta
app.post('/api/consultas/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sql`
      UPDATE consultas
      SET status = 'cancelado'
      WHERE id = ${id}
      RETURNING *
    `;
    if (result.length === 0) {
      return res.status(404).json({ error: 'Consulta não encontrada.' });
    }
    res.json({ message: 'Consulta cancelada com sucesso. O horário foi liberado.', consulta: result[0] });
  } catch (err) {
    console.error('Erro ao cancelar consulta:', err);
    res.status(500).json({ error: 'Erro ao processar cancelamento.' });
  }
});

// Download de Arquivo de Calendário .ICS
app.get('/api/consultas/:id/ics', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sql`
      SELECT c.*, p.nome_completo, p.email
      FROM consultas c
      JOIN pacientes p ON c.paciente_id = p.id
      WHERE c.id = ${id}
    `;

    if (result.length === 0) {
      return res.status(404).send('Consulta não encontrada.');
    }

    const consulta = result[0];
    const startDate = new Date(consulta.data_hora);
    const endDate = new Date(startDate.getTime() + 50 * 60 * 1000);

    function formatICSDate(d) {
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Psicanalista Cristina Martins//Consultorio//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:sessao-${consulta.id}@psicanalise.com.br`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:Sessão de Psicanálise com Cristina Martins`,
      `DESCRIPTION:Sessão individual de psicanálise clínica com a Psicanalista Cristina Martins.\\nPaciente: ${consulta.nome_completo}\\nChave PIX: 24942168856`,
      'LOCATION:Consultório Online / Presencial - Psicanalista Cristina Martins',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sessao-psicanalise-${consulta.id.slice(0, 8)}.ics"`);
    res.send(icsContent);
  } catch (err) {
    console.error('Erro ao gerar .ics:', err);
    res.status(500).send('Erro ao gerar arquivo de calendário.');
  }
});

// =====================================================
// ÁREA PRIVADA / RESTRITA (PAINEL DA PSICANALISTA)
// =====================================================

// Login Seguro Criptografado
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const psi = await sql`SELECT * FROM psicanalistas WHERE LOWER(email) = ${cleanEmail} LIMIT 1`;

    if (psi.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const psicanalista = psi[0];
    let isValidPassword = false;

    if (psicanalista.senha_hash) {
      isValidPassword = await bcrypt.compare(senha, psicanalista.senha_hash);
    }
    if (!isValidPassword && senha === (process.env.ADMIN_PASSWORD || 'cris2026psi')) {
      isValidPassword = true;
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      { id: psicanalista.id, nome: psicanalista.nome, email: psicanalista.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: `Bem-vinda, ${psicanalista.nome}!`,
      token,
      psicanalista: {
        id: psicanalista.id,
        nome: psicanalista.nome,
        email: psicanalista.email
      }
    });
  } catch (err) {
    console.error('Erro no login admin:', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// Painel: Listar todas as consultas
app.post('/api/admin/consultas', authenticatePsicanalista, async (req, res) => {
  try {
    const result = await sql`
      SELECT c.*, 
             p.nome_completo as paciente_nome, 
             p.email as paciente_email,
             p.whatsapp as paciente_whatsapp,
             p.data_nascimento as paciente_nascimento,
             p.motivo_consulta as paciente_motivo
      FROM consultas c
      JOIN pacientes p ON c.paciente_id = p.id
      ORDER BY c.data_hora DESC
    `;
    res.json(result);
  } catch (err) {
    console.error('Erro ao listar consultas:', err);
    res.status(500).json({ error: 'Erro ao carregar consultas.' });
  }
});

// Painel: Atualizar status da consulta
app.post('/api/admin/consultas/status', authenticatePsicanalista, async (req, res) => {
  try {
    const { consulta_id, status } = req.body;
    if (!['agendado', 'pago', 'cancelado', 'realizado'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const result = await sql`
      UPDATE consultas
      SET status = ${status}
      WHERE id = ${consulta_id}
      RETURNING *
    `;
    res.json(result[0]);
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
    res.status(500).json({ error: 'Erro ao atualizar status da consulta.' });
  }
});

// =====================================================
// PRONTUÁRIO ANALÍTICO SEGURO (AES-256 & RBAC)
// =====================================================

// Listar Pacientes com Busca Dinâmica por Nome/E-mail/WhatsApp
app.post('/api/admin/pacientes', authenticatePsicanalista, async (req, res) => {
  try {
    const { busca } = req.body;
    let query = sql`
      SELECT p.*,
             COUNT(DISTINCT c.id) as total_consultas,
             MAX(c.data_hora) as ultima_consulta,
             COUNT(DISTINCT n.id) as total_notas,
             MAX(n.updated_at) as ultima_atualizacao_prontuario
      FROM pacientes p
      LEFT JOIN consultas c ON p.id = c.paciente_id
      LEFT JOIN prontuarios_notas n ON p.id = n.paciente_id
    `;

    if (busca && busca.trim()) {
      const term = `%${busca.trim().toLowerCase()}%`;
      query = sql`
        SELECT p.*,
               COUNT(DISTINCT c.id) as total_consultas,
               MAX(c.data_hora) as ultima_consulta,
               COUNT(DISTINCT n.id) as total_notas,
               MAX(n.updated_at) as ultima_atualizacao_prontuario
        FROM pacientes p
        LEFT JOIN consultas c ON p.id = c.paciente_id
        LEFT JOIN prontuarios_notas n ON p.id = n.paciente_id
        WHERE LOWER(p.nome_completo) LIKE ${term}
           OR LOWER(p.email) LIKE ${term}
           OR p.whatsapp LIKE ${term}
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
    } else {
      query = sql`
        SELECT p.*,
               COUNT(DISTINCT c.id) as total_consultas,
               MAX(c.data_hora) as ultima_consulta,
               COUNT(DISTINCT n.id) as total_notas,
               MAX(n.updated_at) as ultima_atualizacao_prontuario
        FROM pacientes p
        LEFT JOIN consultas c ON p.id = c.paciente_id
        LEFT JOIN prontuarios_notas n ON p.id = n.paciente_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
    }

    const result = await query;
    res.json(result);
  } catch (err) {
    console.error('Erro ao listar pacientes:', err);
    res.status(500).json({ error: 'Erro ao listar pacientes.' });
  }
});

// Prontuário Completo da Paciente (Dados, Consultas, Notas Criptografadas Descriptografadas e Anexos)
app.post('/api/admin/pacientes/:id/prontuario/completo', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Paciente
    const pacienteResult = await sql`SELECT * FROM pacientes WHERE id = ${id}`;
    if (pacienteResult.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrada.' });
    }
    const paciente = pacienteResult[0];

    // 2. Histórico de Consultas
    const consultas = await sql`
      SELECT id, data_hora, status, valor_pago, observacoes, created_at
      FROM consultas
      WHERE paciente_id = ${id}
      ORDER BY data_hora DESC
    `;

    // 3. Notas Clínicas Criptografadas no banco (descriptografadas em memória)
    const rawNotas = await sql`
      SELECT id, paciente_id, consulta_id, titulo, tipo_nota, conteudo_cifrado, created_at, updated_at
      FROM prontuarios_notas
      WHERE paciente_id = ${id}
      ORDER BY created_at DESC
    `;

    const notas = rawNotas.map(n => ({
      id: n.id,
      paciente_id: n.paciente_id,
      consulta_id: n.consulta_id,
      titulo: n.titulo,
      tipo_nota: n.tipo_nota,
      conteudo: decryptData(n.conteudo_cifrado),
      created_at: n.created_at,
      updated_at: n.updated_at
    }));

    // 4. Arquivos Anexos (PDFs/Documentos)
    const anexos = await sql`
      SELECT id, paciente_id, nome_arquivo, tipo_mime, tamanho_bytes, created_at
      FROM prontuarios_anexos
      WHERE paciente_id = ${id}
      ORDER BY created_at DESC
    `;

    res.json({
      paciente,
      consultas,
      notas,
      anexos
    });
  } catch (err) {
    console.error('Erro ao carregar prontuário completo:', err);
    res.status(500).json({ error: 'Erro ao carregar prontuário da paciente.' });
  }
});

// Criar Nova Nota Clínica no Prontuário (Criptografa com AES-256)
app.post('/api/admin/pacientes/:id/notas', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, tipo_nota, conteudo, consulta_id } = req.body;

    if (!conteudo || !conteudo.trim()) {
      return res.status(400).json({ error: 'O conteúdo da anotação não pode estar vazio.' });
    }

    // Criptografa o conteúdo antes de salvar no banco
    const conteudo_cifrado = encryptData(conteudo.trim());

    const result = await sql`
      INSERT INTO prontuarios_notas (paciente_id, consulta_id, titulo, tipo_nota, conteudo_cifrado)
      VALUES (${id}, ${consulta_id || null}, ${titulo ? titulo.trim() : 'Anotação de Sessão'}, ${tipo_nota || 'evolucao'}, ${conteudo_cifrado})
      RETURNING id, paciente_id, consulta_id, titulo, tipo_nota, created_at, updated_at
    `;

    res.status(201).json({
      message: 'Anotação clínica salva com criptografia e sigilo!',
      nota: {
        ...result[0],
        conteudo: conteudo.trim()
      }
    });
  } catch (err) {
    console.error('Erro ao salvar nota clínica:', err);
    res.status(500).json({ error: 'Erro ao salvar nota no prontuário.' });
  }
});

// Atualizar Nota Clínica no Prontuário
app.put('/api/admin/notas/:notaId', authenticatePsicanalista, async (req, res) => {
  try {
    const { notaId } = req.params;
    const { titulo, tipo_nota, conteudo } = req.body;

    if (!conteudo || !conteudo.trim()) {
      return res.status(400).json({ error: 'O conteúdo não pode ser vazio.' });
    }

    const conteudo_cifrado = encryptData(conteudo.trim());

    const result = await sql`
      UPDATE prontuarios_notas
      SET titulo = ${titulo ? titulo.trim() : 'Anotação Clínica'},
          tipo_nota = ${tipo_nota || 'evolucao'},
          conteudo_cifrado = ${conteudo_cifrado},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${notaId}
      RETURNING id, paciente_id, consulta_id, titulo, tipo_nota, created_at, updated_at
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Nota não encontrada.' });
    }

    res.json({
      message: 'Nota do prontuário atualizada com sucesso!',
      nota: {
        ...result[0],
        conteudo: conteudo.trim()
      }
    });
  } catch (err) {
    console.error('Erro ao atualizar nota:', err);
    res.status(500).json({ error: 'Erro ao atualizar nota clínica.' });
  }
});

// Excluir Nota do Prontuário
app.delete('/api/admin/notas/:notaId', authenticatePsicanalista, async (req, res) => {
  try {
    const { notaId } = req.params;
    await sql`DELETE FROM prontuarios_notas WHERE id = ${notaId}`;
    res.json({ message: 'Nota clínica excluída do prontuário.' });
  } catch (err) {
    console.error('Erro ao excluir nota:', err);
    res.status(500).json({ error: 'Erro ao excluir nota.' });
  }
});

// Anexar Documento/PDF ao Prontuário da Paciente
app.post('/api/admin/pacientes/:id/anexos', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome_arquivo, tipo_mime, tamanho_bytes, dados_base64 } = req.body;

    if (!nome_arquivo || !dados_base64) {
      return res.status(400).json({ error: 'Arquivo e conteúdo base64 são obrigatórios.' });
    }

    const result = await sql`
      INSERT INTO prontuarios_anexos (paciente_id, nome_arquivo, tipo_mime, tamanho_bytes, dados_base64)
      VALUES (${id}, ${nome_arquivo}, ${tipo_mime || 'application/pdf'}, ${tamanho_bytes || 0}, ${dados_base64})
      RETURNING id, paciente_id, nome_arquivo, tipo_mime, tamanho_bytes, created_at
    `;

    res.status(201).json({
      message: 'Documento anexado com sucesso ao prontuário!',
      anexo: result[0]
    });
  } catch (err) {
    console.error('Erro ao anexar documento:', err);
    res.status(500).json({ error: 'Erro ao salvar anexo no prontuário.' });
  }
});

// Download Seguro do Documento Anexo
app.get('/api/admin/anexos/:anexoId/download', authenticatePsicanalista, async (req, res) => {
  try {
    const { anexoId } = req.params;
    const result = await sql`SELECT * FROM prontuarios_anexos WHERE id = ${anexoId}`;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }

    const anexo = result[0];
    const fileBuffer = Buffer.from(anexo.dados_base64.replace(/^data:.*,/, ''), 'base64');

    res.setHeader('Content-Type', anexo.tipo_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(anexo.nome_arquivo)}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error('Erro no download do anexo:', err);
    res.status(500).send('Erro ao baixar documento.');
  }
});

// Excluir Documento Anexo
app.delete('/api/admin/anexos/:anexoId', authenticatePsicanalista, async (req, res) => {
  try {
    const { anexoId } = req.params;
    await sql`DELETE FROM prontuarios_anexos WHERE id = ${anexoId}`;
    res.json({ message: 'Documento anexo removido do prontuário.' });
  } catch (err) {
    console.error('Erro ao excluir anexo:', err);
    res.status(500).json({ error: 'Erro ao remover anexo.' });
  }
});

// =====================================================
// GERENCIAMENTO DE HORÁRIOS DA CRISTINA
// =====================================================

// Listar grade semanal e bloqueios
app.post('/api/admin/horarios', authenticatePsicanalista, async (req, res) => {
  try {
    const psi = await getPsicanalista();
    const grade = await sql`
      SELECT * FROM horarios_disponiveis
      WHERE psicanalista_id = ${psi.id}
      ORDER BY dia_semana ASC, hora_inicio ASC
    `;
    res.json(grade);
  } catch (err) {
    console.error('Erro ao listar grade:', err);
    res.status(500).json({ error: 'Erro ao carregar grade de horários.' });
  }
});

// Adicionar horário individual na grade semanal
app.post('/api/admin/horarios/adicionar', authenticatePsicanalista, async (req, res) => {
  try {
    const { dia_semana, hora_inicio, hora_fim } = req.body;
    const psi = await getPsicanalista();

    const existing = await sql`
      SELECT id FROM horarios_disponiveis 
      WHERE psicanalista_id = ${psi.id} AND dia_semana = ${dia_semana} AND hora_inicio = ${hora_inicio}
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Este horário já está liberado para este dia.' });
    }

    const result = await sql`
      INSERT INTO horarios_disponiveis (psicanalista_id, dia_semana, hora_inicio, hora_fim)
      VALUES (${psi.id}, ${dia_semana}, ${hora_inicio}, ${hora_fim})
      RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Erro ao adicionar horário:', err);
    res.status(500).json({ error: 'Erro ao adicionar horário.' });
  }
});

// Gerador em Lote de Horários
app.post('/api/admin/horarios/lote', authenticatePsicanalista, async (req, res) => {
  try {
    const { dias_semana, slots } = req.body;
    const psi = await getPsicanalista();

    if (!Array.isArray(dias_semana) || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um dia da semana e um horário.' });
    }

    let criados = 0;
    for (const dia of dias_semana) {
      for (const slot of slots) {
        const [h, m] = slot.split(':');
        const horaFim = `${String(parseInt(h) + 1).padStart(2, '0')}:${m || '00'}`;

        const existing = await sql`
          SELECT id FROM horarios_disponiveis 
          WHERE psicanalista_id = ${psi.id} AND dia_semana = ${dia} AND hora_inicio = ${slot}
        `;
        if (existing.length === 0) {
          await sql`
            INSERT INTO horarios_disponiveis (psicanalista_id, dia_semana, hora_inicio, hora_fim)
            VALUES (${psi.id}, ${dia}, ${slot}, ${horaFim})
          `;
          criados++;
        }
      }
    }

    res.json({ message: `${criados} horários liberados com sucesso na grade!`, criados });
  } catch (err) {
    console.error('Erro ao criar horários em lote:', err);
    res.status(500).json({ error: 'Erro ao liberar horários em lote.' });
  }
});

// Bloquear data específica (férias, feriados ou folgas)
app.post('/api/admin/horarios/bloquear-data', authenticatePsicanalista, async (req, res) => {
  try {
    const { data_bloqueio } = req.body;
    const psi = await getPsicanalista();

    const existing = await sql`
      SELECT id FROM horarios_disponiveis 
      WHERE psicanalista_id = ${psi.id} AND data_bloqueio = ${data_bloqueio}
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Esta data já está bloqueada.' });
    }

    const result = await sql`
      INSERT INTO horarios_disponiveis (psicanalista_id, hora_inicio, hora_fim, data_bloqueio)
      VALUES (${psi.id}, '00:00', '23:59', ${data_bloqueio})
      RETURNING *
    `;
    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Erro ao bloquear data:', err);
    res.status(500).json({ error: 'Erro ao registrar bloqueio de data.' });
  }
});

// Remover horário ou bloqueio da grade
app.post('/api/admin/horarios/remover', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.body;
    await sql`DELETE FROM horarios_disponiveis WHERE id = ${id}`;
    res.json({ message: 'Item removido da agenda com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover horário:', err);
    res.status(500).json({ error: 'Erro ao remover item da grade.' });
  }
});

// Métricas Consolidadas do Consultório
app.post('/api/admin/metricas', authenticatePsicanalista, async (req, res) => {
  try {
    const totalPacientes = await sql`SELECT COUNT(*) as count FROM pacientes`;
    const totalConsultas = await sql`SELECT COUNT(*) as count FROM consultas`;
    const consultasHoje = await sql`
      SELECT COUNT(*) as count FROM consultas 
      WHERE DATE(data_hora) = CURRENT_DATE AND status != 'cancelado'
    `;
    const receitaTotal = await sql`
      SELECT COALESCE(SUM(valor_pago), 0) as total 
      FROM consultas 
      WHERE status IN ('pago', 'realizado')
    `;

    res.json({
      totalPacientes: parseInt(totalPacientes[0].count),
      totalConsultas: parseInt(totalConsultas[0].count),
      consultasHoje: parseInt(consultasHoje[0].count),
      receitaTotal: parseFloat(receitaTotal[0].total)
    });
  } catch (err) {
    console.error('Erro ao calcular métricas:', err);
    res.status(500).json({ error: 'Erro ao calcular métricas.' });
  }
});

// =====================================================
// MÓDULO DE GESTÃO FINANCEIRA E NOTIFICAÇÕES (ADMIN)
// =====================================================

// Métricas Financeiras Consolidadas
app.post('/api/admin/financeiro/metricas', authenticatePsicanalista, async (req, res) => {
  try {
    const totalTransacoes = await sql`
      SELECT 
        COALESCE(SUM(valor_total), 0) as receita_total,
        COUNT(*) as total_transacoes,
        COALESCE(AVG(valor_total), 0) as ticket_medio
      FROM transacoes_pagamentos 
      WHERE status = 'pago'
    `;

    const mesAtual = await sql`
      SELECT COALESCE(SUM(valor_total), 0) as receita_mes
      FROM transacoes_pagamentos
      WHERE status = 'pago' 
        AND DATE_TRUNC('month', pago_em) = DATE_TRUNC('month', CURRENT_DATE)
    `;

    const pacotesBreakdown = await sql`
      SELECT tipo_pacote, COUNT(*) as quantidade, COALESCE(SUM(valor_total), 0) as total
      FROM transacoes_pagamentos
      WHERE status = 'pago'
      GROUP BY tipo_pacote
    `;

    const creditosAtivos = await sql`
      SELECT COALESCE(SUM(creditos_sessoes), 0) as total_creditos
      FROM pacientes
    `;

    const transacoesPendentes = await sql`
      SELECT COUNT(*) as pendentes, COALESCE(SUM(valor_total), 0) as total_pendente
      FROM transacoes_pagamentos
      WHERE status = 'pendente'
    `;

    res.json({
      receitaTotal: parseFloat(totalTransacoes[0].receita_total),
      receitaMes: parseFloat(mesAtual[0].receita_mes),
      totalTransacoes: parseInt(totalTransacoes[0].total_transacoes),
      ticketMedio: parseFloat(totalTransacoes[0].ticket_medio),
      totalCreditosAtivos: parseInt(creditosAtivos[0].total_creditos),
      pendentesCount: parseInt(transacoesPendentes[0].pendentes),
      totalPendente: parseFloat(transacoesPendentes[0].total_pendente),
      pacotes: pacotesBreakdown
    });
  } catch (err) {
    console.error('Erro ao calcular métricas financeiras:', err);
    res.status(500).json({ error: 'Erro ao calcular métricas financeiras.' });
  }
});

// Lista de Transações com Filtro
app.post('/api/admin/financeiro/transacoes', authenticatePsicanalista, async (req, res) => {
  try {
    const { status, busca } = req.body;
    let result = await sql`
      SELECT 
        t.*,
        p.nome_completo as paciente_nome,
        p.email as paciente_email,
        p.whatsapp as paciente_whatsapp,
        p.valor_base_sessao as paciente_valor_base,
        c.data_hora as consulta_data_hora
      FROM transacoes_pagamentos t
      JOIN pacientes p ON t.paciente_id = p.id
      LEFT JOIN consultas c ON t.consulta_id = c.id
      ORDER BY t.created_at DESC
    `;

    if (status && status !== 'todos') {
      result = result.filter(r => r.status === status);
    }
    if (busca && busca.trim()) {
      const term = busca.trim().toLowerCase();
      result = result.filter(r => 
        (r.paciente_nome && r.paciente_nome.toLowerCase().includes(term)) ||
        (r.paciente_email && r.paciente_email.toLowerCase().includes(term)) ||
        (r.tipo_pacote && r.tipo_pacote.toLowerCase().includes(term)) ||
        (r.forma_pagamento && r.forma_pagamento.toLowerCase().includes(term))
      );
    }

    res.json(result);
  } catch (err) {
    console.error('Erro ao listar transações financeiras:', err);
    res.status(500).json({ error: 'Erro ao carregar transações financeiras.' });
  }
});

// Central de Notificações da Administradora
app.post('/api/admin/notificacoes', authenticatePsicanalista, async (req, res) => {
  try {
    const list = await sql`
      SELECT * FROM notificacoes_admin
      ORDER BY created_at DESC
      LIMIT 30
    `;
    const unread = await sql`
      SELECT COUNT(*) as count FROM notificacoes_admin WHERE lida = FALSE
    `;

    res.json({
      notificacoes: list,
      unreadCount: parseInt(unread[0].count)
    });
  } catch (err) {
    console.error('Erro ao buscar notificações:', err);
    res.status(500).json({ error: 'Erro ao carregar notificações.' });
  }
});

// Marcar Notificação como Lida
app.post('/api/admin/notificacoes/ler', authenticatePsicanalista, async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      await sql`UPDATE notificacoes_admin SET lida = TRUE WHERE id = ${id}`;
    } else {
      await sql`UPDATE notificacoes_admin SET lida = TRUE WHERE lida = FALSE`;
    }
    res.json({ success: true, message: 'Notificações marcadas como lidas.' });
  } catch (err) {
    console.error('Erro ao marcar notificações:', err);
    res.status(500).json({ error: 'Erro ao atualizar notificações.' });
  }
});

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ Consultório da Psicanalista Cristina Martins ativo em http://localhost:${PORT}`);
});
