export const moeda = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const numero = (v, casas = 0) =>
  (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 3) })

export const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
export const dataHoraBR = (d) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : ''

/** "R$ 1.234,56" | "1,234.56" | "-12,5" | 12.5 -> número */
export function lerNumero(v) {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).replace(/[^\d,.\-]/g, '')
  if (!s) return 0
  const virg = s.lastIndexOf(','), ponto = s.lastIndexOf('.')
  if (virg > -1 && ponto > -1) {
    s = virg > ponto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (virg > -1) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (ponto > -1 && /^\-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // 1.234 = mil
  }
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

const MESES = { jan: 0, fev: 1, feb: 1, mar: 2, abr: 3, apr: 3, mai: 4, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, set: 8, sep: 8, out: 9, oct: 9, nov: 10, dez: 11, dec: 11 }

/** Aceita Date, serial do Excel, ISO, dd/mm/aaaa [hh:mm], "3 de novembro de 2026 14:30 hs.", "Nov 3, 2026" */
export function lerData(v) {
  if (!v) return null
  if (v instanceof Date) return isNaN(v) ? null : v
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000) + 3 * 3600 * 1000)
    return null
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) { const d = new Date(s); return isNaN(d) ? null : d }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return dataSP(ano, +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0))
  }
  m = s.toLowerCase().match(/(\d{1,2})\s+(?:de\s+)?([a-zç]{3})[a-zç]*\.?\s+(?:de\s+)?(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/)
  if (m && m[2] in MESES) return dataSP(+m[3], MESES[m[2]], +m[1], +(m[4] || 12), +(m[5] || 0))
  m = s.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m && m[1] in MESES) return dataSP(+m[3], MESES[m[1]], +m[2], 12, 0)
  const d = new Date(s)
  return isNaN(d) ? null : d
}

// Datas sem fuso nas planilhas são horário de Brasília (UTC-3)
function dataSP(ano, mes, dia, h, min) {
  return new Date(Date.UTC(ano, mes, dia, h + 3, min))
}

export const hojeISO = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

/** remove acentos, minúsculas, espaços simples */
export const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const CATEGORIAS = { cafe: 'Café', queijo: 'Queijo', outro: 'Outro' }
export const MOTIVOS = {
  perda: 'Perda', vencimento: 'Vencimento', inventario: 'Inventário (contagem)', avaria: 'Avaria / quebra',
  consumo: 'Consumo / amostra', outro: 'Outro',
}
