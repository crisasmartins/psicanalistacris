/* =============================================================================
   CONSULTÓRIO DE PSICANÁLISE - PSICANALISTA CRISTINA MARTINS
   LÓGICA DA APLICAÇÃO (SPA) - PROMPT 3: LÓGICA DE AGENDAMENTO
   ============================================================================= */

const API_BASE = '';
const PIX_CHAVE_OFICIAL = '24942168856';

// Estado Global da Aplicação
let state = {
  currentPaciente: null,
  availableSlots: [],
  selectedDate: null,
  selectedSlot: null,
  lastBooking: null,
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  adminToken: '',
  adminConsultas: [],
  adminPacientes: [],
  adminFinanceiro: null,
  currentModalConsultaId: null,
  currentModalPaciente: null,
  currentProntuarioPacienteId: null,
  currentProntuarioData: null,
  selectedFileForUpload: null,
  pacienteBaseRate: 180.00,
  pacienteCredits: 0,
  checkout: {
    selectedPackage: 'avulso',
    paymentMethod: 'pix',
    currentTx: null,
    pacotes: null,
    timerInterval: null,
    pollInterval: null
  },
  modalCheckout: {
    selectedPackage: 'mensal',
    paymentMethod: 'pix',
    currentTx: null,
    pacotes: null
  }
};

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const NOMES_DIAS_SEMANA = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'
];

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', () => {
  // Restaura paciente logado da sessão anterior
  const savedPaciente = localStorage.getItem('psic_paciente_data');
  if (savedPaciente) {
    try {
      state.currentPaciente = JSON.parse(savedPaciente);
      updatePacienteUI();
    } catch (e) {
      localStorage.removeItem('psic_paciente_data');
    }
  }

  // Restaura token de autenticação da psicanalista
  const savedToken = sessionStorage.getItem('psic_admin_jwt_token');
  if (savedToken) {
    state.adminToken = savedToken;
  }
});

// ==================== NAVEGAÇÃO SPA ====================
function navigateTo(pageId) {
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (pageId === 'page-agendamento') {
    if (state.currentPaciente) {
      showStep(2);
      loadHorariosDisponiveis();
    } else {
      showStep(1);
    }
  } else if (pageId === 'page-minhas-consultas') {
    if (state.currentPaciente) {
      showPatientDashboard();
    } else {
      document.getElementById('patient-login-box').style.display = 'block';
      document.getElementById('patient-dashboard').style.display = 'none';
    }
  } else if (pageId === 'page-admin-portal') {
    if (!state.adminToken) {
      navigateTo('page-admin-login');
      return;
    }
    loadAdminDashboard();
  }
}

function scrollToSection(sectionId) {
  const homePage = document.getElementById('page-home');
  if (!homePage || !homePage.classList.contains('active')) {
    document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
    if (homePage) homePage.classList.add('active');
  }
  setTimeout(() => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);

  // Fecha menu mobile se estiver aberto
  closeMobileMenu();
}

function toggleMobileMenu() {
  const navLinks = document.querySelector('.nav-links');
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  if (navLinks) {
    navLinks.classList.toggle('mobile-active');
  }
  if (toggleBtn) {
    toggleBtn.classList.toggle('active');
  }
}

function closeMobileMenu() {
  const navLinks = document.querySelector('.nav-links');
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  if (navLinks && navLinks.classList.contains('mobile-active')) {
    navLinks.classList.remove('mobile-active');
  }
  if (toggleBtn && toggleBtn.classList.contains('active')) {
    toggleBtn.classList.remove('active');
  }
}

// Fecha menu mobile ao clicar fora ou em qualquer botão de navegação
document.addEventListener('click', (e) => {
  if (e.target.closest('.nav-btn')) {
    closeMobileMenu();
  }
});

function showStep(stepNumber) {
  const pStep = document.getElementById('step-paciente');
  const hStep = document.getElementById('step-horarios');
  const cStep = document.getElementById('step-checkout');
  const bStep = document.getElementById('step-boas-vindas');

  if (pStep) pStep.style.display = stepNumber === 1 ? 'block' : 'none';
  if (hStep) hStep.style.display = stepNumber === 2 ? 'block' : 'none';
  if (cStep) cStep.style.display = stepNumber === 3 ? 'block' : 'none';
  if (bStep) bStep.style.display = stepNumber === 4 ? 'block' : 'none';

  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`indicator-step-${i}`);
    if (indicator) {
      if (i <= stepNumber) {
        indicator.classList.add('active');
      } else {
        indicator.classList.remove('active');
      }
    }
  }
}

// ==================== NOTIFICAÇÕES ====================
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

// ==================== MÁSCARAS E FORMATAÇÕES ====================
function formatPhone(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 11) v = v.slice(0, 11);
  v = v.replace(/(\d{2})(\d)/, '($1) $2');
  v = v.replace(/(\d{5})(\d)/, '$1-$2');
  input.value = v;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// ==================== FLUXO DO AGENDAMENTO (VISÃO DA PACIENTE) ====================

// Passo 1: Salvar Dados da Paciente
async function handleSalvarPaciente(event) {
  event.preventDefault();
  const nome_completo = document.getElementById('p-nome').value.trim();
  const email = document.getElementById('p-email').value.trim();
  const whatsapp = document.getElementById('p-whatsapp').value.trim();
  const data_nascimento = document.getElementById('p-nascimento').value || null;
  const motivo_consulta = document.getElementById('p-motivo').value.trim() || null;

  try {
    const res = await fetch(`${API_BASE}/api/pacientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_completo, email, whatsapp, data_nascimento, motivo_consulta })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao registrar dados.', 'error');
      return;
    }

    state.currentPaciente = data.paciente;
    localStorage.setItem('psic_paciente_data', JSON.stringify(data.paciente));
    updatePacienteUI();

    showToast('Dados confirmados! Escolha seu horário no calendário.', 'success');
    showStep(2);
    loadHorariosDisponiveis();
  } catch (err) {
    showToast('Falha na comunicação com o servidor.', 'error');
  }
}

function resetPacienteStep() {
  showStep(1);
}

function updatePacienteUI() {
  const badge = document.getElementById('booking-user-badge');
  if (badge && state.currentPaciente) {
    badge.textContent = `👤 ${state.currentPaciente.nome_completo.split(' ')[0]}`;
  }
}

// Passo 2: Calendário Interativo & Carregamento de Horários Livres
async function loadHorariosDisponiveis() {
  try {
    const res = await fetch(`${API_BASE}/api/horarios-disponiveis?mes=${state.calendarMonth + 1}&ano=${state.calendarYear}`);
    const slots = await res.json();
    state.availableSlots = slots;

    renderInteractiveCalendar();
  } catch (err) {
    console.error('Erro ao buscar horários:', err);
    showToast('Erro ao carregar horários disponíveis.', 'error');
  }
}

function changeCalendarMonth(dir) {
  state.calendarMonth += dir;
  if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear++;
  } else if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear--;
  }
  loadHorariosDisponiveis();
}

function renderInteractiveCalendar() {
  const label = document.getElementById('calendar-current-month-label');
  if (label) {
    label.textContent = `${NOMES_MESES[state.calendarMonth]} de ${state.calendarYear}`;
  }

  const container = document.getElementById('calendar-days-cells');
  container.innerHTML = '';

  const firstDayOfWeek = new Date(state.calendarYear, state.calendarMonth, 1).getDay();
  const totalDaysInMonth = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Mapeia slots livres por data (YYYY-MM-DD)
  const slotsMap = {};
  state.availableSlots.forEach(s => {
    if (!slotsMap[s.data]) slotsMap[s.data] = [];
    slotsMap[s.data].push(s);
  });

  // Espaços vazios antes do dia 1
  for (let i = 0; i < firstDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell empty';
    container.appendChild(emptyCell);
  }

  let autoSelectedFirstDay = false;

  // Células de cada dia do mês
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dateObj = new Date(state.calendarYear, state.calendarMonth, day);
    const dateStr = `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const daySlots = slotsMap[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.textContent = day;

    const isToday = (today.getTime() === dateObj.getTime());
    if (isToday) cell.classList.add('today');

    // Se tem horários livres e a data é hoje ou futura
    if (daySlots.length > 0 && dateObj >= today) {
      cell.classList.add('has-slots');
      cell.onclick = () => selectCalendarDay(dateStr, daySlots, cell);

      // Auto seleciona o primeiro dia disponível se nada estiver selecionado
      if (!autoSelectedFirstDay && (!state.selectedDate || state.selectedDate === dateStr)) {
        autoSelectedFirstDay = true;
        selectCalendarDay(dateStr, daySlots, cell);
      }
    } else {
      cell.classList.add('disabled');
    }

    if (state.selectedDate === dateStr) {
      cell.classList.add('selected');
    }

    container.appendChild(cell);
  }
}

function selectCalendarDay(dateStr, daySlots, cellElement) {
  state.selectedDate = dateStr;
  state.selectedSlot = null;

  document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
  if (cellElement) cellElement.classList.add('selected');

  const parts = dateStr.split('-');
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const diaSemana = NOMES_DIAS_SEMANA[dateObj.getDay()];

  document.getElementById('selected-date-label').textContent = 
    `Horários disponíveis em ${parts[2]}/${parts[1]}/${parts[0]} (${diaSemana}):`;

  const slotsGrid = document.getElementById('available-slots-grid');
  slotsGrid.innerHTML = '';

  daySlots.forEach(slot => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn';
    btn.textContent = `${slot.hora_inicio} - ${slot.hora_fim}`;
    btn.onclick = () => selectSlot(slot, btn);
    slotsGrid.appendChild(btn);
  });

  document.getElementById('slots-area').style.display = 'block';
  document.getElementById('booking-summary-box').style.display = 'none';
}

function selectSlot(slot, btnElement) {
  state.selectedSlot = slot;

  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  if (btnElement) btnElement.classList.add('selected');

  const parts = slot.data.split('-');
  document.getElementById('summary-datetime-text').textContent = 
    `${parts[2]}/${parts[1]}/${parts[0]} às ${slot.hora_inicio}`;

  document.getElementById('booking-summary-box').style.display = 'block';
}

// ==================== PASSO 3: CHECKOUT & PAGAMENTO SEGURO ====================

// Avança do Passo 2 (Calendário) para o Passo 3 (Checkout)
async function handleAvancarParaCheckout() {
  if (!state.currentPaciente || !state.selectedSlot) {
    showToast('Selecione uma data e horário livre para continuar.', 'error');
    return;
  }

  const parts = state.selectedSlot.data.split('-');
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const diaSemana = NOMES_DIAS_SEMANA[dateObj.getDay()];

  const slotSummaryEl = document.getElementById('checkout-selected-slot-text');
  if (slotSummaryEl) {
    slotSummaryEl.textContent = `${parts[2]}/${parts[1]}/${parts[0]} (${diaSemana}) às ${state.selectedSlot.hora_inicio}`;
  }

  const patientNameEl = document.getElementById('checkout-patient-name-text');
  if (patientNameEl) {
    patientNameEl.textContent = `Paciente: ${state.currentPaciente.nome_completo}`;
  }

  try {
    // Carrega preços personalizados e saldo de créditos da paciente
    const res = await fetch(`${API_BASE}/api/pacientes/${state.currentPaciente.id}/opcoes-pagamento`);
    const data = await res.json();

    if (res.ok) {
      state.checkout.pacotes = data.pacotes;
      state.pacienteBaseRate = data.valor_base_unitario;
      state.pacienteCredits = data.creditos_sessoes;

      // Atualiza dica de taxa base
      const hintEl = document.getElementById('checkout-base-rate-hint');
      if (hintEl) {
        hintEl.textContent = `Valor Base: R$ ${data.valor_base_unitario.toFixed(2).replace('.', ',')}`;
      }

      // Alerta de Créditos Disponíveis
      const creditsAlert = document.getElementById('checkout-credits-alert');
      const creditsCount = document.getElementById('checkout-credits-count');
      if (data.creditos_sessoes > 0) {
        if (creditsAlert) creditsAlert.style.display = 'block';
        if (creditsCount) creditsCount.textContent = data.creditos_sessoes;
      } else {
        if (creditsAlert) creditsAlert.style.display = 'none';
      }

      // Atualiza valores nos cards de pacotes
      updatePackagesCardsDisplay(data.pacotes);
    }
  } catch (err) {
    console.error('Erro ao carregar opções de pagamento:', err);
  }

  // Seleciona o pacote avulso por padrão
  selectCheckoutPackage('avulso');
  switchPaymentTab('pix');
  showStep(3);
}

function voltarParaHorarios() {
  stopPixCountdown();
  stopPixPolling();
  showStep(2);
}

function updatePackagesCardsDisplay(pacotes) {
  if (!pacotes) return;

  // Avulso
  const pAvulso = pacotes.avulso;
  if (pAvulso) {
    const elPrice = document.getElementById('pkg-price-avulso');
    const elInst = document.getElementById('pkg-inst-avulso');
    if (elPrice) elPrice.textContent = pAvulso.valor_total.toFixed(2).replace('.', ',');
    if (elInst) elInst.textContent = pAvulso.parcelamento_info;
  }

  // Mensal
  const pMensal = pacotes.mensal;
  if (pMensal) {
    const elPrice = document.getElementById('pkg-price-mensal');
    const elInst = document.getElementById('pkg-inst-mensal');
    if (elPrice) elPrice.textContent = pMensal.valor_total.toFixed(2).replace('.', ',');
    if (elInst) elInst.textContent = pMensal.parcelamento_info;
  }

  // Trimestral (5% OFF)
  const pTrim = pacotes.trimestral;
  if (pTrim) {
    const elOld = document.getElementById('pkg-old-trimestral');
    const elPrice = document.getElementById('pkg-price-trimestral');
    const elInst = document.getElementById('pkg-inst-trimestral');
    const elEcon = document.getElementById('pkg-econ-trimestral');
    if (elOld) elOld.textContent = `R$ ${pTrim.valor_bruto.toFixed(2).replace('.', ',')}`;
    if (elPrice) elPrice.textContent = pTrim.valor_total.toFixed(2).replace('.', ',');
    if (elInst) elInst.textContent = pTrim.parcelamento_info;
    if (elEcon) elEcon.textContent = `Economize R$ ${pTrim.economia.toFixed(2).replace('.', ',')}`;
  }

  // Semestral (8% OFF)
  const pSem = pacotes.semestral;
  if (pSem) {
    const elOld = document.getElementById('pkg-old-semestral');
    const elPrice = document.getElementById('pkg-price-semestral');
    const elInst = document.getElementById('pkg-inst-semestral');
    const elEcon = document.getElementById('pkg-econ-semestral');
    if (elOld) elOld.textContent = `R$ ${pSem.valor_bruto.toFixed(2).replace('.', ',')}`;
    if (elPrice) elPrice.textContent = pSem.valor_total.toFixed(2).replace('.', ',');
    if (elInst) elInst.textContent = pSem.parcelamento_info;
    if (elEcon) elEcon.textContent = `Economize R$ ${pSem.economia.toFixed(2).replace('.', ',')}`;
  }
}

function selectCheckoutPackage(tipo, cardElement) {
  state.checkout.selectedPackage = tipo;

  // Atualiza seleção visual dos cards
  document.querySelectorAll('.package-card').forEach(c => {
    c.classList.remove('active');
    const ind = c.querySelector('.pkg-radio-indicator');
    if (ind) ind.textContent = '○ Selecionar';
  });

  const activeCard = cardElement || document.getElementById(`pkg-card-${tipo}`);
  if (activeCard) {
    activeCard.classList.add('active');
    const ind = activeCard.querySelector('.pkg-radio-indicator');
    if (ind) ind.textContent = '● Selecionado';
  }

  // Dados do pacote
  const pacotes = state.checkout.pacotes || calcularOpcoesPacotes(state.pacienteBaseRate || 180.00).pacotes;
  const pacote = pacotes[tipo] || pacotes.avulso;
  const valorTotalStr = pacote.valor_total.toFixed(2).replace('.', ',');

  // Atualiza totais nos painéis
  const pixTotalEl = document.getElementById('pix-total-display');
  if (pixTotalEl) pixTotalEl.textContent = `R$ ${valorTotalStr}`;

  const cardBtnTotalEl = document.getElementById('card-btn-total-display');
  if (cardBtnTotalEl) cardBtnTotalEl.textContent = `R$ ${valorTotalStr}`;

  // Atualiza seletor de parcelamento do cartão
  const parcelasSelect = document.getElementById('card-parcelas');
  if (parcelasSelect) {
    parcelasSelect.innerHTML = '';
    for (let i = 1; i <= pacote.max_parcelas; i++) {
      const vParc = (pacote.valor_total / i).toFixed(2).replace('.', ',');
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i === 1 
        ? `1x de R$ ${valorTotalStr} (À vista)`
        : `${i}x de R$ ${vParc} sem juros`;
      parcelasSelect.appendChild(opt);
    }
  }

  // Reseta visual do PIX se já tiver sido gerado para o pacote anterior
  const pixInit = document.getElementById('pix-init-section');
  const pixGen = document.getElementById('pix-generated-section');
  if (pixInit) pixInit.style.display = 'block';
  if (pixGen) pixGen.style.display = 'none';

  stopPixCountdown();
  stopPixPolling();
}

function switchPaymentTab(method) {
  state.checkout.paymentMethod = method;

  document.getElementById('tab-btn-pix').classList.toggle('active', method === 'pix');
  document.getElementById('tab-btn-card').classList.toggle('active', method === 'cartao_credito');

  document.getElementById('pay-panel-pix').style.display = method === 'pix' ? 'block' : 'none';
  document.getElementById('pay-panel-card').style.display = method === 'cartao_credito' ? 'block' : 'none';
}

// 1. Geração de PIX Dinâmico
async function handleGerarPixCheckout() {
  if (!state.currentPaciente) return;

  try {
    const res = await fetch(`${API_BASE}/api/checkout/iniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: state.currentPaciente.id,
        tipo_pacote: state.checkout.selectedPackage,
        forma_pagamento: 'pix',
        consulta_data_hora: state.selectedSlot?.data_hora
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao gerar PIX.', 'error');
      return;
    }

    state.checkout.currentTx = data.transacao_id;

    // Exibe QR Code e Código
    const qrcodeImg = document.getElementById('checkout-qrcode-img');
    if (qrcodeImg) qrcodeImg.src = data.pix_qrcode_base64;

    const copiaInput = document.getElementById('pix-copia-cola-input');
    if (copiaInput) copiaInput.value = data.pix_copia_cola;

    const valDisplay = document.getElementById('pix-copy-val-display');
    if (valDisplay) valDisplay.textContent = `R$ ${Number(data.valor_total).toFixed(2).replace('.', ',')}`;

    document.getElementById('pix-init-section').style.display = 'none';
    document.getElementById('pix-generated-section').style.display = 'block';

    showToast('QR Code PIX gerado! Pague com o app do seu banco.', 'info');

    // Inicia cronômetro de 15 minutos e auto-polling
    startPixCountdown(15 * 60);
    startPixPolling(data.transacao_id);

  } catch (err) {
    showToast('Erro de conexão ao gerar PIX.', 'error');
  }
}

function copyPixCopiaCola() {
  const input = document.getElementById('pix-copia-cola-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('Código PIX Copia e Cola copiado para a área de transferência!', 'success');
    }).catch(() => {
      showToast('Código PIX selecionado.', 'info');
    });
  }
}

function startPixCountdown(durationSeconds) {
  stopPixCountdown();
  let timer = durationSeconds;
  const timerEl = document.getElementById('pix-timer-text');

  state.checkout.timerInterval = setInterval(() => {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    if (timerEl) {
      timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    if (--timer < 0) {
      stopPixCountdown();
      if (timerEl) timerEl.textContent = 'EXPIRADO';
      showToast('O tempo do PIX expirou. Gere um novo código.', 'error');
    }
  }, 1000);
}

function stopPixCountdown() {
  if (state.checkout.timerInterval) {
    clearInterval(state.checkout.timerInterval);
    state.checkout.timerInterval = null;
  }
}

function startPixPolling(transacaoId) {
  stopPixPolling();
  state.checkout.pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/checkout/transacao/${transacaoId}/status`);
      const tx = await res.json();
      if (tx && tx.status === 'pago') {
        stopPixPolling();
        handlePaymentApproved(tx);
      }
    } catch (e) {}
  }, 4000);
}

function stopPixPolling() {
  if (state.checkout.pollInterval) {
    clearInterval(state.checkout.pollInterval);
    state.checkout.pollInterval = null;
  }
}

// Botão de verificação / simulação imediata de PIX
async function handleVerificarPixConfirmado() {
  if (!state.checkout.currentTx) {
    showToast('Gere o PIX primeiro.', 'info');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/checkout/pix/confirmar-simulado/${state.checkout.currentTx}`, {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok && data.status === 'pago') {
      stopPixPolling();
      stopPixCountdown();
      handlePaymentApproved(data);
    } else {
      showToast(data.error || 'Pagamento ainda não identificado. Aguarde alguns instantes.', 'info');
    }
  } catch (err) {
    showToast('Erro ao consultar confirmação PIX.', 'error');
  }
}

// 2. Processamento de Cartão de Crédito
async function handleProcessarCartaoCheckout(event) {
  event.preventDefault();
  if (!state.currentPaciente) return;

  const numero = document.getElementById('card-numero').value.trim();
  const titular = document.getElementById('card-titular').value.trim();
  const validade = document.getElementById('card-validade').value.trim();
  const cvv = document.getElementById('card-cvv').value.trim();
  const parcelas = parseInt(document.getElementById('card-parcelas').value) || 1;

  if (!numero || !titular || !validade || !cvv) {
    showToast('Preencha todos os dados do cartão de crédito.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/checkout/iniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: state.currentPaciente.id,
        tipo_pacote: state.checkout.selectedPackage,
        forma_pagamento: 'cartao_credito',
        parcelas,
        dados_cartao: { numero, titular, validade, cvv },
        consulta_data_hora: state.selectedSlot?.data_hora
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao processar pagamento com cartão.', 'error');
      return;
    }

    handlePaymentApproved(data);

  } catch (err) {
    showToast('Erro de conexão no processamento do cartão.', 'error');
  }
}

// 3. Agendar Utilizando Créditos Pré-Adquiridos
async function handleAgendarComCredito() {
  if (!state.currentPaciente || !state.selectedSlot) {
    showToast('Selecione uma data e horário livre.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/consultas/agendar-com-credito`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: state.currentPaciente.id,
        data_hora: state.selectedSlot.data_hora
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao agendar com crédito.', 'error');
      return;
    }

    handlePaymentApproved(data, true);

  } catch (err) {
    showToast('Erro de conexão ao agendar com crédito.', 'error');
  }
}

// Transição Final para Passo 4 (Boas-Vindas) após Aprovação
function handlePaymentApproved(data, isCreditBooking = false) {
  stopPixCountdown();
  stopPixPolling();

  if (data.consulta) {
    state.lastBooking = data.consulta;
  }

  if (data.creditos_sessoes !== undefined) {
    state.pacienteCredits = data.creditos_sessoes;
    if (state.currentPaciente) {
      state.currentPaciente.creditos_sessoes = data.creditos_sessoes;
      localStorage.setItem('psic_paciente_data', JSON.stringify(state.currentPaciente));
    }
  }

  const bonusNotice = document.getElementById('welcome-package-bonus-notice');
  if (bonusNotice) {
    if (isCreditBooking) {
      bonusNotice.style.display = 'block';
      bonusNotice.innerHTML = `<div class="badge-credit" style="padding: 0.5rem 1rem;">✦ Você utilizou 1 crédito. Saldo restante: <strong>${data.creditos_restantes || 0} créditos</strong>.</div>`;
    } else if (data.tipo_pacote && data.tipo_pacote !== 'avulso') {
      bonusNotice.style.display = 'block';
      bonusNotice.innerHTML = `<div class="badge-credit" style="padding: 0.5rem 1rem;">🎉 Parabéns! Você adquiriu o <strong>${data.nome_pacote || data.tipo_pacote}</strong>. Seus créditos adicionais foram adicionados à sua conta.</div>`;
    } else {
      bonusNotice.style.display = 'none';
    }
  }

  showToast('Pagamento e agendamento confirmados com sucesso!', 'success');
  if (state.lastBooking) {
    renderBoasVindasView(state.lastBooking);
  }
  showStep(4);
}

// Formatadores de Cartão
function formatCardNumber(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 16) v = v.slice(0, 16);
  v = v.replace(/(\d{4})(?=\d)/g, '$1 ');
  input.value = v;

  // Detecta bandeira
  const badge = document.getElementById('card-brand-badge');
  const clean = v.replace(/\D/g, '');
  if (badge) {
    if (clean.startsWith('4')) badge.textContent = '💳 Visa';
    else if (clean.startsWith('5')) badge.textContent = '💳 Mastercard';
    else if (clean.startsWith('34') || clean.startsWith('37')) badge.textContent = '💳 Amex';
    else if (clean.startsWith('6')) badge.textContent = '💳 Elo';
    else badge.textContent = '💳';
  }
}

function formatExpiry(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 4) v = v.slice(0, 4);
  if (v.length >= 2) {
    v = v.slice(0, 2) + '/' + v.slice(2);
  }
  input.value = v;
}

function renderBoasVindasView(consulta) {
  document.getElementById('welcome-patient-name').textContent = state.currentPaciente?.nome_completo || 'Paciente';

  const d = new Date(consulta.data_hora);
  const dataFormatada = d.toLocaleDateString('pt-BR');
  const horaFormatada = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const summary = document.getElementById('confirmed-session-summary');
  summary.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 0.6rem;">
      <span class="subtext">Psicanalista Responsável:</span>
      <strong>Psicanalista Cristina Martins</strong>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 0.6rem;">
      <span class="subtext">Data & Horário:</span>
      <strong style="color: var(--rose-300);">📅 ${dataFormatada} às ${horaFormatada}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 0.6rem;">
      <span class="subtext">Duração & Modalidade:</span>
      <span>50 minutos (Sessão Individual Online / Presencial)</span>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.6rem;">
      <span class="subtext">Status da Sessão:</span>
      <span class="status-badge status-pago">✓ Confirmado & Pago</span>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
      <span class="subtext">Investimento Quitado:</span>
      <strong style="color: var(--gold-300); font-size: 1.15rem;">R$ ${parseFloat(consulta.valor_pago || 180).toFixed(2).replace('.', ',')}</strong>
    </div>
  `;
}

// Chave PIX oficial 24942168856
function copyPixKey() {
  const input = document.getElementById('pix-copy-input');
  if (input) input.select();
  copyPixKeyDirect(PIX_CHAVE_OFICIAL);
}

function copyPixKeyDirect(key = PIX_CHAVE_OFICIAL) {
  navigator.clipboard.writeText(key).then(() => {
    showToast(`Chave PIX (${key}) copiada com sucesso!`, 'success');
  }).catch(() => {
    showToast(`Chave PIX: ${key}`, 'info');
  });
}

// Adicionar ao Google Agenda
function handleAddToGoogleCalendar() {
  if (!state.lastBooking) return;
  const startDate = new Date(state.lastBooking.data_hora);
  const endDate = new Date(startDate.getTime() + 50 * 60 * 1000);

  function formatGoogleDate(d) {
    return d.toISOString().replace(/-|:|\.\d+/g, '');
  }

  const title = encodeURIComponent('Sessão de Psicanálise com Cristina Martins');
  const details = encodeURIComponent(`Sessão individual com a Psicanalista Cristina Martins.\nPaciente: ${state.currentPaciente?.nome_completo || ''}\nStatus: Confirmado e Pago`);
  const location = encodeURIComponent('Consultório de Psicanálise Cristina Martins');
  const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
  window.open(url, '_blank');
}

// Baixar arquivo .ICS para Calendário
function handleDownloadICS() {
  if (!state.lastBooking) return;
  window.location.href = `${API_BASE}/api/consultas/${state.lastBooking.id}/ics`;
}

// ==================== ÁREA DA PACIENTE (MINHAS CONSULTAS) ====================
async function handleLoginPacienteEmail(event) {
  event.preventDefault();
  const email = document.getElementById('login-paciente-email').value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/pacientes/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'E-mail não encontrado.', 'error');
      return;
    }

    state.currentPaciente = data.paciente;
    localStorage.setItem('psic_paciente_data', JSON.stringify(data.paciente));
    showPatientDashboard();
    showToast(`Bem-vinda(o), ${data.paciente.nome_completo}!`, 'success');
  } catch (err) {
    showToast('Erro de conexão ao buscar paciente.', 'error');
  }
}

function handleLogoutPaciente() {
  state.currentPaciente = null;
  localStorage.removeItem('psic_paciente_data');
  document.getElementById('patient-login-box').style.display = 'block';
  document.getElementById('patient-dashboard').style.display = 'none';
  showToast('Você encerrou sua sessão.', 'info');
}

async function showPatientDashboard() {
  if (!state.currentPaciente) return;

  document.getElementById('patient-login-box').style.display = 'none';
  document.getElementById('patient-dashboard').style.display = 'block';

  document.getElementById('patient-display-name').textContent = state.currentPaciente.nome_completo;
  document.getElementById('patient-display-email').textContent = state.currentPaciente.email;
  document.getElementById('patient-avatar').textContent = state.currentPaciente.nome_completo.charAt(0).toUpperCase();

  const creditsEl = document.getElementById('patient-display-credits');
  if (creditsEl) {
    creditsEl.textContent = state.currentPaciente.creditos_sessoes || 0;
  }

  // Atualiza créditos atualizados da paciente
  try {
    const res = await fetch(`${API_BASE}/api/pacientes/${state.currentPaciente.id}/opcoes-pagamento`);
    if (res.ok) {
      const data = await res.json();
      state.currentPaciente.creditos_sessoes = data.creditos_sessoes || 0;
      state.currentPaciente.valor_base_sessao = data.valor_base_unitario || 180;
      localStorage.setItem('psic_paciente_data', JSON.stringify(state.currentPaciente));
      if (creditsEl) creditsEl.textContent = state.currentPaciente.creditos_sessoes;
    }
  } catch (e) {}

  await loadPatientConsultas();
}

async function loadPatientConsultas() {
  const container = document.getElementById('patient-consultas-list');
  container.innerHTML = '<div class="subtext">Carregando suas consultas...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/consultas/paciente/${state.currentPaciente.id}`);
    const consultas = await res.json();

    if (!consultas || consultas.length === 0) {
      container.innerHTML = '<div class="subtext">Você não possui nenhuma sessão agendada no momento.</div>';
      return;
    }

    container.innerHTML = '';
    consultas.forEach(c => {
      const d = new Date(c.data_hora);
      const dataFormatada = d.toLocaleDateString('pt-BR');
      const horaFormatada = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const card = document.createElement('div');
      card.className = 'consulta-card';

      let statusBadge = `<span class="status-badge status-${c.status}">${c.status === 'agendado' ? 'Reservado' : c.status}</span>`;
      let actions = '';

      if (c.status === 'agendado') {
        actions = `
          <div style="background: rgba(197,160,89,0.08); border: 1px dashed var(--border-gold); padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); margin: 0.6rem 0; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.82rem; color: var(--gold-champagne);">PIX: <strong>24942168856</strong></span>
            <button class="btn btn-secondary btn-xs" type="button" onclick="copyPixKeyDirect('24942168856')">Copiar PIX</button>
          </div>
          <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
            <button class="btn btn-primary btn-sm" onclick="paySpecificConsulta('${c.id}', '${c.data_hora}')">Pagar / Confirmar PIX</button>
            <button class="btn btn-danger btn-sm" onclick="cancelSpecificConsulta('${c.id}')">Cancelar</button>
          </div>
        `;
      } else if (c.status === 'pago') {
        actions = `
          <div style="display: flex; gap: 0.5rem; margin-top: 0.8rem;">
            <button class="btn btn-secondary btn-sm" onclick="window.location.href='${API_BASE}/api/consultas/${c.id}/ics'">📅 Baixar .ICS</button>
            <button class="btn btn-danger btn-sm" onclick="cancelSpecificConsulta('${c.id}')">Cancelar</button>
          </div>
        `;
      }

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
            <span style="font-weight: 700; color: var(--rose-400);">Psicanálise Clínica</span>
            ${statusBadge}
          </div>
          <div style="font-size: 1.15rem; font-weight: 600; margin-bottom: 0.4rem;">
            📅 ${dataFormatada} às ${horaFormatada}
          </div>
          <div class="subtext">
            Investimento: R$ ${parseFloat(c.valor_pago || 150).toFixed(2).replace('.', ',')}
          </div>
        </div>
        ${actions}
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div class="subtext">Erro ao buscar consultas.</div>';
  }
}

function paySpecificConsulta(id, data_hora) {
  state.lastBooking = { id, data_hora, valor_pago: 150 };
  renderBoasVindasView(state.lastBooking);
  showStep(3);
  navigateTo('page-agendamento');
}

async function cancelSpecificConsulta(id) {
  if (!confirm('Deseja realmente cancelar esta consulta e liberar o horário?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/consultas/${id}/cancelar`, { method: 'POST' });
    if (res.ok) {
      showToast('Consulta cancelada com sucesso. O horário foi liberado.', 'info');
      loadPatientConsultas();
    } else {
      showToast('Erro ao cancelar consulta.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// ==================== ÁREA RESTRITA (PAINEL DA CRISTINA) ====================

// Login Seguro Criptografado com JWT
async function handleAdminSecureLogin(event) {
  event.preventDefault();
  const email = document.getElementById('admin-email-input').value.trim();
  const senha = document.getElementById('admin-pass-input').value;

  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Credenciais inválidas.', 'error');
      return;
    }

    state.adminToken = data.token;
    sessionStorage.setItem('psic_admin_jwt_token', data.token);

    showToast(`Autenticada com sucesso! Bem-vinda, Cristina.`, 'success');
    navigateTo('page-admin-portal');
  } catch (err) {
    showToast('Erro de autenticação.', 'error');
  }
}

function handleAdminLogout() {
  state.adminToken = '';
  sessionStorage.removeItem('psic_admin_jwt_token');
  navigateTo('page-home');
  showToast('Sessão restrita finalizada.', 'info');
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${state.adminToken}`
  };
}

function switchAdminTab(tabId) {
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-menu-item').forEach(b => b.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.getElementById(`btn-${tabId}`);
  if (targetPane) targetPane.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  if (tabId === 'tab-visao-geral') loadAdminDashboard();
  if (tabId === 'tab-financeiro-gestao') loadAdminFinanceiro();
  if (tabId === 'tab-consultas-gestao') loadAdminConsultas();
  if (tabId === 'tab-horarios-gestao') loadAdminGradeHorarios();
  if (tabId === 'tab-pacientes-gestao') loadAdminPacientes();
}

async function loadAdminDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/metricas`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('metric-pacientes').textContent = data.totalPacientes || 0;
      document.getElementById('metric-consultas').textContent = data.totalConsultas || 0;
      document.getElementById('metric-hoje').textContent = data.consultasHoje || 0;
      document.getElementById('metric-receita').textContent = `R$ ${(data.receitaTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }

    loadAdminConsultas(true);
    loadAdminNotificacoes();
  } catch (err) {
    console.error('Erro ao carregar dashboard admin:', err);
  }
}

async function loadAdminConsultas(isDashboardView = false) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/consultas`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    const consultas = await res.json();
    state.adminConsultas = consultas;

    if (isDashboardView) {
      renderDashboardRecentConsultas(consultas.slice(0, 5));
    } else {
      renderAdminConsultasTable(consultas);
    }
  } catch (err) {
    console.error('Erro ao carregar consultas:', err);
  }
}

function renderDashboardRecentConsultas(consultas) {
  const container = document.getElementById('dashboard-recent-consultas');
  if (!consultas || consultas.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhuma consulta agendada até o momento.</div>';
    return;
  }

  let html = `
    <table class="custom-table">
      <thead>
        <tr>
          <th>Data & Hora</th>
          <th>Paciente</th>
          <th>Status</th>
          <th>Valor</th>
          <th>Prontuário</th>
        </tr>
      </thead>
      <tbody>
  `;

  consultas.forEach(c => {
    const d = new Date(c.data_hora);
    const dateFormatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    html += `
      <tr>
        <td><strong>${dateFormatted}</strong></td>
        <td>${c.paciente_nome}</td>
        <td><span class="status-badge status-${c.status}">${c.status === 'agendado' ? 'Reservado' : c.status}</span></td>
        <td>R$ ${parseFloat(c.valor_pago || 150).toFixed(2).replace('.', ',')}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openProntuarioCompleto('${c.paciente_id}')">
            📁 Prontuário
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderAdminConsultasTable(consultas) {
  const container = document.getElementById('admin-consultas-table-wrapper');
  if (!consultas || consultas.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhuma consulta encontrada.</div>';
    return;
  }

  let html = `
    <table class="custom-table">
      <thead>
        <tr>
          <th>Data & Hora</th>
          <th>Paciente</th>
          <th>Contato</th>
          <th>Status da Reserva</th>
          <th>Valor</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
  `;

  consultas.forEach(c => {
    const d = new Date(c.data_hora);
    const dateFormatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    html += `
      <tr>
        <td><strong>${dateFormatted}</strong></td>
        <td>
          <strong>${c.paciente_nome}</strong>
          ${c.paciente_nascimento ? `<br><small class="subtext">Nasc: ${formatDateDisplay(c.paciente_nascimento)}</small>` : ''}
        </td>
        <td>
          ${c.paciente_whatsapp ? `<a href="https://wa.me/55${c.paciente_whatsapp.replace(/\D/g, '')}" target="_blank" style="color: var(--accent-emerald);">📱 ${c.paciente_whatsapp}</a><br>` : ''}
          <small class="subtext">${c.paciente_email || ''}</small>
        </td>
        <td>
          <select class="form-select" style="padding: 0.35rem 0.6rem; font-size: 0.82rem;" onchange="handleAdminChangeStatus('${c.id}', this.value)">
            <option value="agendado" ${c.status === 'agendado' ? 'selected' : ''}>Reservado (Agendado)</option>
            <option value="pago" ${c.status === 'pago' ? 'selected' : ''}>Pago</option>
            <option value="realizado" ${c.status === 'realizado' ? 'selected' : ''}>Realizado</option>
            <option value="cancelado" ${c.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
          </select>
        </td>
        <td>R$ ${parseFloat(c.valor_pago || 150).toFixed(2).replace('.', ',')}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openProntuarioCompleto('${c.paciente_id}')">
            📁 Prontuário
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function filterAdminConsultas() {
  const filter = document.getElementById('filtro-status-consulta').value;
  if (filter === 'todos') {
    renderAdminConsultasTable(state.adminConsultas);
  } else {
    const filtered = state.adminConsultas.filter(c => c.status === filter);
    renderAdminConsultasTable(filtered);
  }
}

async function handleAdminChangeStatus(consultaId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/consultas/status`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        token: state.adminToken,
        consulta_id: consultaId,
        status: newStatus
      })
    });

    if (res.ok) {
      showToast(`Status atualizado para "${newStatus}".`, 'success');
      loadAdminDashboard();
    } else {
      showToast('Erro ao atualizar status.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// ==================== GERENCIAMENTO DE HORÁRIOS DA CRISTINA ====================

// Carregar Grade Semanal e Folgas
async function loadAdminGradeHorarios() {
  const container = document.getElementById('admin-grade-horarios-list');
  container.innerHTML = '<div class="subtext">Carregando horários da grade...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/admin/horarios`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    const items = await res.json();

    const slots = items.filter(i => i.dia_semana !== null);
    const blocks = items.filter(i => i.data_bloqueio !== null);

    // Agrupa slots por dia da semana (0 a 6)
    const slotsPorDia = {};
    for (let d = 0; d <= 6; d++) slotsPorDia[d] = [];
    slots.forEach(s => slotsPorDia[s.dia_semana].push(s));

    let html = '<div class="grid-2-cols">';

    // Coluna 1: Grade Semanal Organizada por Dia
    html += '<div><h4 style="color: var(--rose-400); margin-bottom: 0.9rem;">Dias de Atendimento da Semana</h4>';
    
    html += '<div style="display: flex; flex-direction: column; gap: 0.9rem;">';
    for (let dia = 1; dia <= 6; dia++) { // Segunda a Sábado
      const diaSlots = slotsPorDia[dia] || [];
      html += renderDiaGradeCard(dia, diaSlots);
    }
    // Domingo
    const domSlots = slotsPorDia[0] || [];
    html += renderDiaGradeCard(0, domSlots);
    html += '</div>';

    html += '</div>';

    // Coluna 2: Folgas e Feriados Bloqueados
    html += '<div><h4 style="color: var(--accent-rose); margin-bottom: 0.9rem;">Folgas, Feriados e Recessos</h4>';
    if (blocks.length === 0) {
      html += '<p class="subtext">Nenhum dia bloqueado. Todos os dias da grade estão livres para agendamento.</p>';
    } else {
      html += '<ul style="list-style: none; display: flex; flex-direction: column; gap: 0.55rem;">';
      blocks.forEach(b => {
        const parts = b.data_bloqueio.split('T')[0].split('-');
        html += `
          <li style="display: flex; justify-content: space-between; align-items: center; background: rgba(244,63,94,0.06); padding: 0.7rem 1rem; border-radius: var(--radius-sm); border: 1px solid rgba(244,63,94,0.25);">
            <span>🔒 <strong>${parts[2]}/${parts[1]}/${parts[0]}</strong> (Dia Bloqueado)</span>
            <button class="btn btn-danger btn-sm" onclick="handleRemoveHorario('${b.id}')">Desbloquear</button>
          </li>
        `;
      });
      html += '</ul>';
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="subtext">Erro ao carregar horários.</div>';
  }
}

function renderDiaGradeCard(dia, diaSlots) {
  const diaNome = NOMES_DIAS_SEMANA[dia];
  const isVazio = diaSlots.length === 0;

  let slotsHtml = '';
  if (isVazio) {
    slotsHtml = '<span class="subtext" style="font-size: 0.82rem;">Nenhum horário liberado</span>';
  } else {
    slotsHtml = diaSlots.map(s => `
      <span style="display: inline-flex; align-items: center; gap: 0.35rem; background: #181322; border: 1px solid var(--border-subtle); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.82rem; font-weight: 600;">
        ${s.hora_inicio.slice(0,5)}
        <button onclick="handleRemoveHorario('${s.id}')" style="background:none; border:none; color: var(--accent-rose); cursor:pointer; font-weight:bold; padding:0 2px;">&times;</button>
      </span>
    `).join(' ');
  }

  return `
    <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.8rem 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
        <strong style="color: var(--text-main); font-size: 0.92rem;">${diaNome}</strong>
        <span style="font-size: 0.75rem; color: var(--gold-400);">${diaSlots.length} horários</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
        ${slotsHtml}
      </div>
    </div>
  `;
}

// Inclusão em Lote de Horários
async function handleGerarHorariosLote(event) {
  event.preventDefault();
  const form = document.getElementById('form-lote-horarios');
  
  const diasChecked = Array.from(form.querySelectorAll('input[name="lote-dias"]:checked')).map(cb => parseInt(cb.value));
  const slotsChecked = Array.from(form.querySelectorAll('input[name="lote-slots"]:checked')).map(cb => cb.value);

  if (diasChecked.length === 0) {
    showToast('Selecione ao menos um dia da semana.', 'error');
    return;
  }
  if (slotsChecked.length === 0) {
    showToast('Selecione ao menos um horário.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/horarios/lote`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        token: state.adminToken,
        dias_semana: diasChecked,
        slots: slotsChecked
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Horários liberados com sucesso!', 'success');
      loadAdminGradeHorarios();
    } else {
      showToast(data.error || 'Erro ao gerar horários em lote.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// Inclusão Individual
async function handleAddHorarioSlot(event) {
  event.preventDefault();
  const dia_semana = parseInt(document.getElementById('slot-dia-semana').value);
  const hora_inicio = document.getElementById('slot-hora-inicio').value;
  const hora_fim = document.getElementById('slot-hora-fim').value;

  try {
    const res = await fetch(`${API_BASE}/api/admin/horarios/adicionar`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken, dia_semana, hora_inicio, hora_fim })
    });

    if (res.ok) {
      showToast('Horário liberado na grade!', 'success');
      loadAdminGradeHorarios();
    } else {
      const data = await res.json();
      showToast(data.error || 'Erro ao adicionar horário.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

function syncBlockEndDate(startDateVal) {
  const endDateInput = document.getElementById('block-data-fim');
  if (endDateInput && (!endDateInput.value || endDateInput.value < startDateVal)) {
    endDateInput.value = startDateVal;
  }
}

// Bloqueio de Feriado, Folga ou Período de Férias
async function handleAddBloqueioData(event) {
  event.preventDefault();
  const data_inicio = document.getElementById('block-data-inicio')?.value || document.getElementById('block-data')?.value;
  let data_fim = document.getElementById('block-data-fim')?.value || data_inicio;
  const motivo = document.getElementById('block-motivo')?.value || '';

  if (!data_inicio) return;
  if (!data_fim || data_fim < data_inicio) {
    data_fim = data_inicio;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/horarios/bloquear-data`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken, data_inicio, data_fim, data_bloqueio: data_inicio, motivo })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'Período bloqueado na agenda com sucesso!', 'success');
      if (document.getElementById('block-data-inicio')) document.getElementById('block-data-inicio').value = '';
      if (document.getElementById('block-data-fim')) document.getElementById('block-data-fim').value = '';
      if (document.getElementById('block-motivo')) document.getElementById('block-motivo').value = '';
      if (document.getElementById('block-data')) document.getElementById('block-data').value = '';
      loadAdminGradeHorarios();
    } else {
      const data = await res.json();
      showToast(data.error || 'Erro ao bloquear período.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar bloqueio.', 'error');
  }
}

// Remover Item da Grade
async function handleRemoveHorario(id) {
  if (!confirm('Deseja remover este item da agenda?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/horarios/remover`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken, id })
    });

    if (res.ok) {
      showToast('Item removido com sucesso.', 'info');
      loadAdminGradeHorarios();
    } else {
      showToast('Erro ao remover item.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// ==================== MÓDULO DE PRONTUÁRIOS DE PSICANÁLISE (ÁREA SIGILOSA) ====================

let searchDebounceTimer = null;
function handleSearchPacientes(query) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadAdminPacientes(query.trim());
  }, 300);
}

// Carregar Lista de Pacientes com Busca Dinâmica
async function loadAdminPacientes(busca = '') {
  const container = document.getElementById('admin-pacientes-table-wrapper');
  container.innerHTML = '<div class="subtext">Carregando pacientes e prontuários...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken, busca })
    });
    const pacientes = await res.json();
    state.adminPacientes = pacientes;

    renderAdminPacientesTable(pacientes);
  } catch (err) {
    console.error('Erro ao carregar pacientes:', err);
    container.innerHTML = '<div class="subtext">Erro ao carregar prontuários.</div>';
  }
}

// Renderizar Tabela de Pacientes Cadastrados
function renderAdminPacientesTable(pacientes) {
  const container = document.getElementById('admin-pacientes-table-wrapper');
  if (!pacientes || pacientes.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhum paciente encontrado para os critérios informados.</div>';
    return;
  }

  let html = `
    <table class="custom-table">
      <thead>
        <tr>
          <th>Paciente</th>
          <th>Contato</th>
          <th>Nascimento</th>
          <th>Motivo Inicial / Relato</th>
          <th>Sessões</th>
          <th>Última Nota</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
  `;

  pacientes.forEach(p => {
    const lastNoteDate = p.ultima_atualizacao_prontuario 
      ? new Date(p.ultima_atualizacao_prontuario).toLocaleDateString('pt-BR') 
      : 'Sem notas';

    html += `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <div class="avatar-circle-sm">${p.nome_completo.charAt(0).toUpperCase()}</div>
            <div>
              <strong>${p.nome_completo}</strong>
              <div class="subtext" style="font-size: 0.75rem;">Cadastrada em ${new Date(p.created_at).toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
        </td>
        <td>
          ${p.whatsapp ? `<a href="https://wa.me/55${p.whatsapp.replace(/\D/g, '')}" target="_blank" style="color: var(--accent-emerald); font-weight: 500;">📱 ${p.whatsapp}</a><br>` : ''}
          <small class="subtext">${p.email || '-'}</small>
        </td>
        <td>${formatDateDisplay(p.data_nascimento) || '<span class="subtext">-</span>'}</td>
        <td>
          <span style="font-size: 0.85rem; color: var(--rose-300);" title="${(p.motivo_consulta || '').replace(/"/g, '&quot;')}">
            ${(p.motivo_consulta || '-').substring(0, 42)}${(p.motivo_consulta && p.motivo_consulta.length > 42) ? '...' : ''}
          </span>
        </td>
        <td>
          <span class="status-badge status-realizado" style="font-size: 0.78rem;">${p.total_consultas || 0} sessões</span>
        </td>
        <td>
          <span class="subtext" style="font-size: 0.8rem;">${lastNoteDate}</span>
        </td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="openProntuarioCompleto('${p.id}')">
            📁 Abrir Prontuário
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Abrir Modal de Prontuário Completo (Criptografia AES-256 e Histórico)
async function openProntuarioCompleto(pacienteId) {
  state.currentProntuarioPacienteId = pacienteId;
  state.selectedFileForUpload = null;

  // Reset visual do modal
  document.getElementById('prontuario-paciente-card').innerHTML = '<div class="subtext">Carregando ficha confidencial...</div>';
  document.getElementById('prontuario-notes-timeline').innerHTML = '<div class="subtext">Descriptografando anotações clínicas...</div>';
  document.getElementById('prontuario-consultas-list').innerHTML = '<div class="subtext">Carregando histórico...</div>';
  document.getElementById('prontuario-anexos-list').innerHTML = '<div class="subtext">Carregando documentos...</div>';
  
  // Limpa campos do form de nota
  const tituloInput = document.getElementById('note-titulo');
  const conteudoInput = document.getElementById('note-conteudo');
  if (tituloInput) tituloInput.value = '';
  if (conteudoInput) conteudoInput.value = '';

  // Limpa dropzone
  const dropLabel = document.getElementById('dropzone-label');
  if (dropLabel) dropLabel.innerHTML = '📄 Clique para selecionar um arquivo (PDF, Documento ou Imagem)';
  const fileInput = document.getElementById('anexo-file-input');
  if (fileInput) fileInput.value = '';

  // Exibe o modal
  document.getElementById('modal-prontuario-completo').classList.add('show');
  switchProntuarioSubTab('subtab-notas');

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes/${pacienteId}/prontuario/completo`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao carregar prontuário.', 'error');
      closeProntuarioCompletoModal();
      return;
    }

    state.currentProntuarioData = data;
    renderProntuarioHeaderCard(data.paciente, data.consultas, data.notas);
    renderProntuarioNotesTimeline(data.notas, data.paciente);
    renderProntuarioConsultas(data.consultas);
    renderProntuarioAnexos(data.anexos);
    renderProntuarioFinanceiro(data.paciente);

  } catch (err) {
    console.error('Erro ao abrir prontuário:', err);
    showToast('Erro ao carregar dados sigilosos do prontuário.', 'error');
  }
}

function closeProntuarioCompletoModal() {
  document.getElementById('modal-prontuario-completo').classList.remove('show');
  state.currentProntuarioPacienteId = null;
  state.currentProntuarioData = null;
  state.selectedFileForUpload = null;
}

// Troca de Sub-abas do Prontuário
function switchProntuarioSubTab(subTabId) {
  document.querySelectorAll('.prontuario-subtab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.prontuario-tab-btn').forEach(b => b.classList.remove('active'));

  const targetPane = document.getElementById(subTabId);
  const targetBtn = document.getElementById(
    subTabId === 'subtab-notas' ? 'subbtn-notas' : 
    subTabId === 'subtab-consultas' ? 'subbtn-consultas' : 
    subTabId === 'subtab-anexos' ? 'subbtn-anexos' : 'subbtn-financeiro'
  );

  if (targetPane) targetPane.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');
}

// Renderizar Cabeçalho / Ficha da Paciente no Prontuário
function renderProntuarioHeaderCard(p, consultas = [], notas = []) {
  const container = document.getElementById('prontuario-paciente-card');
  const title = document.getElementById('prontuario-modal-title');
  const subtitle = document.getElementById('prontuario-modal-subtitle');

  if (title) title.textContent = `Prontuário: ${p.nome_completo}`;
  if (subtitle) subtitle.textContent = `Código Paciente: #${p.id.slice(0, 8)} | Registro Confidencial`;

  container.innerHTML = `
    <div class="patient-profile-top">
      <div class="avatar-circle" style="width: 52px; height: 52px; font-size: 1.4rem;">
        ${p.nome_completo.charAt(0).toUpperCase()}
      </div>
      <div class="profile-info-grid">
        <div class="profile-info-item">
          <span class="label">Paciente:</span>
          <strong>${p.nome_completo}</strong>
        </div>
        <div class="profile-info-item">
          <span class="label">Data de Nascimento:</span>
          <span>${formatDateDisplay(p.data_nascimento) || 'Não informada'}</span>
        </div>
        <div class="profile-info-item">
          <span class="label">WhatsApp:</span>
          <span>${p.whatsapp ? `<a href="https://wa.me/55${p.whatsapp.replace(/\D/g, '')}" target="_blank" style="color: var(--accent-emerald); font-weight: 600;">📱 ${p.whatsapp}</a>` : '-'}</span>
        </div>
        <div class="profile-info-item">
          <span class="label">E-mail:</span>
          <span>${p.email || '-'}</span>
        </div>
      </div>
    </div>
    <div class="patient-motivo-box mt-3">
      <strong>Motivo Inicial da Procura / Queixa Principal:</strong>
      <p style="color: var(--rose-300); margin-top: 0.3rem; font-size: 0.92rem; line-height: 1.5;">
        ${p.motivo_consulta ? `"${p.motivo_consulta}"` : 'Nenhum relato inicial registrado no agendamento.'}
      </p>
    </div>
    <div class="patient-summary-chips mt-2">
      <span class="chip">🗓️ Total de Sessões: <strong>${consultas.length}</strong></span>
      <span class="chip">📝 Notas Clínicas: <strong>${notas.length}</strong></span>
      <span class="chip chip-gold">🔒 AES-256 Em Repouso</span>
    </div>
  `;
}

// Formatação do Tipo de Nota Clínica
function getTipoNotaLabel(tipo) {
  switch (tipo) {
    case 'evolucao': return { text: 'Evolução Clínica', class: 'badge-evolucao' };
    case 'sessao': return { text: 'Sessão Analítica', class: 'badge-sessao' };
    case 'observacao': return { text: 'Observações Gerais', class: 'badge-obs' };
    case 'hipotese_analitica': return { text: 'Hipótese Analítica', class: 'badge-hipotese' };
    default: return { text: 'Anotação', class: 'badge-evolucao' };
  }
}

// Renderizar Linha do Tempo de Notas Salvas (Descriptografadas)
function renderProntuarioNotesTimeline(notas, paciente) {
  const container = document.getElementById('prontuario-notes-timeline');
  const lastUpdateLabel = document.getElementById('prontuario-last-update-text');

  if (!notas || notas.length === 0) {
    if (lastUpdateLabel) lastUpdateLabel.textContent = 'Nenhuma nota registrada ainda';
    container.innerHTML = `
      <div class="subtext" style="padding: 1.5rem; text-align: center; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm);">
        📖 Nenhuma anotação registrada ainda para ${paciente?.nome_completo || 'este paciente'}.<br>
        Utilize o formulário acima para registrar a primeira evolução ou nota de sessão com criptografia AES-256.
      </div>
    `;
    return;
  }

  const latest = notas[0];
  const latestDate = new Date(latest.updated_at || latest.created_at);
  if (lastUpdateLabel) {
    lastUpdateLabel.textContent = `Última atualização: ${latestDate.toLocaleDateString('pt-BR')} às ${latestDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  let html = '';
  notas.forEach(nota => {
    const cDate = new Date(nota.created_at);
    const dateFormatted = `${cDate.toLocaleDateString('pt-BR')} às ${cDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const isUpdated = nota.updated_at && new Date(nota.updated_at).getTime() > new Date(nota.created_at).getTime() + 1000;
    const tipoMeta = getTipoNotaLabel(nota.tipo_nota);

    html += `
      <div class="note-timeline-item" id="note-item-${nota.id}">
        <div class="note-item-header">
          <div class="flex-align-center gap-2">
            <span class="note-type-badge ${tipoMeta.class}">${tipoMeta.text}</span>
            <strong class="note-title">${nota.titulo}</strong>
          </div>
          <div class="note-actions">
            <span class="subtext" style="font-size: 0.78rem;">📅 ${dateFormatted}</span>
            <button class="btn btn-secondary btn-xs" onclick="handleStartEditNota('${nota.id}')" title="Editar Nota">✏️ Editar</button>
            <button class="btn btn-danger btn-xs" onclick="handleDeleteNota('${nota.id}')" title="Excluir Nota">🗑️</button>
          </div>
        </div>
        
        <div class="note-item-content" id="note-content-display-${nota.id}">
          ${(nota.conteudo || '').replace(/\n/g, '<br>')}
        </div>

        <div id="note-edit-box-${nota.id}" style="display: none; margin-top: 0.8rem;">
          <input type="text" id="edit-titulo-${nota.id}" class="form-input mb-2" value="${(nota.titulo || '').replace(/"/g, '&quot;')}">
          <select id="edit-tipo-${nota.id}" class="form-select mb-2">
            <option value="evolucao" ${nota.tipo_nota === 'evolucao' ? 'selected' : ''}>Evolução da Paciente</option>
            <option value="sessao" ${nota.tipo_nota === 'sessao' ? 'selected' : ''}>Registro de Sessão Analítica</option>
            <option value="observacao" ${nota.tipo_nota === 'observacao' ? 'selected' : ''}>Observações Gerais</option>
            <option value="hipotese_analitica" ${nota.tipo_nota === 'hipotese_analitica' ? 'selected' : ''}>Hipótese Diagnóstica / Analítica</option>
          </select>
          <textarea id="edit-conteudo-${nota.id}" class="form-textarea mb-2" rows="4">${nota.conteudo || ''}</textarea>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-primary btn-sm" onclick="handleSaveEditNota('${nota.id}')">💾 Salvar Alterações</button>
            <button class="btn btn-outline btn-sm" onclick="handleCancelEditNota('${nota.id}')">Cancelar</button>
          </div>
        </div>

        ${isUpdated ? `<div class="note-updated-indicator">✏️ Editado em ${new Date(nota.updated_at).toLocaleDateString('pt-BR')} às ${new Date(nota.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
}

// Salvar Nova Anotação no Prontuário (Criptografa com AES-256)
async function handleSalvarNotaProntuario(event) {
  event.preventDefault();
  if (!state.currentProntuarioPacienteId) return;

  const titulo = document.getElementById('note-titulo').value.trim();
  const tipo_nota = document.getElementById('note-tipo').value;
  const conteudo = document.getElementById('note-conteudo').value.trim();

  if (!conteudo) {
    showToast('Digite o conteúdo da anotação.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes/${state.currentProntuarioPacienteId}/notas`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        token: state.adminToken,
        titulo: titulo || 'Anotação de Sessão',
        tipo_nota,
        conteudo
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Anotação clínica salva com criptografia AES-256 e sigilo!', 'success');
      document.getElementById('note-titulo').value = '';
      document.getElementById('note-conteudo').value = '';
      
      // Recarrega o prontuário
      openProntuarioCompleto(state.currentProntuarioPacienteId);
    } else {
      showToast(data.error || 'Erro ao salvar nota clínica.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar nota.', 'error');
  }
}

// Editar Nota
function handleStartEditNota(notaId) {
  const display = document.getElementById(`note-content-display-${notaId}`);
  const editBox = document.getElementById(`note-edit-box-${notaId}`);
  if (display) display.style.display = 'none';
  if (editBox) editBox.style.display = 'block';
}

function handleCancelEditNota(notaId) {
  const display = document.getElementById(`note-content-display-${notaId}`);
  const editBox = document.getElementById(`note-edit-box-${notaId}`);
  if (display) display.style.display = 'block';
  if (editBox) editBox.style.display = 'none';
}

async function handleSaveEditNota(notaId) {
  const titulo = document.getElementById(`edit-titulo-${notaId}`).value.trim();
  const tipo_nota = document.getElementById(`edit-tipo-${notaId}`).value;
  const conteudo = document.getElementById(`edit-conteudo-${notaId}`).value.trim();

  if (!conteudo) {
    showToast('O conteúdo não pode ser vazio.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/notas/${notaId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        token: state.adminToken,
        titulo,
        tipo_nota,
        conteudo
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Nota atualizada e recifrada com sucesso!', 'success');
      openProntuarioCompleto(state.currentProntuarioPacienteId);
    } else {
      showToast(data.error || 'Erro ao atualizar nota.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// Excluir Nota do Prontuário
async function handleDeleteNota(notaId) {
  if (!confirm('Deseja realmente excluir esta anotação do prontuário? Esta ação é irreversível.')) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/notas/${notaId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });

    if (res.ok) {
      showToast('Anotação removida do prontuário.', 'info');
      openProntuarioCompleto(state.currentProntuarioPacienteId);
    } else {
      showToast('Erro ao remover nota.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// Renderizar Sub-aba de Histórico de Consultas
function renderProntuarioConsultas(consultas) {
  const container = document.getElementById('prontuario-consultas-list');
  if (!consultas || consultas.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhuma consulta registrada para esta paciente.</div>';
    return;
  }

  let html = `
    <table class="custom-table">
      <thead>
        <tr>
          <th>Data & Horário</th>
          <th>Status</th>
          <th>Valor Pago</th>
          <th>Observações Rápidas</th>
        </tr>
      </thead>
      <tbody>
  `;

  consultas.forEach(c => {
    const d = new Date(c.data_hora);
    const dateFormatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    html += `
      <tr>
        <td><strong>📅 ${dateFormatted}</strong></td>
        <td><span class="status-badge status-${c.status}">${c.status === 'agendado' ? 'Reservado' : c.status}</span></td>
        <td>R$ ${parseFloat(c.valor_pago || 150).toFixed(2).replace('.', ',')}</td>
        <td><span class="subtext">${c.observacoes || 'Sem anotações rápidas'}</span></td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Manipulação de Arquivos e Anexos (PDFs/Documentos)
function handleFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  // Limite de 15MB
  if (file.size > 15 * 1024 * 1024) {
    showToast('O arquivo selecionado ultrapassa o limite de 15MB.', 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    state.selectedFileForUpload = {
      nome_arquivo: file.name,
      tipo_mime: file.type || 'application/octet-stream',
      tamanho_bytes: file.size,
      dados_base64: e.target.result
    };
    const dropLabel = document.getElementById('dropzone-label');
    if (dropLabel) {
      const sizeKb = (file.size / 1024).toFixed(1);
      dropLabel.innerHTML = `📄 <strong>${file.name}</strong> (${sizeKb} KB) — Pronto para envio!`;
    }
  };
  reader.readAsDataURL(file);
}

// Upload de Documento Anexo ao Prontuário
async function handleUploadAnexo() {
  if (!state.currentProntuarioPacienteId) return;
  if (!state.selectedFileForUpload) {
    showToast('Selecione um arquivo PDF ou documento antes de fazer o upload.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes/${state.currentProntuarioPacienteId}/anexos`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        token: state.adminToken,
        nome_arquivo: state.selectedFileForUpload.nome_arquivo,
        tipo_mime: state.selectedFileForUpload.tipo_mime,
        tamanho_bytes: state.selectedFileForUpload.tamanho_bytes,
        dados_base64: state.selectedFileForUpload.dados_base64
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Documento anexado com sucesso ao prontuário!', 'success');
      state.selectedFileForUpload = null;
      const fileInput = document.getElementById('anexo-file-input');
      if (fileInput) fileInput.value = '';
      const dropLabel = document.getElementById('dropzone-label');
      if (dropLabel) dropLabel.innerHTML = '📄 Clique para selecionar outro arquivo';

      openProntuarioCompleto(state.currentProntuarioPacienteId);
      switchProntuarioSubTab('subtab-anexos');
    } else {
      showToast(data.error || 'Erro ao anexar arquivo.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão no upload.', 'error');
  }
}

// Renderizar Sub-aba de Anexos
function renderProntuarioAnexos(anexos) {
  const container = document.getElementById('prontuario-anexos-list');
  if (!anexos || anexos.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhum documento anexado ao prontuário.</div>';
    return;
  }

  let html = '';
  anexos.forEach(anexo => {
    const d = new Date(anexo.created_at);
    const dateFormatted = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const sizeKb = (anexo.tamanho_bytes / 1024).toFixed(1);

    let icon = '📄';
    if (anexo.tipo_mime?.includes('pdf')) icon = '📕';
    else if (anexo.tipo_mime?.includes('image')) icon = '🖼️';
    else if (anexo.tipo_mime?.includes('word') || anexo.tipo_mime?.includes('document')) icon = '📘';

    html += `
      <div class="anexo-card">
        <div class="anexo-icon">${icon}</div>
        <div class="anexo-meta">
          <strong class="anexo-name" title="${anexo.nome_arquivo}">${anexo.nome_arquivo}</strong>
          <span class="subtext" style="font-size: 0.78rem;">${sizeKb} KB • Enviado em ${dateFormatted}</span>
        </div>
        <div class="anexo-actions">
          <button class="btn btn-secondary btn-sm" onclick="handleDownloadAnexo('${anexo.id}')">⬇️ Baixar</button>
          <button class="btn btn-danger btn-sm" onclick="handleDeleteAnexo('${anexo.id}')">🗑️</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Download Seguro do Arquivo Anexo
function handleDownloadAnexo(anexoId) {
  window.open(`${API_BASE}/api/admin/anexos/${anexoId}/download?token=${encodeURIComponent(state.adminToken)}`, '_blank');
}

// Excluir Arquivo Anexo
async function handleDeleteAnexo(anexoId) {
  if (!confirm('Deseja realmente remover este documento anexo do prontuário?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/anexos/${anexoId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });

    if (res.ok) {
      showToast('Documento removido com sucesso.', 'info');
      openProntuarioCompleto(state.currentProntuarioPacienteId);
      switchProntuarioSubTab('subtab-anexos');
    } else {
      showToast('Erro ao remover documento.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

// Compatibilidade de modal rápido de observações
async function openObservacoesModal(consultaId, pacienteNome, dataHora, observacoes, pacienteId) {
  if (pacienteId) {
    openProntuarioCompleto(pacienteId);
  }
}

function closeObservacoesModal() {
  closeProntuarioCompletoModal();
}

// ==================== GESTÃO FINANCEIRA (PAINEL DA CRISTINA) ====================

async function loadAdminFinanceiro() {
  try {
    // 1. Métricas financeiras consolidadas
    const resMetricas = await fetch(`${API_BASE}/api/admin/financeiro/metricas`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    if (resMetricas.ok) {
      const dataM = await resMetricas.json();
      const recTotalEl = document.getElementById('fin-receita-total');
      const recMesEl = document.getElementById('fin-receita-mes');
      const totalTxEl = document.getElementById('fin-total-transacoes');
      const ticketEl = document.getElementById('fin-ticket-medio');
      const credAtivosEl = document.getElementById('fin-creditos-ativos');

      if (recTotalEl) recTotalEl.textContent = `R$ ${(dataM.receitaTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (recMesEl) recMesEl.textContent = `R$ ${(dataM.receitaMes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (totalTxEl) totalTxEl.textContent = dataM.totalTransacoes || 0;
      if (ticketEl) ticketEl.textContent = `Ticket Médio: R$ ${(dataM.ticketMedio || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (credAtivosEl) credAtivosEl.textContent = dataM.totalCreditosAtivos || 0;
    }

    // 2. Notificações
    loadAdminNotificacoes();

    // 3. Transações Financeiras
    const statusFilter = document.getElementById('filtro-status-transacao')?.value || 'todos';
    const resTx = await fetch(`${API_BASE}/api/admin/financeiro/transacoes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken, status: statusFilter })
    });
    if (resTx.ok) {
      const transacoes = await resTx.json();
      renderAdminTransacoesTable(transacoes);
    }
  } catch (err) {
    console.error('Erro ao carregar dados financeiros:', err);
  }
}

async function loadAdminNotificacoes() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/notificacoes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    if (res.ok) {
      const data = await res.json();
      renderAdminNotificacoes(data.notificacoes || []);
      
      const badge = document.getElementById('admin-notif-badge');
      if (badge) {
        if (data.unreadCount > 0) {
          badge.textContent = data.unreadCount;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  } catch (err) {
    console.error('Erro ao carregar notificações:', err);
  }
}

function renderAdminNotificacoes(notificacoes) {
  const container = document.getElementById('admin-notifications-list');
  if (!container) return;

  if (!notificacoes || notificacoes.length === 0) {
    container.innerHTML = '<div class="subtext text-center py-2">Nenhuma notificação recente.</div>';
    return;
  }

  let html = '';
  notificacoes.forEach(n => {
    const d = new Date(n.created_at);
    const dateStr = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const unreadClass = n.lida ? '' : 'unread';
    const icon = n.tipo === 'pagamento' ? '💰' : '🗓️';

    html += `
      <div class="notif-item ${unreadClass}">
        <div class="notif-icon">${icon}</div>
        <div class="notif-body">
          <div class="notif-header">
            <strong>${n.titulo}</strong>
            <span class="subtext" style="font-size:0.75rem;">${dateStr}</span>
          </div>
          <p class="notif-msg">${n.mensagem}</p>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function handleMarcarNotificacoesLidas() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/notificacoes/ler`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    if (res.ok) {
      showToast('Todas as notificações foram marcadas como lidas.', 'info');
      loadAdminNotificacoes();
    }
  } catch (err) {
    showToast('Erro ao atualizar notificações.', 'error');
  }
}

function renderAdminTransacoesTable(transacoes) {
  const container = document.getElementById('admin-transacoes-table-wrapper');
  if (!container) return;

  if (!transacoes || transacoes.length === 0) {
    container.innerHTML = '<div class="subtext">Nenhuma transação encontrada.</div>';
    return;
  }

  let html = `
    <table class="custom-table">
      <thead>
        <tr>
          <th>Data & Hora</th>
          <th>Paciente</th>
          <th>Pacote / Sessões</th>
          <th>Forma de Pagto</th>
          <th>Parcelas</th>
          <th>Status</th>
          <th>Valor Total</th>
          <th>Prontuário</th>
        </tr>
      </thead>
      <tbody>
  `;

  transacoes.forEach(t => {
    const d = new Date(t.created_at);
    const dateFormatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const formaLabel = t.forma_pagamento === 'pix' 
      ? '❖ PIX' 
      : `💳 Cartão (${t.cartao_bandeira || 'Crédito'}${t.cartao_ultimos_digitos ? ' *' + t.cartao_ultimos_digitos : ''})`;

    const pacoteNome = t.tipo_pacote === 'avulso' ? 'Sessão Avulsa (1)' :
      t.tipo_pacote === 'mensal' ? 'Pacote Mensal (4)' :
      t.tipo_pacote === 'trimestral' ? 'Pacote Trimestral (12) [5% OFF]' :
      t.tipo_pacote === 'semestral' ? 'Pacote Semestral (24) [8% OFF]' : t.tipo_pacote;

    const statusBadge = `<span class="status-badge status-${t.status}">${t.status === 'pago' ? 'Aprovado' : t.status === 'pendente' ? 'Pendente' : t.status}</span>`;

    html += `
      <tr>
        <td><strong>${dateFormatted}</strong></td>
        <td>
          <strong>${t.paciente_nome || '-'}</strong>
          <br><small class="subtext">${t.paciente_email || ''}</small>
        </td>
        <td>
          <span style="color: var(--rose-300); font-weight: 600;">${pacoteNome}</span>
          ${t.desconto_percentual > 0 ? `<br><small class="status-badge status-realizado" style="font-size:0.7rem;">${t.desconto_percentual}% OFF</small>` : ''}
        </td>
        <td>${formaLabel}</td>
        <td>${t.parcelas > 1 ? `${t.parcelas}x de R$ ${parseFloat(t.valor_parcela || 0).toFixed(2).replace('.', ',')}` : 'À vista'}</td>
        <td>${statusBadge}</td>
        <td><strong style="color: var(--gold-300); font-size: 0.95rem;">R$ ${parseFloat(t.valor_total || 0).toFixed(2).replace('.', ',')}</strong></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openProntuarioCompleto('${t.paciente_id}')">
            📁 Abrir Ficha
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ==================== GESTÃO FINANCEIRA NA FICHA DA PACIENTE ====================

async function renderProntuarioFinanceiro(paciente) {
  const inputValorBase = document.getElementById('prontuario-input-valor-base');
  const displayCreditos = document.getElementById('prontuario-display-creditos');
  const inputCreditos = document.getElementById('prontuario-input-creditos');

  const valorBase = Number(paciente.valor_base_sessao) || 180.00;
  const creditos = parseInt(paciente.creditos_sessoes) || 0;

  if (inputValorBase) inputValorBase.value = valorBase.toFixed(2);
  if (displayCreditos) displayCreditos.textContent = creditos;
  if (inputCreditos) inputCreditos.value = creditos;

  const container = document.getElementById('prontuario-financeiro-transacoes-list');
  if (!container) return;
  container.innerHTML = '<div class="subtext">Carregando transações financeiras...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/admin/financeiro/transacoes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token: state.adminToken })
    });
    if (res.ok) {
      const allTx = await res.json();
      const patientTx = allTx.filter(t => t.paciente_id === paciente.id);

      if (patientTx.length === 0) {
        container.innerHTML = '<div class="subtext">Nenhuma transação registrada para esta paciente.</div>';
        return;
      }

      let html = `
        <table class="custom-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Pacote</th>
              <th>Método</th>
              <th>Status</th>
              <th>Valor Total</th>
            </tr>
          </thead>
          <tbody>
      `;
      patientTx.forEach(t => {
        const d = new Date(t.created_at);
        const dateFormatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const formaLabel = t.forma_pagamento === 'pix' ? '❖ PIX' : `💳 Cartão (${t.cartao_bandeira || 'Crédito'})`;
        html += `
          <tr>
            <td><strong>${dateFormatted}</strong></td>
            <td>${t.tipo_pacote} (${t.quantidade_sessoes} sessões)</td>
            <td>${formaLabel}</td>
            <td><span class="status-badge status-${t.status}">${t.status}</span></td>
            <td><strong style="color: var(--gold-300);">R$ ${parseFloat(t.valor_total).toFixed(2).replace('.', ',')}</strong></td>
          </tr>
        `;
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    }
  } catch (err) {
    container.innerHTML = '<div class="subtext">Erro ao carregar histórico financeiro.</div>';
  }
}

async function handleSalvarValorBasePaciente(event) {
  event.preventDefault();
  if (!state.currentProntuarioPacienteId) return;

  const input = document.getElementById('prontuario-input-valor-base');
  const valor_base_sessao = parseFloat(input.value);

  if (isNaN(valor_base_sessao) || valor_base_sessao <= 0) {
    showToast('Informe um valor base válido.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes/${state.currentProntuarioPacienteId}/valor-base`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ valor_base_sessao })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Valor base atualizado com sucesso!', 'success');
      if (state.currentProntuarioData && state.currentProntuarioData.paciente) {
        state.currentProntuarioData.paciente.valor_base_sessao = valor_base_sessao;
      }
    } else {
      showToast(data.error || 'Erro ao atualizar valor base.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar valor base.', 'error');
  }
}

async function handleAjustarCreditosPaciente(event) {
  event.preventDefault();
  if (!state.currentProntuarioPacienteId) return;

  const input = document.getElementById('prontuario-input-creditos');
  const creditos_sessoes = parseInt(input.value);

  if (isNaN(creditos_sessoes) || creditos_sessoes < 0) {
    showToast('Informe um número de créditos válido.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/pacientes/${state.currentProntuarioPacienteId}/creditos`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ creditos_sessoes })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Créditos atualizados com sucesso!', 'success');
      const display = document.getElementById('prontuario-display-creditos');
      if (display) display.textContent = creditos_sessoes;
      if (state.currentProntuarioData && state.currentProntuarioData.paciente) {
        state.currentProntuarioData.paciente.creditos_sessoes = creditos_sessoes;
      }
    } else {
      showToast(data.error || 'Erro ao atualizar créditos.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao ajustar créditos.', 'error');
  }
}

// ==================== MODAL DE COMPRA DIRETA DE PACOTES (PACIENTE) ====================

async function openComprarPacoteModal() {
  if (!state.currentPaciente) {
    showToast('Identifique-se como paciente primeiro.', 'error');
    return;
  }

  const modal = document.getElementById('modal-comprar-pacote');
  if (!modal) return;

  modal.classList.add('show');
  switchModalPaymentTab('pix');

  try {
    const res = await fetch(`${API_BASE}/api/pacientes/${state.currentPaciente.id}/opcoes-pagamento`);
    const data = await res.json();
    if (res.ok) {
      state.modalCheckout.pacotes = data.pacotes;
      renderModalPackageCards(data.pacotes);
      selectModalPackage('mensal');
    }
  } catch (err) {
    console.error('Erro ao carregar pacotes para compra:', err);
  }
}

function closeComprarPacoteModal() {
  const modal = document.getElementById('modal-comprar-pacote');
  if (modal) modal.classList.remove('show');
  state.modalCheckout.currentTx = null;
}

function renderModalPackageCards(pacotes) {
  const container = document.getElementById('modal-packages-container');
  if (!container || !pacotes) return;

  const pkgList = ['mensal', 'trimestral', 'semestral'];
  let html = '';

  pkgList.forEach(tipo => {
    const p = pacotes[tipo];
    if (!p) return;
    const discountBadge = p.desconto_percentual > 0 
      ? `<span class="pkg-badge discount ${p.desconto_percentual >= 8 ? 'gold' : ''}">✦ ${p.desconto_percentual}% OFF</span>` 
      : `<span class="pkg-badge">${tipo === 'mensal' ? 'Mensal' : 'Pacote'}</span>`;

    html += `
      <div class="package-card ${p.desconto_percentual > 0 ? 'highlight-card' : ''}" id="modal-pkg-${tipo}" onclick="selectModalPackage('${tipo}', this)">
        <div class="pkg-header">
          ${discountBadge}
          <h4>${p.nome}</h4>
        </div>
        <div class="pkg-sessoes">${p.sessoes} Sessões</div>
        <div class="pkg-price-wrap">
          ${p.desconto_percentual > 0 ? `<span class="pkg-old-price">R$ ${p.valor_bruto.toFixed(2).replace('.', ',')}</span>` : ''}
          <span class="pkg-currency">R$</span>
          <span class="pkg-price">${p.valor_total.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="pkg-installments">${p.parcelamento_info}</div>
        <div class="pkg-desc">${p.descricao}</div>
        <div class="pkg-radio-indicator">○ Selecionar</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function selectModalPackage(tipo, cardEl) {
  state.modalCheckout.selectedPackage = tipo;
  
  document.querySelectorAll('#modal-packages-container .package-card').forEach(c => {
    c.classList.remove('active');
    const ind = c.querySelector('.pkg-radio-indicator');
    if (ind) ind.textContent = '○ Selecionar';
  });

  const activeCard = cardEl || document.getElementById(`modal-pkg-${tipo}`);
  if (activeCard) {
    activeCard.classList.add('active');
    const ind = activeCard.querySelector('.pkg-radio-indicator');
    if (ind) ind.textContent = '● Selecionado';
  }

  const pacotes = state.modalCheckout.pacotes;
  if (!pacotes) return;
  const pacote = pacotes[tipo] || pacotes.mensal;
  const totalStr = pacote.valor_total.toFixed(2).replace('.', ',');

  const pixDisplay = document.getElementById('modal-pix-total-display');
  if (pixDisplay) pixDisplay.textContent = `R$ ${totalStr}`;

  const parcelasSelect = document.getElementById('modal-card-parcelas');
  if (parcelasSelect) {
    parcelasSelect.innerHTML = '';
    for (let i = 1; i <= pacote.max_parcelas; i++) {
      const vParc = (pacote.valor_total / i).toFixed(2).replace('.', ',');
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i === 1 ? `1x de R$ ${totalStr} (À vista)` : `${i}x de R$ ${vParc} sem juros`;
      parcelasSelect.appendChild(opt);
    }
  }

  // Reseta view PIX
  const pixInit = document.getElementById('modal-pix-init');
  const pixRes = document.getElementById('modal-pix-result');
  if (pixInit) pixInit.style.display = 'block';
  if (pixRes) pixRes.style.display = 'none';
}

function switchModalPaymentTab(method) {
  state.modalCheckout.paymentMethod = method;
  const tabPix = document.getElementById('modal-tab-btn-pix');
  const tabCard = document.getElementById('modal-tab-btn-card');
  const panelPix = document.getElementById('modal-pay-panel-pix');
  const panelCard = document.getElementById('modal-pay-panel-card');

  if (tabPix) tabPix.classList.toggle('active', method === 'pix');
  if (tabCard) tabCard.classList.toggle('active', method === 'cartao_credito');
  if (panelPix) panelPix.style.display = method === 'pix' ? 'block' : 'none';
  if (panelCard) panelCard.style.display = method === 'cartao_credito' ? 'block' : 'none';
}

async function handleGerarPixModalCompra() {
  if (!state.currentPaciente) return;
  try {
    const res = await fetch(`${API_BASE}/api/checkout/iniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: state.currentPaciente.id,
        tipo_pacote: state.modalCheckout.selectedPackage,
        forma_pagamento: 'pix'
      })
    });
    const data = await res.json();
    if (res.ok) {
      state.modalCheckout.currentTx = data.transacao_id;
      const img = document.getElementById('modal-pix-qrcode-img');
      const input = document.getElementById('modal-pix-copia-cola');
      const pixInit = document.getElementById('modal-pix-init');
      const pixRes = document.getElementById('modal-pix-result');

      if (img) img.src = data.pix_qrcode_base64;
      if (input) input.value = data.pix_copia_cola;
      if (pixInit) pixInit.style.display = 'none';
      if (pixRes) pixRes.style.display = 'block';
      showToast('QR Code PIX gerado com sucesso!', 'info');
    } else {
      showToast(data.error || 'Erro ao gerar PIX.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

function copyModalPixCode() {
  const input = document.getElementById('modal-pix-copia-cola');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('Código PIX copiado para a área de transferência!', 'success');
    });
  }
}

async function handleVerificarPixModal() {
  if (!state.modalCheckout.currentTx) return;
  try {
    const res = await fetch(`${API_BASE}/api/checkout/pix/confirmar-simulado/${state.modalCheckout.currentTx}`, {
      method: 'POST'
    });
    const data = await res.json();
    if (res.ok && data.status === 'pago') {
      showToast('Pagamento do pacote aprovado! Seus créditos foram adicionados.', 'success');
      closeComprarPacoteModal();
      if (data.creditos_sessoes !== undefined && state.currentPaciente) {
        state.currentPaciente.creditos_sessoes = data.creditos_sessoes;
        localStorage.setItem('psic_paciente_data', JSON.stringify(state.currentPaciente));
        showPatientDashboard();
      }
    } else {
      showToast('Aguardando confirmação do pagamento pelo banco.', 'info');
    }
  } catch (err) {
    showToast('Erro ao verificar PIX.', 'error');
  }
}

async function handleProcessarCartaoModal(event) {
  event.preventDefault();
  if (!state.currentPaciente) return;

  const numero = document.getElementById('modal-card-numero').value.trim();
  const titular = document.getElementById('modal-card-titular').value.trim();
  const validade = document.getElementById('modal-card-validade').value.trim();
  const cvv = document.getElementById('modal-card-cvv').value.trim();
  const parcelas = parseInt(document.getElementById('modal-card-parcelas').value) || 1;

  try {
    const res = await fetch(`${API_BASE}/api/checkout/iniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paciente_id: state.currentPaciente.id,
        tipo_pacote: state.modalCheckout.selectedPackage,
        forma_pagamento: 'cartao_credito',
        parcelas,
        dados_cartao: { numero, titular, validade, cvv }
      })
    });
    const data = await res.json();
    if (res.ok && data.status === 'pago') {
      showToast('Compra de pacote aprovada! Créditos adicionados ao seu perfil.', 'success');
      closeComprarPacoteModal();
      if (data.creditos_sessoes !== undefined && state.currentPaciente) {
        state.currentPaciente.creditos_sessoes = data.creditos_sessoes;
        localStorage.setItem('psic_paciente_data', JSON.stringify(state.currentPaciente));
        showPatientDashboard();
      }
    } else {
      showToast(data.error || 'Erro ao processar cartão.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão.', 'error');
  }
}

function togglePasswordVisibility(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;

  const openIcon = btn.querySelector('.eye-icon-open');
  const closedIcon = btn.querySelector('.eye-icon-closed');

  if (input.type === 'password') {
    input.type = 'text';
    btn.setAttribute('aria-label', 'Ocultar senha');
    btn.title = 'Ocultar senha';
    if (openIcon) openIcon.style.display = 'none';
    if (closedIcon) closedIcon.style.display = 'inline-block';
  } else {
    input.type = 'password';
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.title = 'Mostrar senha';
    if (openIcon) openIcon.style.display = 'inline-block';
    if (closedIcon) closedIcon.style.display = 'none';
  }
}

window.togglePasswordVisibility = togglePasswordVisibility;
