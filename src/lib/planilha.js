import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/browser'
import JSZip from 'jszip'
import { normalizar } from './formato'

const ext = (nome) => (nome.split('.').pop() || '').toLowerCase()

function decodificar(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf) // arquivos antigos do Excel/Amazon
  }
}

/** Lê .xlsx/.csv/.txt/.tsv e devolve [{ nome, linhas: [[...], ...] }] (uma entrada por aba). */
export async function lerArquivo(arquivo) {
  const e = ext(arquivo.name)
  if (e === 'xls') {
    throw new Error('Arquivo .xls (Excel antigo) não é suportado. Abra no Excel ou Google Planilhas e salve como .xlsx ou .csv.')
  }
  if (e === 'xlsx' || e === 'xlsm') {
    try {
      const abas = await readXlsxFile(arquivo)
      return abas.map((a) => ({ nome: a.sheet, linhas: a.data.map((l) => l.map((c) => (c === null ? '' : c))) }))
    } catch (err) {
      throw new Error(`Não consegui abrir a planilha (${err.message}). Se o site baixou um arquivo protegido, abra no Excel e salve novamente como .xlsx.`)
    }
  }
  if (['csv', 'txt', 'tsv'].includes(e)) {
    const texto = decodificar(await arquivo.arrayBuffer())
    const r = Papa.parse(texto, { skipEmptyLines: 'greedy', delimiter: '' })
    return [{ nome: arquivo.name, linhas: r.data }]
  }
  throw new Error(`Formato .${e} não suportado. Use .xlsx, .csv ou .txt.`)
}

/** Procura a linha de cabeçalho: a que tem mais células parecidas com os nomes esperados. */
export function acharCabecalho(linhas, nomesEsperados) {
  const alvo = nomesEsperados.map(normalizar)
  let melhor = { indice: 0, pontos: -1 }
  linhas.slice(0, 40).forEach((linha, i) => {
    const celulas = linha.map((c) => normalizar(c))
    const pontos = alvo.filter((a) => celulas.some((c) => c && (c === a || c.startsWith(a)))).length
    if (pontos > melhor.pontos) melhor = { indice: i, pontos }
  })
  return melhor
}

/** Escolhe a coluna que corresponde a uma lista de apelidos (exato > começa com > contém). */
export function acharColuna(cabecalho, apelidos = []) {
  const cab = cabecalho.map((c) => normalizar(c))
  for (const modo of ['exato', 'comeca', 'contem']) {
    for (const ap of apelidos.map(normalizar)) {
      const i = cab.findIndex((c) =>
        c && (modo === 'exato' ? c === ap : modo === 'comeca' ? c.startsWith(ap) : c.includes(ap)))
      if (i > -1) return i
    }
  }
  return -1
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------
export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** CSV com ";" e BOM — abre certinho no Excel em português. */
export function gerarCSV(cabecalho, linhas, sep = ';') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n\r\t,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const corpo = [cabecalho, ...linhas].map((l) => l.map(esc).join(sep)).join('\r\n')
  return new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' })
}

export function gerarTXT(cabecalho, linhas) {
  const corpo = [cabecalho, ...linhas].map((l) => l.map((v) => String(v ?? '').replace(/[\t\r\n]/g, ' ')).join('\t')).join('\r\n')
  return new Blob([corpo], { type: 'text/plain;charset=utf-8' })
}

// ---------------------------------------------------------------------------
// Preencher um modelo .xlsx baixado do site, sem mexer no resto do arquivo
// (abas ocultas, validações e proteções do marketplace continuam intactas).
// ---------------------------------------------------------------------------
const letraParaIndice = (l) => [...l].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
export const indiceParaLetra = (i) => {
  let s = ''
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

export async function abrirModeloXlsx(arquivo) {
  if (ext(arquivo.name) !== 'xlsx') {
    throw new Error('Para preencher o modelo do site, envie o arquivo .xlsx exatamente como o site baixou.')
  }
  const zip = await JSZip.loadAsync(await arquivo.arrayBuffer())
  const parser = new DOMParser()
  const lerXml = async (caminho) => {
    const f = zip.file(caminho)
    return f ? parser.parseFromString(await f.async('string'), 'application/xml') : null
  }
  const wb = await lerXml('xl/workbook.xml')
  const rels = await lerXml('xl/_rels/workbook.xml.rels')
  if (!wb || !rels) throw new Error('Este arquivo não parece ser uma planilha .xlsx válida.')

  const compartilhadas = []
  const ss = await lerXml('xl/sharedStrings.xml')
  if (ss) {
    for (const si of ss.getElementsByTagName('si')) {
      compartilhadas.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''))
    }
  }
  const alvoPorId = {}
  for (const r of rels.getElementsByTagName('Relationship')) alvoPorId[r.getAttribute('Id')] = r.getAttribute('Target')

  const abas = []
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    let alvo = alvoPorId[rid] || ''
    alvo = alvo.startsWith('/') ? alvo.slice(1) : 'xl/' + alvo.replace(/^\.\//, '')
    const doc = await lerXml(alvo)
    if (!doc) continue
    const linhas = []
    for (const row of doc.getElementsByTagName('row')) {
      const r = +row.getAttribute('r') - 1
      const arr = []
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || ''
        const col = letraParaIndice(ref.replace(/\d+/g, ''))
        const t = c.getAttribute('t')
        const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
        arr[col] = t === 's' ? compartilhadas[+v] ?? ''
          : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v
      }
      linhas[r] = Array.from(arr, (x) => x ?? '')
    }
    abas.push({ nome: s.getAttribute('name'), caminho: alvo, doc, linhas: Array.from(linhas, (x) => x ?? []) })
  }
  return { zip, abas }
}

/** escritas: [{ linha (0-based), coluna (0-based), valor (número) }] */
export async function salvarModeloXlsx(modelo, aba, escritas, nomeArquivo) {
  const doc = aba.doc
  const ns = doc.documentElement.namespaceURI
  const sheetData = doc.getElementsByTagName('sheetData')[0]
  const linhasXml = {}
  for (const row of sheetData.getElementsByTagName('row')) linhasXml[+row.getAttribute('r')] = row

  for (const { linha, coluna, valor } of escritas) {
    const rNum = linha + 1
    const ref = indiceParaLetra(coluna) + rNum
    let row = linhasXml[rNum]
    if (!row) {
      row = doc.createElementNS(ns, 'row')
      row.setAttribute('r', rNum)
      const depois = [...sheetData.getElementsByTagName('row')].find((x) => +x.getAttribute('r') > rNum)
      sheetData.insertBefore(row, depois || null)
      linhasXml[rNum] = row
    }
    let cel = [...row.getElementsByTagName('c')].find((c) => c.getAttribute('r') === ref)
    if (!cel) {
      cel = doc.createElementNS(ns, 'c')
      cel.setAttribute('r', ref)
      const depois = [...row.getElementsByTagName('c')].find(
        (c) => letraParaIndice((c.getAttribute('r') || '').replace(/\d+/g, '')) > coluna)
      row.insertBefore(cel, depois || null)
    }
    while (cel.firstChild) cel.removeChild(cel.firstChild)
    cel.removeAttribute('t')
    const v = doc.createElementNS(ns, 'v')
    v.textContent = String(valor)
    cel.appendChild(v)
  }
  modelo.zip.file(aba.caminho, new XMLSerializer().serializeToString(doc))
  // força o Excel a recalcular fórmulas ao abrir
  modelo.zip.remove('xl/calcChain.xml')
  const blob = await modelo.zip.generateAsync({
    type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  baixar(blob, nomeArquivo)
}
