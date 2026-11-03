// Importação de pedidos do AliExpress: bookmarklet + interpretador de texto colado.
import { lerData, lerNumero, normalizar } from './formato'

// ---------------------------------------------------------------------------
// Bookmarklet: roda NA PÁGINA do AliExpress (precisa ser autossuficiente).
// Tenta ler os cartões de pedido pela estrutura da página; sempre inclui também
// o texto da página, que o app interpreta se a estrutura mudar.
// ---------------------------------------------------------------------------
function bookmarklet() {
  var txt = function (el) { return el ? (el.innerText || el.textContent || '').trim() : '' }
  var pedidos = []
  var cards = document.querySelectorAll('.order-item, [class*="order-item--"], [data-pl="order_item"]')
  cards.forEach(function (card) {
    var cab = txt(card.querySelector('[class*="header-right-info"], [class*="order-item-header"]'))
    var id = (cab.match(/(\d{12,20})/) || [])[1]
    if (!id) id = (txt(card).match(/(?:ID|N[º°o.]*)[^\d]{0,25}(\d{12,20})/i) || [])[1]
    if (!id) return
    var itens = []
    card.querySelectorAll('[class*="content-body"], [class*="order-item-content-info"]').forEach(function (b) {
      var nome = txt(b.querySelector('[class*="info-name"]'))
      if (!nome) return
      var num = txt(b.querySelector('[class*="info-number"]'))
      itens.push({
        nome: nome,
        variacao: txt(b.querySelector('[class*="info-sku"]')),
        quantidade: parseInt((num.match(/[x×]\s*(\d+)/i) || [])[1] || '1', 10),
        preco_texto: num,
      })
    })
    pedidos.push({
      numero: id,
      cabecalho: cab,
      status: txt(card.querySelector('[class*="status"]')),
      total_texto: txt(card.querySelector('[class*="price-total"], [class*="opt-price"]')),
      itens: itens,
      texto: txt(card),
    })
  })
  var dados = { fonte: 'aliexpress-bookmarklet', versao: 1, url: location.href, capturado_em: new Date().toISOString(), pedidos: pedidos, texto: txt(document.body) }
  var json = JSON.stringify(dados)
  var blob = new Blob([json], { type: 'application/json' })
  var a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'aliexpress-pedidos-' + new Date().toISOString().slice(0, 10) + '.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  try { navigator.clipboard.writeText(json) } catch (e) { /* ignora */ }
  alert('Café & Queijo: ' + (pedidos.length ? pedidos.length + ' pedido(s) encontrados' : 'página copiada') + '. O arquivo foi baixado — importe no app em "Importar AliExpress".')
}

export const BOOKMARKLET_HREF = 'javascript:' + encodeURIComponent('(' + bookmarklet.toString() + ')()')

// ---------------------------------------------------------------------------
// Interpretador
// ---------------------------------------------------------------------------
const RE_ID = /(?:order\s*(?:id|number|no\.?)|id\s+do\s+pedido|n[º°o.]*\s*do\s+pedido|n[úu]mero\s+do\s+pedido|pedido\s*n[º°o.]*)\s*[:#]?\s*(\d{12,20})/gi
const RE_DINHEIRO = /(US\s?\$|USD|R\$|BRL|€|\$)\s?(-?[\d.,]+\d)/i
const RE_QTD = /(?:^|\s|\d)[x×]\s?(\d{1,4})\b|qt[dy]\.?\s*:?\s*(\d{1,4})|quantidade\s*:?\s*(\d{1,4})/i
const STATUS = [
  'awaiting payment', 'awaiting shipment', 'awaiting delivery', 'shipped', 'completed', 'closed', 'cancelled', 'refund',
  'aguardando pagamento', 'aguardando envio', 'aguardando entrega', 'aguardando recebimento', 'enviado', 'em transito', 'em trânsito',
  'concluido', 'concluído', 'finalizado', 'encerrado', 'cancelado', 'reembolso',
]

export function moedaDe(texto) {
  const m = String(texto || '').match(RE_DINHEIRO)
  if (!m) return null
  return /R\$|BRL/i.test(m[1]) ? 'BRL' : /€/.test(m[1]) ? 'EUR' : 'USD'
}
function valorDe(texto) {
  const m = String(texto || '').match(RE_DINHEIRO)
  return m ? Math.abs(lerNumero(m[2])) : null
}
function valorRotulo(texto, rotulos) {
  for (const linha of texto.split('\n')) {
    const n = normalizar(linha)
    if (rotulos.some((r) => n.includes(r))) {
      if (/gratis|free|gratuito/.test(n)) return 0
      const v = valorDe(linha)
      if (v !== null) return v
    }
  }
  // rótulo numa linha e valor na seguinte
  const linhas = texto.split('\n')
  for (let i = 0; i < linhas.length - 1; i++) {
    if (rotulos.some((r) => normalizar(linhas[i]).includes(r)) && RE_DINHEIRO.test(linhas[i + 1])) return valorDe(linhas[i + 1])
  }
  return null
}

function dataDe(texto) {
  const m = texto.match(/(?:order\s*date|data\s+do\s+pedido|pedido\s+feito\s+em|data\s+de\s+cria[cç][aã]o|placed\s+on)\s*:?\s*([^\n]{6,40})/i)
  const d = m ? lerData(m[1]) : null
  if (d) return d
  const m2 = texto.match(/(\d{1,2}\s+de\s+[a-zç]{3,}\.?\s+de\s+\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/)
  return m2 ? lerData(m2[1]) : null
}

function statusDe(texto) {
  const n = normalizar(texto)
  return STATUS.find((s) => n.includes(normalizar(s))) || ''
}

function rastreioDe(texto) {
  const m = texto.match(/(?:tracking\s*(?:number|no\.?)|n[úu]mero\s+de\s+rastr\w*|c[óo]digo\s+de\s+rastr\w*|rastreio)\s*:?\s*([A-Z]{2}[A-Z0-9]{6,28}|[A-Z0-9]{10,30})/i)
  return m ? m[1] : ''
}

const IGNORAR_LINHA = /^(order|pedido|id|total|frete|shipping|envio|imposto|tax|status|ver detalhes|view|details|comprar|buy|add to cart|adicionar|contatar|contact|loja|store|track|rastre|confirm|avaliar|review|delete|excluir|mais|more|\d+$)/i

/** Itens a partir do texto de UM pedido. */
function itensDoTexto(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const itens = []
  linhas.forEach((l, i) => {
    if (!RE_DINHEIRO.test(l)) return
    const q = l.match(RE_QTD) || (linhas[i + 1] || '').match(/^[x×]\s?(\d{1,4})$/)
    if (!q) return
    const n = normalizar(l)
    if (/total|frete|shipping|imposto|tax|subtotal/.test(n)) return
    // procura o nome (linha longa) e a variação (linha curta) logo acima
    let nome = '', variacao = ''
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const c = linhas[j]
      if (RE_DINHEIRO.test(c) || IGNORAR_LINHA.test(c)) continue
      if (c.length >= 18) { nome = c; break }
      if (!variacao && c.length < 60) variacao = c
    }
    if (!nome) return
    itens.push({
      nome, variacao: variacao === nome ? '' : variacao,
      quantidade: parseInt(q[1] || q[2] || q[3], 10) || 1,
      preco_unitario: valorDe(l), moeda: moedaDe(l),
    })
  })
  return itens
}

function pedidoDoTexto(numero, texto) {
  const itens = itensDoTexto(texto)
  return {
    numero,
    data: dataDe(texto),
    status: statusDe(texto),
    moeda: moedaDe(texto) || 'USD',
    itens,
    frete: valorRotulo(texto, ['frete', 'shipping', 'envio']) ?? 0,
    impostos: valorRotulo(texto, ['imposto', 'tax', 'icms', 'tributo']) ?? 0,
    total: valorRotulo(texto, ['total do pedido', 'order total', 'total', 'valor total']),
    rastreio: rastreioDe(texto),
  }
}

/** Interpreta texto colado (página "Meus pedidos" ou detalhe do pedido). */
export function interpretarTexto(texto) {
  const t = String(texto || '').replace(/\r/g, '').replace(/\u00a0/g, ' ')
  const marcas = [...t.matchAll(RE_ID)]
  if (!marcas.length) return []
  // início de cada pedido = cabeçalho (status / data) logo antes do número
  const RE_DATA = /order\s*date|data\s+do\s+pedido|pedido\s+feito\s+em|placed\s+on/gi
  const inicios = marcas.map((m, i) => {
    const de = i > 0 ? marcas[i - 1].index + marcas[i - 1][0].length : 0
    const regiao = t.slice(de, m.index)
    let pos = t.lastIndexOf('\n', m.index) + 1
    const datas = [...regiao.matchAll(RE_DATA)]
    if (datas.length) pos = Math.min(pos, de + t.slice(de, m.index).lastIndexOf('\n', datas[datas.length - 1].index) + 1)
    // até 2 linhas antes com o status do pedido
    for (let k = 0; k < 2; k++) {
      const ant = t.lastIndexOf('\n', pos - 2) + 1
      if (ant < de || pos <= 0) break
      if (!statusDe(t.slice(ant, pos))) break
      pos = ant
    }
    return Math.max(pos, de)
  })
  const vistos = new Set()
  const pedidos = []
  marcas.forEach((m, i) => {
    if (vistos.has(m[1])) return
    vistos.add(m[1])
    let j = i + 1
    while (j < marcas.length && marcas[j][1] === m[1]) j++
    pedidos.push(pedidoDoTexto(m[1], t.slice(inicios[i], j < marcas.length ? inicios[j] : t.length)))
  })
  return pedidos
}

/** Interpreta o arquivo .json do bookmarklet (usa a estrutura e completa pelo texto). */
export function interpretarJson(dados) {
  if (!dados || !String(dados.fonte || '').startsWith('aliexpress')) throw new Error('Este arquivo não veio do botão “Café & Queijo: AliExpress”.')
  const doTexto = interpretarTexto(dados.texto || '')
  const out = []
  for (const p of dados.pedidos || []) {
    const t = pedidoDoTexto(p.numero, p.texto || '')
    const itens = (p.itens || []).length ? p.itens.map((it) => ({
      nome: it.nome, variacao: it.variacao || '', quantidade: it.quantidade || 1,
      preco_unitario: valorDe(it.preco_texto), moeda: moedaDe(it.preco_texto),
    })) : t.itens
    out.push({
      ...t, itens,
      data: dataDe(p.cabecalho || '') || t.data,
      status: p.status || t.status,
      total: valorDe(p.total_texto) ?? t.total,
      moeda: moedaDe(p.total_texto) || t.moeda,
    })
  }
  // pedidos que só apareceram no texto (ex.: página de detalhe)
  for (const p of doTexto) if (!out.some((o) => o.numero === p.numero)) out.push(p)
  // completa rastreio/frete/impostos de quem veio pela estrutura
  for (const o of out) {
    const t = doTexto.find((x) => x.numero === o.numero)
    if (t) { o.rastreio ||= t.rastreio; o.frete ||= t.frete; o.impostos ||= t.impostos }
  }
  return out
}

export const chaveItem = (nome, variacao) => `${normalizar(nome).slice(0, 120)}|${normalizar(variacao).slice(0, 80)}`
