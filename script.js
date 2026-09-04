/**
 * PreçoMenor — lógica do app (100% front-end, dados salvos no localStorage
 * do seu navegador — nada é enviado para nenhum servidor).
 */

const STORAGE_KEY = 'precomenor_ofertas_v1';
const CANAIS_KEY = 'precomenor_canais_v1';
const APPID_KEY = 'precomenor_appid_v1';

// ---------- Estado ----------

function carregarOfertas() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function salvarOfertas(ofertas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ofertas));
}

function carregarCanais() {
  try {
    const salvos = JSON.parse(localStorage.getItem(CANAIS_KEY));
    if (salvos && salvos.length) return salvos;
  } catch {
    /* ignore */
  }
  // canais padrão sugeridos na conversa original
  return ['grupo_ofertas_1', 'grupo_maes', 'status_whatsapp', 'instagram'];
}

function salvarCanais(canais) {
  localStorage.setItem(CANAIS_KEY, JSON.stringify(canais));
}

let ofertas = carregarOfertas();
let canais = carregarCanais();

// ---------- Cálculo de prioridade (Ofertas) ----------
// Heurística simples: chance de venda (proxy = avaliação) + desconto +
// comissão + comissão extra + frete + cupom. Ajuste os pesos conforme
// for observando o que realmente converte para você.
function calcularScore(oferta) {
  const pesoDesconto = oferta.desconto * 0.3;
  const pesoComissao = oferta.comissao * 1.5;
  const pesoComissaoExtra = oferta.comissaoExtra * 2;
  const pesoAvaliacao = oferta.avaliacao * 4;
  const pesoFrete = oferta.frete === 'sim' ? 5 : 0;
  const pesoCupom = oferta.cupom === 'sim' ? 5 : 0;

  return Math.round(
    (pesoDesconto + pesoComissao + pesoComissaoExtra + pesoAvaliacao + pesoFrete + pesoCupom) * 10
  ) / 10;
}

// Nota de pertinência (0–100), separada da prioridade financeira.
// Ela favorece uma promoção defensável para o público: desconto real,
// boa reputação e benefícios de compra pesam mais que a comissão.
function analisarPertinencia(oferta) {
  const desconto = Math.min(Number(oferta.desconto) || 0, 60);
  const avaliacao = Number(oferta.avaliacao) || 0;
  const qtdAvaliacoes = Number(oferta.qtdAvaliacoes) || 0;
  const comissao = (Number(oferta.comissao) || 0) + (Number(oferta.comissaoExtra) || 0);
  let nota = desconto * 0.55;
  nota += Math.max(0, avaliacao - 3) * 18;
  nota += Math.min(Math.log10(qtdAvaliacoes + 1) * 7, 18);
  nota += oferta.frete === 'sim' ? 8 : 0;
  nota += oferta.cupom === 'sim' ? 7 : 0;
  nota += Math.min(comissao * 0.25, 5);

  const positivos = [];
  const alertas = [];
  if (desconto >= 20) positivos.push(`Desconto atrativo de ${desconto}%`);
  else if (desconto < 10) alertas.push('Desconto abaixo de 10%');
  if (avaliacao >= 4.6) positivos.push(`Boa avaliação: ${avaliacao.toFixed(1)}`);
  else if (avaliacao < 4.2) alertas.push('Avaliação abaixo de 4,2');
  if (qtdAvaliacoes >= 100) positivos.push(`${qtdAvaliacoes} avaliações dão mais confiança`);
  else if (qtdAvaliacoes < 20) alertas.push('Poucas avaliações para validar o produto');
  if (oferta.frete === 'sim') positivos.push('Frete grátis reduz objeção de compra');
  else alertas.push('Sem frete grátis informado');
  if (oferta.cupom === 'sim') positivos.push('Cupom disponível');
  if (!oferta.link || !/^https:\/\//i.test(oferta.link)) alertas.push('Link do produto precisa ser conferido');

  nota = Math.max(0, Math.min(100, Math.round(nota)));
  const faixa = nota >= 75 ? 'alta' : nota >= 50 ? 'media' : 'baixa';
  const recomendacao = nota >= 75 ? 'Boa candidata para o grupo' : nota >= 50 ? 'Confira os alertas antes de aprovar' : 'Pouco pertinente com os dados atuais';
  return { nota, faixa, recomendacao, positivos, alertas };
}

function statusOferta(oferta) {
  return oferta.statusCuradoria || 'pendente';
}

// ---------- Cálculo de lucro ----------
function calcularLucro(oferta) {
  const comissaoTotal = (Number(oferta.comissao) || 0) + (Number(oferta.comissaoExtra) || 0);
  const ganhoPorVenda = (Number(oferta.preco) || 0) * (comissaoTotal / 100);
  const vendas = Number(oferta.vendas) || 0;
  const ganhoAcumulado = ganhoPorVenda * vendas;
  return { ganhoPorVenda, ganhoAcumulado };
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------- Render: Ofertas ----------
function renderOfertas() {
  const container = document.getElementById('lista-ofertas');
  container.innerHTML = '';

  if (!ofertas.length) {
    container.innerHTML = '<p class="vazio">Nenhuma oferta cadastrada ainda. Adicione a primeira acima.</p>';
    return;
  }

  const ordenadas = [...ofertas].sort((a, b) => calcularScore(b) - calcularScore(a));

  ordenadas.forEach((oferta) => {
    const score = calcularScore(oferta);
    const div = document.createElement('div');
    div.className = 'oferta-item';
    div.innerHTML = `
      <div class="topo">
        <h3>${escapeHtml(oferta.nome)}</h3>
        <span class="status-chip ${statusOferta(oferta)}">${statusOferta(oferta)}</span>
        <span class="score-badge">Prioridade ${score}</span>
      </div>
      <div class="oferta-meta">
        <span>${formatarMoeda(Number(oferta.preco) || 0)}</span>
        <span>Desconto ${oferta.desconto}%</span>
        <span>Comissão ${oferta.comissao}% + ${oferta.comissaoExtra}% extra</span>
        <span>⭐ ${oferta.avaliacao}</span>
        ${oferta.frete === 'sim' ? '<span>Frete grátis</span>' : ''}
        ${oferta.cupom === 'sim' ? '<span>Com cupom</span>' : ''}
      </div>
      <div class="oferta-acoes">
        ${statusOferta(oferta) === 'aprovada' ? `<button class="btn-primary" data-acao="gerar" data-id="${oferta.id}">Gerar mensagem</button>` : `<button class="btn-secondary" data-acao="revisar" data-id="${oferta.id}">Revisar pertinência</button>`}
        <button class="btn-secondary" data-acao="remover" data-id="${oferta.id}">Remover</button>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll('[data-acao="gerar"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalMensagem(btn.dataset.id));
  });
  container.querySelectorAll('[data-acao="remover"]').forEach((btn) => {
    btn.addEventListener('click', () => removerOferta(btn.dataset.id));
  });
  container.querySelectorAll('[data-acao="revisar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ativarTab('triagem');
      document.getElementById('busca-ofertas').value = ofertas.find((o) => o.id === btn.dataset.id)?.nome || '';
      document.getElementById('filtro-status').value = 'todos';
      renderTriagem();
    });
  });
}

function renderTriagem() {
  const container = document.getElementById('lista-triagem');
  const termo = (document.getElementById('busca-ofertas')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const filtroStatus = document.getElementById('filtro-status')?.value || 'pendente';
  const categoria = document.getElementById('filtro-categoria')?.value || 'todas';
  const notaMinima = Number(document.getElementById('filtro-nota')?.value) || 0;
  const filtradas = ofertas.filter((oferta) => {
    const analise = analisarPertinencia(oferta);
    const texto = `${oferta.nome} ${oferta.categoria || ''}`.toLocaleLowerCase('pt-BR');
    return (!termo || texto.includes(termo)) &&
      (filtroStatus === 'todos' || statusOferta(oferta) === filtroStatus) &&
      (categoria === 'todas' || (oferta.categoria || 'outros') === categoria) &&
      analise.nota >= notaMinima;
  }).sort((a, b) => analisarPertinencia(b).nota - analisarPertinencia(a).nota);

  document.getElementById('triagem-contador').textContent = `${filtradas.length} encontrada${filtradas.length === 1 ? '' : 's'}`;
  if (!filtradas.length) {
    container.innerHTML = '<p class="vazio">Nenhuma oferta corresponde aos filtros. Cadastre produtos na aba Ofertas ou altere a busca.</p>';
    return;
  }
  container.innerHTML = filtradas.map((oferta) => {
    const analise = analisarPertinencia(oferta);
    const sinais = [
      ...analise.positivos.map((s) => `<li class="positivo">${escapeHtml(s)}</li>`),
      ...analise.alertas.map((s) => `<li class="alerta">${escapeHtml(s)}</li>`),
    ].join('');
    return `<article class="oferta-item">
      <div class="topo">
        <div><h3>${escapeHtml(oferta.nome)}</h3><div class="oferta-meta"><span>${formatarMoeda(Number(oferta.preco) || 0)}</span><span>${escapeHtml(oferta.categoria || 'outros')}</span></div></div>
        <div><span class="status-chip ${statusOferta(oferta)}">${statusOferta(oferta)}</span> <span class="score-badge ${analise.faixa}">${analise.nota}/100</span></div>
      </div>
      <div class="analise-box"><p class="analise-titulo">${analise.recomendacao}</p><ul class="sinais">${sinais}</ul></div>
      ${oferta.motivoRejeicao ? `<p class="hint"><strong>Motivo da rejeição:</strong> ${escapeHtml(oferta.motivoRejeicao)}</p>` : ''}
      <div class="oferta-acoes">
        <button class="btn-approve" data-curadoria="aprovada" data-id="${oferta.id}">Aprovar para envio</button>
        <button class="btn-reject" data-curadoria="rejeitada" data-id="${oferta.id}">Rejeitar</button>
        ${statusOferta(oferta) === 'aprovada' ? `<button class="btn-primary" data-acao="gerar" data-id="${oferta.id}">Preparar mensagem</button>` : ''}
      </div>
    </article>`;
  }).join('');

  container.querySelectorAll('[data-curadoria]').forEach((btn) => btn.addEventListener('click', () => atualizarCuradoria(btn.dataset.id, btn.dataset.curadoria)));
  container.querySelectorAll('[data-acao="gerar"]').forEach((btn) => btn.addEventListener('click', () => abrirModalMensagem(btn.dataset.id)));
}

function atualizarCuradoria(id, status) {
  const oferta = ofertas.find((o) => o.id === id);
  if (!oferta) return;
  let motivo = '';
  if (status === 'rejeitada') motivo = window.prompt('Motivo da rejeição (opcional):', oferta.motivoRejeicao || '') || '';
  oferta.statusCuradoria = status;
  oferta.motivoRejeicao = status === 'rejeitada' ? motivo.trim() : '';
  oferta.revisadaEm = new Date().toISOString();
  salvarOfertas(ofertas);
  renderTriagem();
  renderOfertas();
}

// ---------- Render: Lucro ----------
function renderLucro() {
  const container = document.getElementById('lista-lucro');
  container.innerHTML = '';

  if (!ofertas.length) {
    container.innerHTML = '<p class="vazio">Cadastre ofertas na aba "Ofertas" para ver o lucro estimado aqui.</p>';
    return;
  }

  const ordenadas = [...ofertas].sort(
    (a, b) => calcularLucro(b).ganhoPorVenda - calcularLucro(a).ganhoPorVenda
  );

  ordenadas.forEach((oferta) => {
    const { ganhoPorVenda, ganhoAcumulado } = calcularLucro(oferta);
    const div = document.createElement('div');
    div.className = 'oferta-item';
    div.innerHTML = `
      <div class="topo">
        <h3>${escapeHtml(oferta.nome)}</h3>
        <span class="score-badge">${formatarMoeda(ganhoPorVenda)} / venda</span>
      </div>
      <div class="lucro-fields">
        <label>Comissão normal (%)
          <input type="number" min="0" max="100" step="0.1" value="${oferta.comissao}" data-campo="comissao" data-id="${oferta.id}" />
        </label>
        <label>Comissão extra (%)
          <input type="number" min="0" max="100" step="0.1" value="${oferta.comissaoExtra}" data-campo="comissaoExtra" data-id="${oferta.id}" />
        </label>
        <label>Vendas registradas
          <input type="number" min="0" step="1" value="${oferta.vendas || 0}" data-campo="vendas" data-id="${oferta.id}" />
        </label>
      </div>
      <div class="lucro-resultado">
        Preço ${formatarMoeda(Number(oferta.preco) || 0)} × comissão ${(Number(oferta.comissao)+Number(oferta.comissaoExtra)).toFixed(1)}%
        = <strong>${formatarMoeda(ganhoPorVenda)}</strong> por venda.
        Com ${oferta.vendas || 0} venda(s): <strong>${formatarMoeda(ganhoAcumulado)}</strong> acumulado.
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll('input[data-campo]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const { campo, id } = e.target.dataset;
      const oferta = ofertas.find((o) => o.id === id);
      if (!oferta) return;
      oferta[campo] = e.target.value;
      salvarOfertas(ofertas);
      renderLucro();
      renderOfertas();
    });
  });
}

// ---------- Ações de oferta ----------
function removerOferta(id) {
  ofertas = ofertas.filter((o) => o.id !== id);
  salvarOfertas(ofertas);
  renderOfertas();
  renderLucro();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Geração de mensagem + WhatsApp ----------
let ofertaAtualId = null;

function montarLink(oferta, canal) {
  try {
    const url = new URL(oferta.link);
    // Nota: confirme na sua conta de afiliada Shopee qual é o parâmetro
    // correto de sub_id para o tipo de link que você gera — alguns links
    // curtos da Shopee só aceitam sub_id definido na hora de gerar o link
    // pelo próprio app/portal de afiliados, não por parâmetro de URL solto.
    if (canal) url.searchParams.set('sub_id', canal);
    return url.toString();
  } catch {
    return oferta.link;
  }
}

function montarTexto(oferta, canal) {
  const linhas = [
    `🔥 ${oferta.nome}`,
    '',
    `De olho nessa: ${formatarMoeda(Number(oferta.preco) || 0)}${oferta.desconto > 0 ? ` (${oferta.desconto}% OFF)` : ''}`,
  ];
  if (oferta.cupom === 'sim') linhas.push('🎟️ Tem cupom disponível na página do produto');
  if (oferta.frete === 'sim') linhas.push('🚚 Frete grátis');
  linhas.push('', montarLink(oferta, canal), '', '_Link de afiliada — posso ganhar uma comissão sem custo extra pra você._');
  return linhas.join('\n');
}

function abrirModalMensagem(id) {
  ofertaAtualId = id;
  const oferta = ofertas.find((o) => o.id === id);
  if (!oferta) return;

  const selectCanal = document.getElementById('modal-canal');
  selectCanal.innerHTML = canais.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const textarea = document.getElementById('modal-texto');
  textarea.value = montarTexto(oferta, selectCanal.value);

  selectCanal.onchange = () => {
    textarea.value = montarTexto(oferta, selectCanal.value);
  };

  document.getElementById('modal-mensagem').classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('modal-mensagem').classList.add('hidden');
  ofertaAtualId = null;
}

// ---------- Canais ----------
function renderCanais() {
  const container = document.getElementById('lista-canais');
  container.innerHTML = canais
    .map(
      (c) => `<span class="canal-tag">${escapeHtml(c)} <button data-canal="${escapeHtml(c)}" title="Remover">×</button></span>`
    )
    .join('');

  container.querySelectorAll('button[data-canal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      canais = canais.filter((c) => c !== btn.dataset.canal);
      salvarCanais(canais);
      renderCanais();
    });
  });
}

// ---------- Tabs ----------
function ativarTab(nome) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === nome));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${nome}`));
}

// ---------- Inicialização ----------
document.addEventListener('DOMContentLoaded', () => {
  renderOfertas();
  renderLucro();
  renderCanais();
  renderTriagem();

  const appIdSalvo = localStorage.getItem(APPID_KEY);
  if (appIdSalvo) document.getElementById('cfg-appid').value = appIdSalvo;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => ativarTab(btn.dataset.tab));
  });

  document.getElementById('form-oferta').addEventListener('submit', (e) => {
    e.preventDefault();
    const nova = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      nome: document.getElementById('of-nome').value.trim(),
      categoria: document.getElementById('of-categoria').value,
      preco: document.getElementById('of-preco').value,
      link: document.getElementById('of-link').value.trim(),
      desconto: Number(document.getElementById('of-desconto').value) || 0,
      comissao: Number(document.getElementById('of-comissao').value) || 0,
      comissaoExtra: Number(document.getElementById('of-comissao-extra').value) || 0,
      avaliacao: Number(document.getElementById('of-avaliacao').value) || 0,
      qtdAvaliacoes: Number(document.getElementById('of-qtd-avaliacoes').value) || 0,
      cupom: document.getElementById('of-cupom').value,
      frete: document.getElementById('of-frete').value,
      vendas: 0,
      statusCuradoria: 'pendente',
    };
    ofertas.push(nova);
    salvarOfertas(ofertas);
    renderOfertas();
    renderLucro();
    renderTriagem();
    e.target.reset();
  });

  document.getElementById('form-canal').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('novo-canal');
    const valor = input.value.trim();
    if (valor && !canais.includes(valor)) {
      canais.push(valor);
      salvarCanais(canais);
      renderCanais();
    }
    input.value = '';
  });

  document.getElementById('salvar-appid').addEventListener('click', () => {
    const valor = document.getElementById('cfg-appid').value.trim();
    localStorage.setItem(APPID_KEY, valor);
    const status = document.getElementById('status-api');
    status.textContent = 'AppID salvo neste navegador.';
    setTimeout(() => (status.textContent = ''), 3000);
  });

  document.getElementById('modal-fechar').addEventListener('click', fecharModal);
  ['busca-ofertas', 'filtro-status', 'filtro-categoria', 'filtro-nota'].forEach((id) => {
    document.getElementById(id).addEventListener(id === 'busca-ofertas' ? 'input' : 'change', renderTriagem);
  });
  document.getElementById('modal-copiar').addEventListener('click', async () => {
    const texto = document.getElementById('modal-texto').value;
    try {
      await navigator.clipboard.writeText(texto);
      alert('Texto copiado!');
    } catch {
      alert('Não consegui copiar automaticamente — selecione o texto manualmente.');
    }
  });
  document.getElementById('modal-whatsapp').addEventListener('click', () => {
    const texto = document.getElementById('modal-texto').value;
    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  });
});
