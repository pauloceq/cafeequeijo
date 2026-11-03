// Cálculos de precificação (mesma lógica do banco, para a tela responder na hora).
//
// Lucro = PV − comissão%·PV − tarifa fixa − custo da faixa (frete/fixo ML) − ADS%·PV − imposto%·PV
//         − custo do produto − embalagem − custos indiretos
// PV para margem M:  PV = (custo + fixos + faixa) / (1 − comissão% − ADS% − imposto% − M%)
// Como a faixa depende do próprio preço, testamos cada faixa e ficamos com o menor preço coerente.

export function tarifaVigente(tarifas, contaId, data = new Date()) {
  const d = (data instanceof Date ? data : new Date(data)).toISOString().slice(0, 10)
  return (tarifas || [])
    .filter((t) => t.conta_id === contaId && t.vigente_desde <= d)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0] || null
}

export function valorFaixa(faixas, preco) {
  const f = (faixas || [])
    .filter((x) => preco >= (Number(x.de) || 0) && (x.ate === null || x.ate === undefined || x.ate === '' || preco <= Number(x.ate) + 0.004))
    .sort((a, b) => (Number(b.de) || 0) - (Number(a.de) || 0))[0]
  return f ? Number(f.valor) || 0 : 0
}

/** Parâmetros efetivos de um produto numa conta. */
export function parametros({ produto, conta, tarifa, config, pc }) {
  return {
    custo: Number(produto.custo ?? produto.custo_medio) || 0,
    comissaoPct: pc?.comissao_pct ?? tarifa?.comissao_pct ?? 0,
    tarifaFixa: Number(tarifa?.tarifa_fixa) || 0,
    faixas: tarifa?.faixas || [],
    adsPct: pc?.ads_pct ?? config?.ads_pct ?? 0,
    impostoPct: config?.imposto_pct ?? 0,
    fixos: (produto.custo_embalagem ?? config?.embalagem ?? 0) * 1 + (Number(config?.custos_indiretos) || 0),
    margemPct: produto.margem_alvo_pct ?? config?.margem_alvo_pct ?? 0,
    conta,
  }
}

export function calcular(preco, p) {
  preco = Number(preco) || 0
  const comissao = (preco * p.comissaoPct) / 100
  const faixa = valorFaixa(p.faixas, preco)
  const ads = (preco * p.adsPct) / 100
  const imposto = (preco * p.impostoPct) / 100
  const tarifas = comissao + p.tarifaFixa + faixa
  const lucro = preco - tarifas - ads - imposto - p.custo - p.fixos
  return {
    preco, comissao, tarifaFixa: p.tarifaFixa, faixa, ads, imposto, tarifas,
    liquido: preco - tarifas,
    lucro,
    margem: preco > 0 ? (lucro / preco) * 100 : 0,
    roi: p.custo > 0 ? (lucro / p.custo) * 100 : 0,
  }
}

function faixasOuUnica(faixas) {
  const lista = (faixas || []).map((f) => ({ de: Number(f.de) || 0, ate: f.ate === null || f.ate === '' || f.ate === undefined ? Infinity : Number(f.ate), valor: Number(f.valor) || 0 }))
  return lista.length ? lista.sort((a, b) => a.de - b.de) : [{ de: 0, ate: Infinity, valor: 0 }]
}

/** Menor preço que atinge a margem desejada (null = impossível com esses percentuais). */
export function precoParaMargem(p, margemPct = p.margemPct) {
  const div = 1 - (p.comissaoPct + p.adsPct + p.impostoPct + Number(margemPct)) / 100
  if (div <= 0) return null
  const candidatos = []
  for (const f of faixasOuUnica(p.faixas)) {
    const pv = (p.custo + p.fixos + p.tarifaFixa + f.valor) / div
    if (pv >= f.de && pv <= f.ate + 0.004) candidatos.push(pv)
    else if (pv < f.de) candidatos.push(f.de) // no começo da faixa a margem já passa do alvo
  }
  if (!candidatos.length) return null
  return Math.ceil(Math.min(...candidatos) * 100) / 100
}

/** Arredonda para cima terminando em ,90 (ex.: 57,23 -> 57,90), sem cair numa margem menor que a desejada. */
export function arredondar90(preco, p, margemPct = p.margemPct) {
  if (!preco) return preco
  const r = Math.floor(preco) + 0.9 >= preco ? Math.floor(preco) + 0.9 : Math.floor(preco) + 1.9
  return calcular(r, p).margem + 0.001 >= margemPct ? Math.round(r * 100) / 100 : preco
}

export function analisar(precoAtual, p) {
  const minimo = precoParaMargem(p, 0)
  const sugeridoBruto = precoParaMargem(p)
  const sugerido = sugeridoBruto ? arredondar90(sugeridoBruto, p) : null
  const atual = precoAtual ? calcular(precoAtual, p) : null
  let alerta = null
  if (atual && minimo && precoAtual < minimo - 0.004) alerta = 'abaixo_minimo'
  else if (atual && atual.margem < p.margemPct - 0.05) alerta = 'abaixo_alvo'
  return { minimo, sugerido, atual, alvo: sugerido ? calcular(sugerido, p) : null, alerta }
}
