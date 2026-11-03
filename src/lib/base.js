// Dados usados por várias telas (contas, produtos, tarifas...).
import { supabase } from '../supabase'
import { ok } from './erros'

export async function carregarBase({ produtos = true, tarifas = false, config = false, locais = false, produtoConta = false } = {}) {
  const tarefas = {
    contas: supabase.from('contas').select('*').order('id'),
    produtos: produtos ? supabase.from('vw_produtos').select('*').order('sku') : null,
    tarifas: tarifas ? supabase.from('tarifas').select('*').order('vigente_desde', { ascending: false }) : null,
    config: config ? supabase.from('config_geral').select('*').eq('id', 1).maybeSingle() : null,
    locais: locais ? supabase.from('locais').select('*').order('id') : null,
    produtoConta: produtoConta ? supabase.from('produto_conta').select('*') : null,
  }
  const chaves = Object.keys(tarefas).filter((k) => tarefas[k])
  const res = await Promise.all(chaves.map((k) => tarefas[k]))
  const out = {}
  chaves.forEach((k, i) => (out[k] = ok(res[i])))
  return out
}

/** Busca todas as linhas (o Supabase devolve no máximo 1000 por vez). */
export async function buscarTudo(montarConsulta, tamanho = 1000) {
  const todos = []
  for (let de = 0; ; de += tamanho) {
    const lote = ok(await montarConsulta().range(de, de + tamanho - 1))
    todos.push(...lote)
    if (lote.length < tamanho) break
  }
  return todos
}

export const nomeProduto = (p) => (p ? `${p.sku} — ${p.nome}` : '')

/** Próximo SKU no padrão PREFIXO + número sequencial de 4 dígitos (ex.: FILTRO0031). */
export function proximoSku(prefixo, produtos) {
  const pre = prefixo.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const maior = produtos.reduce((m, p) => {
    const n = parseInt(String(p.sku).replace(/\s+/g, '').match(/(\d{1,4})$/)?.[1] || '0', 10)
    return Math.max(m, isNaN(n) ? 0 : n)
  }, 0)
  return `${pre}${String(maior + 1).padStart(4, '0')}`
}
