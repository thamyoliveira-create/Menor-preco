/**
 * PreçoMenor — lógica do app (100% front-end, dados salvos no localStorage
 * do seu navegador — nada é enviado para nenhum servidor).
 */

const STORAGE_KEY = 'precomenor_ofertas_v1';
const CANAIS_KEY = 'precomenor_canais_v1';
const APPID_KEY = 'precomenor_appid_v1';
const HISTORICO_KEY = 'precomenor_historico_v1';
const ALERTAS_KEY = 'precomenor_alertas_v1';
const AUTOMACAO_KEY = 'precomenor_automacao_v1';

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

function carregarJson(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) || padrao; } catch { return padrao; }
}

function registrarHistorico(oferta) {
  const historico = carregarJson(HISTORICO_KEY, {});
  const chave = String(oferta.sourceId || oferta.id);
  const registros = Array.isArray(historico[chave]) ? historico[chave] : [];
  const ultimo = registros.at(-1);
  const preco = Number(oferta.preco) || 0;
  if (!ultimo || Number(ultimo.preco) !== preco) registros.push({ preco, em: new Date().toISOString() });
  historico[chave] = registros.slice(-30);
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
}

function resumoHistorico(oferta) {
  const registros = carregarJson(HISTORICO_KEY, {})[String(oferta.sourceId || oferta.id)] || [];
  if (!registros.length) return null;
  const precos = registros.map((r) => Number(r.preco)).filter((p) => p > 0);
  return { menor: Math.min(...precos), maior: Math.max(...precos), registros: precos.length };
}

function normalizarTaxa(valor) {
  const numero = Number(valor) || 0;
  return numero > 0 && numero <= 1 ? numero * 100 : numero;
}

async function buscarOfertasShopee(porLoja = false) {
  porLoja = porLoja === true;
  const termo = document.getElementById('busca-shopee').value.trim();
  const loja = document.getElementById('busca-loja').value.trim();
  const sortType = Number(document.getElementById('ordem-shopee').value) || 1;
  const modo = document.getElementById('modo-shopee').value;
  const qualidade = document.getElementById('qualidade-shopee').value;
  const origem = document.getElementById('origem-shopee').value;
  const status = document.getElementById('status-busca-shopee');
  const botao = document.getElementById('buscar-shopee');
  if ((!porLoja && termo.length < 2 && modo === 'products') || (porLoja && loja.length < 2)) {
    status.className = 'status-busca erro';
    status.textContent = porLoja ? 'Digite o nome ou cole o link da loja.' : 'Digite o produto ou a categoria que deseja procurar.';
    return;
  }

  botao.disabled = true;
  document.getElementById('busca-ofertas').value = '';
  document.getElementById('filtro-status').value = 'todos';
  document.getElementById('filtro-categoria').value = 'todas';
  document.getElementById('filtro-nota').value = '0';
  idsBuscaAtual = [];
  renderTriagem();
  status.className = 'status-busca';
  status.textContent = 'Procurando ofertas e comparando os resultados…';
  try {
    const parametros = new URLSearchParams({ sortType: String(sortType), mode: porLoja ? 'products' : modo, quality: qualidade, origin: origem });
    if (termo && !porLoja) parametros.set('keyword', termo);
    if (porLoja) parametros.set('store', loja);
    const resposta = await fetch(`/api/shopee-search?${parametros}`);
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.error || 'Não foi possível consultar a Shopee.');

    let novas = 0;
    campanhas = Array.isArray(dados.campaigns) ? dados.campaigns : [];
    renderCampanhas();
    const categoriaForcada = document.getElementById('busca-shopee').dataset.categoria || '';
    const idsEncontrados = [];
    dados.offers.forEach((item) => {
      const existente = ofertas.find((o) => o.source === 'shopee' && String(o.sourceId) === String(item.itemId));
      const oferta = {
        id: existente?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${item.itemId}`),
        source: 'shopee',
        sourceId: String(item.itemId),
        nome: item.name,
        loja: item.shopName || 'Loja não informada',
        tipoLoja: item.shopBadge || { code: 'regular', label: 'Loja comum' },
        origemLoja: item.shopOrigin || { code: 'unknown', label: 'Origem não informada' },
        categoria: categoriaForcada || item.category || 'outros',
        imagem: item.imageUrl || '',
        preco: item.price,
        precoAnterior: item.previousPrice || 0,
        link: item.offerLink || item.productLink,
        desconto: item.discountPercent || 0,
        comissao: normalizarTaxa(item.commissionRate),
        comissaoExtra: 0,
        avaliacao: item.rating || 0,
        qtdAvaliacoes: item.sales || 0,
        qualidadeBusca: Number(item.relevanceScore) || 0,
        correspondenciaBusca: Number(item.keywordMatch) || 0,
        cupom: item.couponCode ? 'sim' : 'nao',
        codigoCupom: item.couponCode || '',
        frete: item.freeShipping ? 'sim' : 'nao',
        vendas: existente?.vendas || 0,
        statusCuradoria: existente?.statusCuradoria || 'pendente',
        buscadaEm: new Date().toISOString(),
      };
      if (existente) Object.assign(existente, oferta);
      else { ofertas.push(oferta); novas += 1; }
      idsEncontrados.push(oferta.id);
      registrarHistorico(oferta);
    });
    idsBuscaAtual = idsEncontrados;
    salvarOfertas(ofertas);
    document.getElementById('busca-ofertas').value = porLoja ? '' : termo;
    document.getElementById('filtro-status').value = 'todos';
    renderOfertas();
    renderLucro();
    renderTriagem();
    verificarAlertas(dados.offers);
    status.className = 'status-busca sucesso';
    const origemBusca = dados.store?.name ? ` da loja ${dados.store.name}` : porLoja ? ' da loja escolhida' : dados.searchMode === 'flash' ? ' em Oferta Relâmpago' : dados.searchMode === 'official' ? ' em Lojas Oficiais' : '';
    const descartadas = Number(dados.filteredCount) || 0;
    status.textContent = `${dados.offers.length} ofertas confiáveis${origemBusca}; ${descartadas} resultado(s) duvidoso(s) foram ocultados.`;
  } catch (erro) {
    status.className = 'status-busca erro';
    status.textContent = erro.message;
  } finally {
    delete document.getElementById('busca-shopee').dataset.categoria;
    botao.disabled = false;
  }
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
let campanhas = [];
let alertas = carregarJson(ALERTAS_KEY, []);
let automacaoTimer = null;
let idsBuscaAtual = [];

function salvarAlertas() {
  localStorage.setItem(ALERTAS_KEY, JSON.stringify(alertas));
}

function verificarAlertas(resultados) {
  const agora = new Date().toISOString();
  alertas.forEach((alerta) => {
    if (!alerta.ativo) return;
    const termo = alerta.termo.toLocaleLowerCase('pt-BR');
    const encontrados = resultados.filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(termo) && (!alerta.precoMax || Number(item.price) <= Number(alerta.precoMax)));
    alerta.ultimaVerificacao = agora;
    alerta.encontradas = encontrados.length;
    if (encontrados.length && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`PreçoMenor: ${encontrados.length} oferta(s)`, { body: `${alerta.termo} a partir de ${formatarMoeda(Math.min(...encontrados.map((item) => Number(item.price))))}` });
    }
  });
  salvarAlertas();
  renderAlertas();
}

function renderAlertas() {
  const container = document.getElementById('lista-alertas');
  if (!container) return;
  if (!alertas.length) {
    container.innerHTML = '<p class="vazio">Nenhum alerta criado.</p>';
    return;
  }
  container.innerHTML = alertas.map((alerta) => `<article class="alerta-item">
    <div><strong>${escapeHtml(alerta.termo)}</strong><p>${alerta.precoMax ? `Até ${formatarMoeda(Number(alerta.precoMax))}` : 'Qualquer preço'} · ${alerta.encontradas || 0} encontrada(s)</p></div>
    <div class="oferta-acoes"><button class="btn-secondary" data-alerta-buscar="${alerta.id}">Buscar agora</button><button class="btn-link" data-alerta-remover="${alerta.id}">Remover</button></div>
  </article>`).join('');
  container.querySelectorAll('[data-alerta-buscar]').forEach((botao) => botao.addEventListener('click', () => {
    const alerta = alertas.find((item) => item.id === botao.dataset.alertaBuscar);
    document.getElementById('busca-shopee').value = alerta.termo;
    ativarTab('triagem');
    buscarOfertasShopee();
  }));
  container.querySelectorAll('[data-alerta-remover]').forEach((botao) => botao.addEventListener('click', () => {
    alertas = alertas.filter((item) => item.id !== botao.dataset.alertaRemover);
    salvarAlertas(); renderAlertas();
  }));
}

function configurarAutomacao() {
  if (automacaoTimer) clearInterval(automacaoTimer);
  const minutos = Number(localStorage.getItem(AUTOMACAO_KEY)) || 0;
  if (!minutos) return;
  automacaoTimer = setInterval(() => {
    const proximo = alertas.find((alerta) => alerta.ativo);
    if (!proximo || document.hidden) return;
    document.getElementById('busca-shopee').value = proximo.termo;
    buscarOfertasShopee();
  }, minutos * 60 * 1000);
}

function formatarDataCampanha(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString('pt-BR');
}

function renderCampanhas() {
  const secao = document.getElementById('campanhas-shopee');
  const container = document.getElementById('lista-campanhas');
  if (!secao || !container) return;
  secao.classList.toggle('hidden', !campanhas.length);
  container.innerHTML = campanhas.map((campanha) => `
    <article class="campanha-item">
      ${campanha.imageUrl ? `<img src="${escapeHtml(campanha.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
      <div>
        <strong>${escapeHtml(campanha.name)}</strong>
        <p>${campanha.endsAt ? `Válida até ${formatarDataCampanha(campanha.endsAt)} · ` : ''}Confira as regras no carrinho</p>
        ${campanha.link ? `<a href="${escapeHtml(campanha.link)}" target="_blank" rel="noopener noreferrer">Ver campanha na Shopee</a>` : ''}
      </div>
    </article>
  `).join('');
}

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

function grupoRecomendado(oferta) {
  const categoria = oferta.categoria || 'outros';
  const nome = String(oferta.nome || '').toLocaleLowerCase('pt-BR');
  if (/skincare|s[eé]rum|hidratante|protetor solar/.test(nome)) return 'Skincare e beleza';
  if (categoria === 'beleza') return 'Beleza e cosméticos';
  if (categoria === 'infantil') return 'Infantil e mães';
  if (categoria === 'moda') return 'Moda feminina';
  if (categoria === 'casa') return 'Casa e cozinha';
  if (categoria === 'eletronicos') return 'Eletrônicos e tecnologia';
  if (/escolar|mochila|caderno|estojo|l[aá]pis/.test(nome)) return 'Itens escolares';
  return 'Ofertas gerais';
}

// Nota de pertinência (0–100), separada da prioridade financeira.
// Ela favorece uma promoção defensável para o público: desconto real,
// boa reputação e benefícios de compra pesam mais que a comissão.
function analisarPertinencia(oferta) {
  const desconto = Math.min(Number(oferta.desconto) || 0, 60);
  const avaliacao = Number(oferta.avaliacao) || 0;
  const qtdAvaliacoes = Number(oferta.qtdAvaliacoes) || 0;
  const comissao = (Number(oferta.comissao) || 0) + (Number(oferta.comissaoExtra) || 0);
  const historico = resumoHistorico(oferta);
  const preco = Number(oferta.preco) || 0;
  const tipoLoja = oferta.tipoLoja?.code || 'regular';
  const pontosLoja = tipoLoja === 'official' ? 20 : tipoLoja === 'preferred_plus' ? 16 : tipoLoja === 'preferred' ? 12 : 0;
  let nota = Number.isFinite(Number(oferta.qualidadeBusca)) && Number(oferta.qualidadeBusca) > 0
    ? Number(oferta.qualidadeBusca)
    : Math.max(0, avaliacao - 4) * 30;
  if (!oferta.qualidadeBusca) {
    nota += Math.min(Math.log10(qtdAvaliacoes + 1) * 9, 27);
    nota += pontosLoja;
    nota += Math.min(desconto * 0.3, 15);
    nota += oferta.frete === 'sim' ? 5 : 0;
    nota += oferta.cupom === 'sim' ? 3 : 0;
  }

  const positivos = [];
  const alertas = [];
  if (desconto >= 20) positivos.push(`Desconto atrativo de ${desconto}%`);
  else if (desconto < 10) alertas.push('Desconto abaixo de 10%');
  if (avaliacao >= 4.6) positivos.push(`Boa avaliação: ${avaliacao.toFixed(1)}`);
  else if (avaliacao < 4.2) alertas.push('Avaliação abaixo de 4,2');
  if (qtdAvaliacoes >= 100) positivos.push(`${qtdAvaliacoes} avaliações dão mais confiança`);
  else if (qtdAvaliacoes < 20) alertas.push('Poucas avaliações para validar o produto');
  if (tipoLoja === 'official') positivos.push('Vendido por Loja Oficial');
  else if (tipoLoja === 'preferred' || tipoLoja === 'preferred_plus') positivos.push('Loja indicada pela Shopee');
  else alertas.push('Loja comum: exige avaliação e vendas mais altas');
  if (oferta.correspondenciaBusca >= 0.75) positivos.push('Produto corresponde bem ao termo pesquisado');
  else if (oferta.correspondenciaBusca > 0) alertas.push('Correspondência parcial com a pesquisa');
  if (oferta.frete === 'sim') positivos.push('Frete grátis reduz objeção de compra');
  else alertas.push('Sem frete grátis informado');
  if (oferta.cupom === 'sim') positivos.push('Cupom disponível');
  if (historico?.registros > 1 && preco <= historico.menor) positivos.push('Está no menor preço registrado');
  if (historico?.registros > 1 && preco > historico.menor * 1.08) alertas.push(`Preço atual está ${Math.round(((preco / historico.menor) - 1) * 100)}% acima do menor registrado`);
  if (!oferta.link || !/^https:\/\//i.test(oferta.link)) alertas.push('Link do produto precisa ser conferido');

  nota = Math.max(0, Math.min(100, Math.round(nota)));
  const faixa = nota >= 80 ? 'alta' : nota >= 65 ? 'media' : 'baixa';
  const recomendacao = nota >= 80 ? 'Oferta confiável para revisar' : nota >= 65 ? 'Exige conferência antes de enviar' : 'Não recomendada para envio';
  const chanceVenda = nota;
  const ganhoPorVenda = preco * (comissao / 100);
  return { nota, faixa, recomendacao, positivos, alertas, chanceVenda, ganhoPorVenda, grupo: grupoRecomendado(oferta) };
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
  const filtroStatus = document.getElementById('filtro-status')?.value || 'todos';
  const categoria = document.getElementById('filtro-categoria')?.value || 'todas';
  const notaMinima = Number(document.getElementById('filtro-nota')?.value) || 0;
  const filtradas = ofertas.filter((oferta) => {
    const analise = analisarPertinencia(oferta);
    const texto = `${oferta.nome} ${oferta.categoria || ''}`.toLocaleLowerCase('pt-BR');
    return (idsBuscaAtual === null || idsBuscaAtual.includes(oferta.id)) &&
      (!termo || texto.includes(termo)) &&
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
    const historico = resumoHistorico(oferta);
    const sinais = [
      ...analise.positivos.map((s) => `<li class="positivo">${escapeHtml(s)}</li>`),
      ...analise.alertas.map((s) => `<li class="alerta">${escapeHtml(s)}</li>`),
    ].join('');
    return `<article class="oferta-item oferta-com-imagem">
      ${oferta.imagem ? `<img class="oferta-imagem" src="${escapeHtml(oferta.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
      <div class="oferta-conteudo">
      <div class="topo">
        <div><h3>${escapeHtml(oferta.nome)}</h3><p class="nome-loja">🏪 ${escapeHtml(oferta.loja || 'Loja não informada')} ${oferta.tipoLoja ? `<span class="loja-badge ${escapeHtml(oferta.tipoLoja.code)}">${escapeHtml(oferta.tipoLoja.label)}</span>` : ''} ${oferta.origemLoja ? `<span class="origem-badge ${escapeHtml(oferta.origemLoja.code)}">${escapeHtml(oferta.origemLoja.label)}</span>` : ''}</p><div class="oferta-meta"><span>${formatarMoeda(Number(oferta.preco) || 0)}</span><span>${escapeHtml(oferta.categoria || 'outros')}</span>${historico ? `<span>📉 Menor registrado: ${formatarMoeda(historico.menor)}</span>` : ''}${oferta.codigoCupom ? `<span>🎟️ ${escapeHtml(oferta.codigoCupom)}</span>` : ''}</div></div>
        <div><span class="status-chip ${statusOferta(oferta)}">${statusOferta(oferta)}</span> <span class="score-badge ${analise.faixa}">${analise.nota}/100</span></div>
      </div>
      <div class="ia-selecao">
        <div><span>Índice de confiança</span><strong>${analise.chanceVenda}/100</strong></div>
        <div><span>Ganho por venda</span><strong>${formatarMoeda(analise.ganhoPorVenda)}</strong></div>
        <div><span>Melhor grupo</span><strong>${escapeHtml(analise.grupo)}</strong></div>
      </div>
      <div class="analise-box"><p class="analise-titulo">IA: ${analise.recomendacao}</p><ul class="sinais">${sinais}</ul></div>
      ${oferta.motivoRejeicao ? `<p class="hint"><strong>Motivo da rejeição:</strong> ${escapeHtml(oferta.motivoRejeicao)}</p>` : ''}
      <div class="oferta-acoes">
        <button class="btn-approve" data-curadoria="aprovada" data-id="${oferta.id}">Aprovar para envio</button>
        <button class="btn-reject" data-curadoria="rejeitada" data-id="${oferta.id}">Rejeitar</button>
        ${statusOferta(oferta) === 'aprovada' ? `<button class="btn-primary" data-acao="gerar" data-id="${oferta.id}">Enviar esta oferta</button>` : ''}
      </div>
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
    oferta.loja ? `🏪 Vendido por: ${oferta.loja}` : '',
    oferta.tipoLoja?.label ? `✅ ${oferta.tipoLoja.label}` : '',
    oferta.origemLoja?.label && oferta.origemLoja.code !== 'unknown' ? `📦 Envio ${oferta.origemLoja.label.toLowerCase()}` : '',
    '',
    `De olho nessa: ${formatarMoeda(Number(oferta.preco) || 0)}${oferta.desconto > 0 ? ` (${oferta.desconto}% OFF)` : ''}`,
  ];
  if (oferta.cupom === 'sim') linhas.push('🎟️ Tem cupom disponível na página do produto');
  if (oferta.codigoCupom) linhas.push(`🏷️ Use o cupom: *${oferta.codigoCupom}*`);
  if (oferta.frete === 'sim') linhas.push('🚚 Frete grátis');
  linhas.push('', montarLink(oferta, canal), '', '#publi');
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
  renderAlertas();
  configurarAutomacao();
  document.getElementById('intervalo-automacao').value = localStorage.getItem(AUTOMACAO_KEY) || '0';

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
      loja: document.getElementById('of-loja').value.trim(),
      tipoLoja: null,
      categoria: document.getElementById('of-categoria').value,
      preco: document.getElementById('of-preco').value,
      link: document.getElementById('of-link').value.trim(),
      desconto: Number(document.getElementById('of-desconto').value) || 0,
      comissao: Number(document.getElementById('of-comissao').value) || 0,
      comissaoExtra: Number(document.getElementById('of-comissao-extra').value) || 0,
      avaliacao: Number(document.getElementById('of-avaliacao').value) || 0,
      qtdAvaliacoes: Number(document.getElementById('of-qtd-avaliacoes').value) || 0,
      cupom: document.getElementById('of-cupom').value,
      codigoCupom: document.getElementById('of-codigo-cupom').value.trim().toUpperCase(),
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

  document.getElementById('form-alerta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const termo = document.getElementById('alerta-termo').value.trim();
    const precoMax = Number(document.getElementById('alerta-preco').value) || 0;
    alertas.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), termo, precoMax, ativo: true, encontradas: 0 });
    salvarAlertas(); renderAlertas(); e.target.reset();
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  });
  document.getElementById('salvar-automacao').addEventListener('click', () => {
    const minutos = Number(document.getElementById('intervalo-automacao').value) || 0;
    localStorage.setItem(AUTOMACAO_KEY, String(minutos));
    configurarAutomacao();
    document.getElementById('status-automacao').textContent = minutos ? `Busca automática a cada ${minutos} minutos enquanto o painel estiver aberto.` : 'Busca automática desativada.';
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
  document.getElementById('buscar-shopee').addEventListener('click', buscarOfertasShopee);
  document.getElementById('buscar-loja').addEventListener('click', () => buscarOfertasShopee(true));
  document.getElementById('busca-shopee').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') buscarOfertasShopee();
  });
  document.querySelectorAll('[data-busca-rapida]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const campo = document.getElementById('busca-shopee');
      document.getElementById('modo-shopee').value = 'products';
      campo.value = botao.dataset.buscaRapida;
      campo.dataset.categoria = botao.dataset.categoria;
      buscarOfertasShopee();
    });
  });
  document.querySelectorAll('[data-modo-rapido]').forEach((botao) => {
    botao.addEventListener('click', () => {
      document.getElementById('modo-shopee').value = botao.dataset.modoRapido;
      document.getElementById('busca-shopee').value = '';
      buscarOfertasShopee();
    });
  });
  document.getElementById('modo-shopee').addEventListener('change', (e) => {
    const campo = document.getElementById('busca-shopee');
    campo.placeholder = e.target.value === 'products'
      ? 'Ex: air fryer, material escolar, fone bluetooth'
      : 'Opcional: refine por produto ou categoria';
  });
  document.getElementById('limpar-resultados').addEventListener('click', () => {
    idsBuscaAtual = [];
    campanhas = [];
    document.getElementById('busca-shopee').value = '';
    document.getElementById('busca-ofertas').value = '';
    document.getElementById('status-busca-shopee').textContent = 'Tela limpa. Faça uma nova busca para começar.';
    renderCampanhas();
    renderTriagem();
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
