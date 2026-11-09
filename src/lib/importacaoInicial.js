// Analisa a planilha antiga (abas Precificação, Pedidos, Vendas, Estoque, Estoque Escola...)
// e monta uma proposta de importação + lista de dados inconsistentes para revisar.
// É uma função pura: não grava nada. A tela mostra o resultado e só grava após confirmação.
import { lerData, lerNumero, normalizar } from './formato'

const limparSku = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim())
const invalido = (v) => /^#(n\/a|ref!|valor!|value!|div\/0!|nome\?)/i.test(texto(v)) || texto(v) === '-'
const num = (v) => (invalido(v) ? null : v === '' || v === null || v === undefined ? null : lerNumero(v))
const dt = (v) => (invalido(v) ? null : lerData(v))

const PARADAS = new Set(['de', 'da', 'do', 'p', 'c', 's', 'para', 'com', 'e', 'icafilas', '3a', 'pct', 'un', 'unidade', 'kit', '-', '/', 'solta', '1'])
const SINONIMOS = { dg: ['dolce', 'gusto'], dc: ['dolce', 'gusto'], pf: ['porta', 'filtro'], cap: ['capsula'], pres: ['pressurizado'], capsulas: ['capsula'], copos: ['copo'] }
export function tokens(nome) {
  return normalizar(nome).replace(/\(.*?\)/g, ' ').replace(/[()+,/-]/g, ' ')
    .split(' ').flatMap((t) => SINONIMOS[t] || [t]).filter((t) => t && !PARADAS.has(t))
}
function contem(consulta, nome) {
  const B = new Set(tokens(nome))
  const A = tokens(consulta)
  return A.length > 0 && A.every((t) => B.has(t))
}
function similaridade(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return (2 * inter) / (A.size + B.size)
}

function acharAba(abas, ...nomes) {
  for (const n of nomes) {
    const a = abas.find((x) => normalizar(x.nome) === normalizar(n))
    if (a) return a
  }
  return null
}
function acharLinhaCab(linhas, obrigatorias) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cel = (linhas[i] || []).map((c) => normalizar(c))
    if (obrigatorias.every((o) => cel.some((c) => c === o || c.startsWith(o)))) return i
  }
  return -1
}
const col = (cab, ...nomes) => {
  const c = cab.map((x) => normalizar(x))
  for (const n of nomes) { const i = c.findIndex((x) => x === normalizar(n)); if (i > -1) return i }
  for (const n of nomes) { const i = c.findIndex((x) => x.startsWith(normalizar(n))); if (i > -1) return i }
  return -1
}

/**
 * @param abas   [{ nome, linhas }]
 * @param opcoes { mapaNomes: { 'nome normalizado': 'SKU' }, contaML: 'Mercado Livre 1', incluirVendasAntigas: true }
 */
export function analisarPlanilha(abas, opcoes = {}) {
  const problemas = []
  const p = (nivel, aba, linha, msg) => problemas.push({ nivel, aba, linha, msg })
  const produtos = new Map() // sku -> produto
  const mapaNomes = opcoes.mapaNomes || {}

  // ---------------------------------------------------------------- Precificação
  const pre = acharAba(abas, 'Precificação', 'Precificacao')
  if (!pre) p('erro', 'Precificação', null, 'Aba “Precificação” não encontrada.')
  let cfgSug = null
  if (pre) {
    const h = acharLinhaCab(pre.linhas, ['produto', 'sku'])
    const cab = pre.linhas[h] || []
    const sub = pre.linhas[h + 1] || []
    const cProd = col(cab, 'produto'), cSku = col(cab, 'sku'), cCusto = col(cab, 'custo aquisicao', 'custo')
    const pvReais = sub.map((c, i) => [normalizar(c), i]).filter(([c]) => c.startsWith('pv real')).map(([, i]) => i)
    const cTaxaShp = sub.findIndex((c) => normalizar(c) === 'taxa shopee')
    const cTaxaMl = sub.findIndex((c) => normalizar(c) === 'taxa mercado livre')
    const cAds = sub.findIndex((c) => normalizar(c) === 'ads')
    const cC1 = sub.findIndex((c) => normalizar(c).startsWith('c1')), cC2 = sub.findIndex((c) => normalizar(c).startsWith('c2')), cC3 = sub.findIndex((c) => normalizar(c).startsWith('c3'))
    const c1s = [], c2s = [], adss = []
    pre.linhas.slice(h + 1).forEach((l, k) => {
      const linha = h + 2 + k
      const nome = texto(l[cProd]), skuOrig = texto(l[cSku])
      if (!nome || !skuOrig) return
      const sku = limparSku(skuOrig)
      if (sku !== skuOrig) p('aviso', 'Precificação', linha, `SKU “${skuOrig.replace(/\n/g, '↵')}” tinha espaço/quebra de linha → usado “${sku}”.`)
      if (produtos.has(sku)) { p('erro', 'Precificação', linha, `SKU ${sku} repetido (“${nome}” e “${produtos.get(sku).nome}”). Só o primeiro será importado.`); return }
      const custo = num(l[cCusto])
      if (!custo) p('aviso', 'Precificação', linha, `${sku}: sem custo de aquisição.`)
      const comMl = num(l[cTaxaMl]), comShp = num(l[cTaxaShp])
      produtos.set(sku, {
        sku, sku_original: skuOrig, nome, tipo: 'peca', custo: custo || 0, origem: 'Precificação', ativo: true,
        preco_shopee: num(l[pvReais[0]]), preco_ml: num(l[pvReais[1]]),
        comissao_ml: comMl !== null ? Math.round(comMl * 1000) / 10 : null, comissao_shopee: comShp !== null ? Math.round(comShp * 1000) / 10 : null,
      })
      if (cC1 > -1) c1s.push(num(l[cC1 + 1])); if (cC2 > -1) c2s.push((num(l[cC2 + 1]) || 0) + (cC3 > -1 ? num(l[cC3 + 1]) || 0 : 0)); if (cAds > -1) adss.push(num(l[cAds]))
    })
    const mediana = (a) => { const b = a.filter((x) => x !== null && !isNaN(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null }
    cfgSug = { embalagem: mediana(c1s), custos_indiretos: mediana(c2s), ads_pct: mediana(adss) !== null ? Math.round(mediana(adss) * 1000) / 10 : null }
  }

  // números de SKU repetidos (ex.: TAMPE0021 e ADCRG0021) — só informativo
  const porNumero = {}
  for (const s of produtos.keys()) { const n = s.match(/(\d{1,4})$/)?.[1]; if (n) (porNumero[Number(n)] ||= []).push(s) }
  for (const [n, l] of Object.entries(porNumero)) if (l.length > 1) p('info', 'Precificação', null, `Numeração ${n} usada em mais de um SKU: ${l.join(', ')}. Não é erro, mas os próximos SKUs gerados pelo app continuam a partir do maior número.`)

  // ---------------------------------------------------------------- Precificação Antiga (produtos que só existem lá)
  const antiga = acharAba(abas, 'Precificação Antiga', 'Precificacao Antiga')
  if (antiga) {
    const h = acharLinhaCab(antiga.linhas, ['sku', 'produto'])
    const cab = antiga.linhas[h] || []
    const cSku = col(cab, 'sku'), cProd = col(cab, 'produto'), cCusto = col(cab, 'custo')
    antiga.linhas.slice(h + 1).forEach((l) => {
      const sku = limparSku(l[cSku]), nome = texto(l[cProd])
      if (!sku || !nome || !/[A-Z]/.test(sku) || produtos.has(sku)) return
      const igual = [...produtos.values()].find((x) => normalizar(x.nome) === normalizar(nome))
      if (igual) return
      produtos.set(sku, { sku, sku_original: texto(l[cSku]), nome, tipo: 'peca', custo: num(l[cCusto]) || 0, origem: 'Precificação Antiga', ativo: false })
    })
  }

  // ---------------------------------------------------------------- busca de produto por SKU/nome
  const lista = () => [...produtos.values()]
  function porNome(nome, aba, linha, avisar = true) {
    const n = normalizar(nome)
    if (!n) return null
    if (mapaNomes[n]) return mapaNomes[n] === '__ignorar' ? '__ignorar' : mapaNomes[n]
    const exato = lista().find((x) => normalizar(x.nome) === n)
    if (exato) return exato.sku
    let todos = lista().map((x) => ({ x, s: similaridade(nome, x.nome), c: contem(nome, x.nome) })).sort((a, b) => b.s - a.s)
    // "kit …" na descrição: procura entre os kits
    if (/\bkit\b/.test(n)) { const soKits = todos.filter((t) => /\bkit\b/i.test(t.x.nome)); if (soKits.length) todos = soKits }
    if (todos[0]?.s === 1 && todos[1]?.s !== 1) return todos[0].x.sku
    const contidos = todos.filter((c) => c.c)
    const cands = contidos.length ? contidos : todos.filter((c) => c.s >= 0.6)
    if (cands.length && (cands.length === 1 || cands[0].s - cands[1].s >= 0.1)) {
      if (avisar && cands[0].s < 0.85) p('info', aba, linha, `“${nome}” associado a ${cands[0].x.sku} (“${cands[0].x.nome}”) por semelhança. Confira.`)
      return cands[0].x.sku
    }
    return null
  }
  const naoReconhecidos = new Map()
  const naoRec = (nome, aba, linha) => { const n = normalizar(nome); if (!naoReconhecidos.has(n)) naoReconhecidos.set(n, { nome, ocorrencias: [] }); naoReconhecidos.get(n).ocorrencias.push(`${aba} linha ${linha}`) }

  // ---------------------------------------------------------------- Estoque (aba principal)
  const estoque = []
  const est = acharAba(abas, 'Estoque')
  if (est) {
    const h = acharLinhaCab(est.linhas, ['sku', 'produto'])
    const cab = est.linhas[h] || []
    const cSku = col(cab, 'sku'), cProd = col(cab, 'produto'), cQtd = col(cab, 'quant'), cLoc = col(cab, 'disponibilidade')
    est.linhas.slice(h + 1).forEach((l, k) => {
      const linha = h + 2 + k
      const skuOrig = texto(l[cSku]), nome = texto(l[cProd])
      if (!skuOrig && !nome) return
      let sku = limparSku(skuOrig)
      if (!produtos.has(sku)) {
        const pn = porNome(nome, 'Estoque', linha, false)
        if (pn && pn !== '__ignorar') { p('aviso', 'Estoque', linha, `SKU ${sku} não existe na Precificação; pelo nome é ${pn}. Usado ${pn}.`); sku = pn }
        else {
          produtos.set(sku, { sku, sku_original: skuOrig, nome, tipo: 'peca', custo: 0, origem: 'Estoque', ativo: true })
          p('aviso', 'Estoque', linha, `${sku} (“${nome}”) só existe na aba Estoque: será criado sem custo.`)
        }
      }
      const q = num(l[cQtd])
      if (q === null) { p('info', 'Estoque', linha, `${sku}: quantidade em branco (considerado 0).`) }
      estoque.push({ sku, local: 'Principal', quantidade: q || 0, localizacao: cLoc > -1 ? texto(l[cLoc]) : '', origem: `Estoque linha ${linha}` })
    })
  } else p('aviso', 'Estoque', null, 'Aba “Estoque” não encontrada: o estoque inicial ficará zerado.')

  // ---------------------------------------------------------------- Kits: pacotes de N cápsulas
  const kits = []
  const novasPecas = []
  const reNum = /^(\d+)\s+(c[aá]psulas?)\s+(.+?)(?:\s+([cs])\/\s*colher\s+e\s+escovinha)?$/i
  const grupos = new Map()
  for (const x of lista()) {
    const m = x.nome.match(reNum)
    if (!m) continue
    const resto = m[3].trim()
    const chave = normalizar(resto)
    if (!grupos.has(chave)) grupos.set(chave, { resto, membros: [] })
    grupos.get(chave).membros.push({ x, n: Number(m[1]), acessorio: (m[4] || '').toLowerCase() === 'c' })
  }
  let proxNum = Math.max(0, ...lista().map((x) => Number(x.sku.match(/(\d{1,4})$/)?.[1] || 0)))
  const novoSku = (prefixo) => `${prefixo}${String(++proxNum).padStart(4, '0')}`
  let colher = null, escova = null
  for (const g of grupos.values()) {
    // a peça base já existe? (mesmo nome sem o número na frente)
    let base = lista().find((x) => normalizar(x.nome) === normalizar(`Cápsula ${g.resto}`) || normalizar(x.nome) === normalizar(g.resto))
    const semAcess = g.membros.filter((m) => !m.acessorio && m.x.custo)
    const custoBase = semAcess.length ? semAcess.reduce((s, m) => s + m.x.custo / m.n, 0) / semAcess.length : (g.membros[0].x.custo / g.membros[0].n)
    if (!base) {
      const prefixo = g.membros[0].x.sku.replace(/\d{1,4}$/, '')
      base = { sku: novoSku(prefixo), nome: `Cápsula ${g.resto} (unidade)`, tipo: 'peca', custo: Math.round(custoBase * 10000) / 10000, origem: 'novo (peça base)', ativo: true }
      produtos.set(base.sku, base); novasPecas.push(base.sku)
      p('aviso', 'Kits', null, `Criada a peça base ${base.sku} “${base.nome}” (custo ${custoBase.toFixed(2)} = custo do pacote ÷ quantidade).`)
    }
    if (g.membros.some((m) => m.acessorio) && !colher) {
      const um = g.membros.find((m) => m.acessorio && m.n === 1), umS = g.membros.find((m) => !m.acessorio && m.n === 1)
      const extra = um && umS ? Math.max(0, um.x.custo - umS.x.custo) : 0.34
      colher = { sku: novoSku('COLHE'), nome: 'Colher dosadora (cápsula)', tipo: 'peca', custo: Math.round((extra / 2) * 100) / 100, origem: 'novo (peça base)', ativo: true }
      escova = { sku: novoSku('ESCOV'), nome: 'Escovinha de limpeza (cápsula)', tipo: 'peca', custo: Math.round((extra / 2) * 100) / 100, origem: 'novo (peça base)', ativo: true }
      produtos.set(colher.sku, colher); produtos.set(escova.sku, escova); novasPecas.push(colher.sku, escova.sku)
      p('aviso', 'Kits', null, `Criadas as peças ${colher.sku} (colher) e ${escova.sku} (escovinha) com custo ${colher.custo.toFixed(2)} cada (diferença entre o pacote de 1 “C/” e “S/”). Na sua planilha essa diferença cresce com a quantidade de cápsulas; usei 1 colher + 1 escovinha por kit, como você descreveu. Confira.`)
    }
    // estoque da peça base = maior (quantidade de pacotes × N) informado
    const qts = g.membros.map((m) => ({ m, e: estoque.find((e) => e.sku === m.x.sku && e.local === 'Principal') })).filter((r) => r.e && r.e.quantidade)
    if (qts.length) {
      const pecas = qts.map((r) => r.e.quantidade * r.m.n)
      const qtdBase = Math.max(...pecas)
      if (new Set(pecas).size > 1) p('aviso', 'Estoque', null, `Grupo “${g.resto}”: os pacotes indicam quantidades diferentes de peças (${qts.map((r) => `${r.m.x.sku}: ${r.e.quantidade}×${r.m.n}=${r.e.quantidade * r.m.n}`).join('; ')}). Usado ${qtdBase}. Confira.`)
      else p('info', 'Estoque', null, `Grupo “${g.resto}”: ${qts.map((r) => `${r.m.x.sku} ${r.e.quantidade} pacotes`).join(', ')} = ${qtdBase} cápsulas (é o mesmo estoque visto em pacotes diferentes).`)
      const loc = qts[0].e.localizacao
      for (const r of qts) { r.e.quantidade = 0; r.e.ignorar = true }
      const jaTem = estoque.find((e) => e.sku === base.sku && e.local === 'Principal' && !e.ignorar)
      if (jaTem) {
        if (jaTem.quantidade !== qtdBase) p('aviso', 'Estoque', null, `${base.sku}: a aba Estoque diz ${jaTem.quantidade}, mas os pacotes indicam ${qtdBase}. Usado ${Math.max(jaTem.quantidade, qtdBase)}.`)
        jaTem.quantidade = Math.max(jaTem.quantidade, qtdBase)
      } else estoque.push({ sku: base.sku, local: 'Principal', quantidade: qtdBase, localizacao: loc, origem: 'calculado dos pacotes' })
    }
    for (const m of g.membros) {
      if (m.x.sku === base.sku) continue
      m.x.tipo = 'kit'
      const comp = [{ sku: base.sku, quantidade: m.n }]
      if (m.acessorio && colher) comp.push({ sku: colher.sku, quantidade: 1 }, { sku: escova.sku, quantidade: 1 })
      kits.push({ kit: m.x.sku, componentes: comp, motivo: `pacote de ${m.n}${m.acessorio ? ' com colher e escovinha' : ''}` })
    }
  }
  if (colher) {
    estoque.push({ sku: colher.sku, local: 'Principal', quantidade: 0, localizacao: '', origem: 'informe a quantidade', revisar: true })
    estoque.push({ sku: escova.sku, local: 'Principal', quantidade: 0, localizacao: '', origem: 'informe a quantidade', revisar: true })
    p('erro', 'Estoque', null, `Informe quantas colheres (${colher.sku}) e escovinhas (${escova.sku}) você tem — sem isso os kits “C/ Colher e Escovinha” aparecem sem disponibilidade.`)
  }

  // ---------------------------------------------------------------- Kits nomeados “Kit …”: procura peças cujo custo soma o custo do kit
  for (const x of lista()) {
    if (x.tipo === 'kit' || !/^kit\b/i.test(x.nome) || !x.custo || (opcoes.rejeitarKits || []).includes(x.sku)) continue
    const tk = new Set(tokens(x.nome))
    const pecas = lista().filter((y) => y !== x && y.tipo === 'peca' && y.ativo && !/^kit\b/i.test(y.nome) && y.custo >= x.custo * 0.05
      && similaridade(x.nome, y.nome) >= 0.25 && tokens(y.nome).some((t) => tk.has(t) && t.length > 3))
    let melhor = null
    for (let i = 0; i < pecas.length; i++) for (let j = i + 1; j < pecas.length; j++) {
      const combos = [[pecas[i], pecas[j]], ...pecas.slice(j + 1).map((k) => [pecas[i], pecas[j], k])]
      for (const c of combos) {
        const soma = c.reduce((s2, y) => s2 + y.custo, 0)
        if (Math.abs(soma - x.custo) / x.custo >= 0.015) continue
        const nota = c.reduce((s2, y) => s2 + similaridade(x.nome, y.nome), 0) / c.length
        if (!melhor || nota > melhor.nota) melhor = { c, nota }
      }
    }
    if (melhor) {
      x.tipo = 'kit'
      kits.push({ kit: x.sku, componentes: melhor.c.map((y) => ({ sku: y.sku, quantidade: 1 })), motivo: `custo ${x.custo.toFixed(2)} = soma das peças` })
      p('aviso', 'Kits', null, `${x.sku} “${x.nome}” virou kit de ${melhor.c.map((y) => y.sku).join(' + ')} (o custo bate). Confira.`)
    } else p('info', 'Kits', null, `${x.sku} “${x.nome}” tem “Kit” no nome mas não achei as peças: fica como peça. Se for kit, monte a lista de peças em Produtos.`)
  }

  // ---------------------------------------------------------------- Estoque Escola
  function adicionarEstoque(e) {
    const prod = produtos.get(e.sku)
    const kit = prod?.tipo === 'kit' && kits.find((k) => k.kit === e.sku)
    if (!kit) { estoque.push(e); return }
    for (const c of kit.componentes) {
      estoque.push({ ...e, sku: c.sku, quantidade: e.quantidade * c.quantidade, origem: `${e.origem} → kit ${e.sku} desmontado em peças` })
    }
  }
  const escola = acharAba(abas, 'Estoque Escola')
  if (escola) {
    escola.linhas.forEach((l, k) => {
      const linha = k + 1
      const q = num(l[0]); const desc = texto(l[1])
      if (!desc || q === null) return
      const nome = desc.replace(/^\d+\s*/, '').replace(/\(.*?\)/g, '').trim()
      const sku = porNome(nome, 'Estoque Escola', linha)
      if (!sku || sku === '__ignorar') { if (!sku) naoRec(nome, 'Estoque Escola', linha); return }
      adicionarEstoque({ sku, local: 'Estoque Escola', quantidade: q, localizacao: '', origem: `Estoque Escola linha ${linha}: “${desc}”`, revisar: true })
    })
    p('info', 'Estoque Escola', null, 'Os nomes da aba Estoque Escola são livres: confira cada associação na tabela de estoque. Os valores (R$) dessa aba não são importados — o app calcula o valor pelo custo médio.')
  }

  // ---------------------------------------------------------------- Pedidos (compras históricas)
  const compras = []
  const ped = acharAba(abas, 'Pedidos')
  if (ped) {
    const h = acharLinhaCab(ped.linhas, ['cod', 'data', 'produto'])
    const cab = ped.linhas[h] || []
    const c = { cod: col(cab, 'cod'), data: col(cab, 'data'), prod: col(cab, 'produto'), local: col(cab, 'local'), qtd: col(cab, 'quant'), unit: col(cab, 'p. unit'), tot: col(cab, 'p. total produto'), totPed: col(cab, 'p. total') }
    let atual = null
    const assinaturas = new Map()
    ped.linhas.slice(h + 1).forEach((l, k) => {
      const linha = h + 2 + k
      const nome = texto(l[c.prod])
      const data = dt(l[c.data])
      if (!nome) { if (texto(l[c.unit]) === '-') p('info', 'Pedidos', linha, 'Linha com “-” ignorada.'); return }
      if (data) {
        atual = { numero: `PLAN-${texto(l[c.cod]) || linha}`, data, fornecedor: texto(l[c.local]) || 'Diversos', itens: [], total: num(l[c.totPed]), linha }
        compras.push(atual)
      } else if (!atual) { p('aviso', 'Pedidos', linha, `“${nome}” sem data e sem pedido anterior: ignorado.`); return }
      const q = num(l[c.qtd])
      const unit = num(l[c.unit]) ?? (num(l[c.tot]) && q ? num(l[c.tot]) / q : null)
      if (!q) { p('aviso', 'Pedidos', linha, `“${nome}” sem quantidade: ignorado.`); return }
      if (!unit) p('info', 'Pedidos', linha, `“${nome}” sem preço (brinde/anexo?) — entra com custo 0.`)
      const sku = porNome(nome, 'Pedidos', linha)
      if (!sku) naoRec(nome, 'Pedidos', linha)
      atual.itens.push({ sku: sku === '__ignorar' ? null : sku, nome, quantidade: q, custo_unitario: unit || 0, linha })
    })
    let ultimaData = null
    for (const cp of compras) {
      const ass = `${cp.data.toISOString().slice(0, 10)}|${cp.itens.map((i) => `${i.nome}:${i.quantidade}:${i.custo_unitario.toFixed(2)}`).join(';')}`
      if (assinaturas.has(ass)) p('aviso', 'Pedidos', cp.linha, `Possível pedido duplicado: igual ao da linha ${assinaturas.get(ass)} (mesma data, itens e valores).`)
      else assinaturas.set(ass, cp.linha)
      if (ultimaData && cp.data < ultimaData - 200 * 864e5) p('info', 'Pedidos', cp.linha, `Data ${cp.data.toLocaleDateString('pt-BR')} bem anterior à do pedido de cima — confira se o ano está certo.`)
      ultimaData = cp.data
      const soma = cp.itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0)
      if (cp.total && Math.abs(soma - cp.total) > Math.max(1, cp.total * 0.02)) p('info', 'Pedidos', cp.linha, `Total do pedido ${cp.total.toFixed(2)} ≠ soma dos itens ${soma.toFixed(2)}.`)
    }
  }

  // ---------------------------------------------------------------- Vendas (histórico)
  const vendas = []
  const contaDe = (mk) => {
    const n = normalizar(mk)
    if (/^(ml|mercado)/.test(n)) return opcoes.contaML || 'Mercado Livre 1'
    if (/^(shp|shopee)/.test(n)) return 'Shopee 1'
    if (/^amazon|^amz/.test(n)) return 'Amazon 1'
    return null
  }
  function lerVendas(aba, prefixo) {
    const h = acharLinhaCab(aba.linhas, ['cod', 'sku', 'produto'])
    if (h < 0) return
    const cab = aba.linhas[h]
    const c = { cod: col(cab, 'cod'), data: col(cab, 'data'), mk: col(cab, 'mkp', 'mkplace'), sku: col(cab, 'sku'), prod: col(cab, 'produto'), qtd: col(cab, 'quant'), unit: col(cab, 'p. unit'), custo: col(cab, 'custo aquisicao', 'custo produto'), plat: col(cab, 'custo plataforma'), frete: col(cab, 'custo frete') }
    let invalidas = 0
    aba.linhas.slice(h + 1).forEach((l, k) => {
      const linha = h + 2 + k
      const data = dt(l[c.data]); const skuPl = limparSku(l[c.sku]); const nome = texto(l[c.prod])
      if (!data || invalido(l[c.sku]) || (!skuPl && !nome)) { if (texto(l[c.cod]) && (invalido(l[c.sku]) || !data)) invalidas++; return }
      const conta = contaDe(l[c.mk])
      if (!conta) { p('aviso', aba.nome, linha, `Marketplace “${texto(l[c.mk])}” não reconhecido: venda ignorada.`); return }
      let sku = produtos.has(skuPl) ? skuPl : null
      const pn = nome ? porNome(nome, aba.nome, linha, false) : null
      if (sku && pn && pn !== sku && pn !== '__ignorar') {
        p('aviso', aba.nome, linha, `SKU ${sku} (“${produtos.get(sku).nome}”) não bate com o produto “${nome}” (${pn}). Usado ${pn}, pelo nome.`)
        sku = pn
      }
      if (!sku) sku = pn === '__ignorar' ? null : pn
      if (!sku) { naoRec(nome || skuPl, aba.nome, linha); return }
      const q = num(l[c.qtd]) || 1, unit = num(l[c.unit]) || 0
      const plat = num(l[c.plat])
      if (plat !== null && unit && plat > unit * q * 0.6) p('aviso', aba.nome, linha, `Custo de plataforma ${plat.toFixed(2)} é maior que 60% da venda (${(unit * q).toFixed(2)}). Confira.`)
      vendas.push({
        codigo: `${prefixo}-${texto(l[c.cod]) || linha}`, data, conta, linha, aba: aba.nome,
        itens: [{ sku, quantidade: q, preco_unitario: unit, custo_unitario: num(l[c.custo]) }],
        taxa: plat ?? null, frete: c.frete > -1 ? num(l[c.frete]) || 0 : 0,
      })
    })
    if (invalidas) p('info', aba.nome, null, `${invalidas} linha(s) vazias ou com #N/A ignoradas.`)
  }
  const vAtual = acharAba(abas, 'Vendas')
  if (vAtual) lerVendas(vAtual, 'PLAN-V')
  const vAnt = acharAba(abas, 'Vendas Antiga')
  if (vAnt && opcoes.incluirVendasAntigas !== false) lerVendas(vAnt, 'PLAN-VA')
  if (vendas.some((v) => v.conta === (opcoes.contaML || 'Mercado Livre 1'))) {
    p('info', 'Vendas', null, `A planilha não diz qual das contas do Mercado Livre fez cada venda: todas as vendas “ML” vão para “${opcoes.contaML || 'Mercado Livre 1'}” (dá para trocar acima).`)
  }

  for (const [, v] of naoReconhecidos) p('erro', 'Nomes', null, `Produto “${v.nome}” não reconhecido (${v.ocorrencias.slice(0, 3).join(', ')}${v.ocorrencias.length > 3 ? '…' : ''}). Escolha o SKU na tabela de nomes.`)

  for (const e of estoque) {
    if (e.ignorar || produtos.get(e.sku)?.tipo !== 'kit') continue
    e.ignorar = true
    if (e.quantidade) {
      const kit = kits.find((k) => k.kit === e.sku)
      for (const c of kit?.componentes || []) estoque.push({ ...e, ignorar: false, sku: c.sku, quantidade: e.quantidade * c.quantidade, origem: `${e.origem} → kit ${e.sku} desmontado em peças` })
      p('aviso', 'Estoque', null, `${e.sku} é kit: as ${e.quantidade} unidades da planilha viraram estoque das peças. Confira se não está contando duas vezes.`)
    }
  }
  // soma linhas repetidas (mesma peça e local)
  const somado = new Map()
  for (const e of estoque.filter((x) => !x.ignorar)) {
    const k = `${e.sku}|${e.local}`
    if (somado.has(k)) { const a = somado.get(k); a.quantidade += e.quantidade; a.origem += ` + ${e.origem}`; a.revisar = a.revisar || e.revisar }
    else somado.set(k, { ...e })
  }

  return {
    produtos: lista(), kits, novasPecas,
    estoque: [...somado.values()],
    compras, vendas,
    config: cfgSug,
    naoReconhecidos: [...naoReconhecidos.values()],
    problemas,
  }
}
