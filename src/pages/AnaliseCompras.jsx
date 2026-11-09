import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Abas, Aviso, Barra, Carregando, Cartao, Pagina, useDados, Vazio } from '../components/ui'
import { buscarTudo } from '../lib/base'
import { hojeISO, moeda, numero, pct } from '../lib/formato'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const mesesAtras = (n) => { const d = new Date(hojeISO() + 'T12:00'); d.setMonth(d.getMonth() - n, 1); return d.toISOString().slice(0, 10) }
// "AliExpress — Nome da loja (importado ...)" → "Nome da loja"
const lojaDe = (p) => (p.observacao || '').match(/—\s*([^(]+?)\s*(\(|$)/)?.[1] || p.fornecedores?.nome || 'Sem loja'

export default function AnaliseCompras() {
  const [f, setF] = useState({ de: mesesAtras(5), ate: hojeISO() })
  const [aba, setAba] = useState('giro')
  const { dados, erro, carregando } = useDados(async () => {
    const [pedidos, itens, vendas, produtos] = await Promise.all([
      buscarTudo(() => supabase.from('pedidos_compra').select('id,data_pedido,status,observacao,frete,imposto_importacao,icms,iof,outras_despesas,total_original,fornecedores(nome)')
        .neq('status', 'cancelado').gte('data_pedido', f.de).lte('data_pedido', f.ate)),
      buscarTudo(() => supabase.from('pedido_compra_itens').select('pedido_id,produto_id,quantidade,custo_unitario,produtos(sku,nome),pedidos_compra!inner(data_pedido,status)')
        .neq('pedidos_compra.status', 'cancelado').gte('pedidos_compra.data_pedido', f.de).lte('pedidos_compra.data_pedido', f.ate)),
      buscarTudo(() => supabase.from('vw_vendas_pecas').select('peca_id,sku_vendido,conta_nome,quantidade,receita,custo,lucro')
        .eq('status', 'concluida').gte('data', `${f.de}T00:00:00-03:00`).lte('data', `${f.ate}T23:59:59-03:00`)),
      buscarTudo(() => supabase.from('produtos').select('id,sku,nome,tipo,estoque_real,custo_medio')),
    ])
    return { pedidos, itens, vendas, produtos }
  }, [f.de, f.ate])

  const r = useMemo(() => {
    if (!dados) return null
    const extras = (p) => ['frete', 'imposto_importacao', 'icms', 'iof', 'outras_despesas'].reduce((s, k) => s + Number(p[k] || 0), 0)
    const valorPedido = {}
    for (const i of dados.itens) valorPedido[i.pedido_id] = (valorPedido[i.pedido_id] || 0) + i.quantidade * i.custo_unitario
    for (const p of dados.pedidos) valorPedido[p.id] = (valorPedido[p.id] || 0) + extras(p)
    const total = dados.pedidos.reduce((s, p) => s + (valorPedido[p.id] || 0), 0)
    const unidades = dados.itens.reduce((s, i) => s + Number(i.quantidade), 0)

    const meses = {}
    for (const p of dados.pedidos) {
      const m = (meses[p.data_pedido.slice(0, 7)] ||= { mes: p.data_pedido.slice(0, 7), valor: 0, pedidos: 0, unidades: 0 })
      m.valor += valorPedido[p.id] || 0; m.pedidos++
    }
    for (const i of dados.itens) meses[i.pedidos_compra.data_pedido.slice(0, 7)].unidades += Number(i.quantidade)

    const prods = {}
    for (const i of [...dados.itens].sort((a, b) => a.pedidos_compra.data_pedido.localeCompare(b.pedidos_compra.data_pedido))) {
      const x = (prods[i.produto_id] ||= { sku: i.produtos?.sku, nome: i.produtos?.nome, qtd: 0, valor: 0, pedidos: new Set(), primeiro: null, ultimo: null, ultimaData: null })
      x.qtd += Number(i.quantidade); x.valor += i.quantidade * i.custo_unitario; x.pedidos.add(i.pedido_id)
      if (x.primeiro === null) x.primeiro = Number(i.custo_unitario)
      x.ultimo = Number(i.custo_unitario); x.ultimaData = i.pedidos_compra.data_pedido
    }
    const lojas = {}
    for (const p of dados.pedidos) {
      const l = (lojas[lojaDe(p)] ||= { loja: lojaDe(p), valor: 0, pedidos: 0 })
      l.valor += valorPedido[p.id] || 0; l.pedidos++
    }
    const dias = Math.max(1, (new Date(f.ate) - new Date(f.de)) / 864e5 + 1)
    const giro = {}
    const base = (id) => {
      const p = dados.produtos.find((x) => x.id === id) || {}
      return (giro[id] ||= { id, sku: p.sku, nome: p.nome, estoque: Number(p.estoque_real) || 0, custoMedio: Number(p.custo_medio) || 0,
        vendidas: 0, receita: 0, custo: 0, lucro: 0, compradas: 0, gasto: 0, skus: {}, contas: {} })
    }
    for (const v of dados.vendas) {
      const g = base(v.peca_id)
      g.vendidas += Number(v.quantidade); g.receita += Number(v.receita); g.custo += Number(v.custo); g.lucro += Number(v.lucro)
      g.skus[v.sku_vendido] = (g.skus[v.sku_vendido] || 0) + Number(v.quantidade)
      g.contas[v.conta_nome] = (g.contas[v.conta_nome] || 0) + Number(v.quantidade)
    }
    // compras: kits comprados entram nas peças
    for (const i of dados.itens) {
      const prod = dados.produtos.find((x) => x.id === i.produto_id)
      const g = base(i.produto_id)
      if (prod?.tipo !== 'kit') { g.compradas += Number(i.quantidade); g.gasto += i.quantidade * i.custo_unitario }
    }
    const giroLista = Object.values(giro).filter((g) => g.vendidas || g.compradas).map((g) => {
      const porDia = g.vendidas / dias
      return { ...g, margem: g.receita ? g.lucro / g.receita * 100 : 0, porMes: porDia * 30, cobertura: porDia > 0 ? g.estoque / porDia : null }
    })
    return {
      giro: giroLista, dias,
      total, unidades, pedidos: dados.pedidos.length,
      meses: Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)),
      produtos: Object.values(prods).map((x) => ({ ...x, pedidos: x.pedidos.size, medio: x.valor / x.qtd, variacao: x.primeiro ? (x.ultimo / x.primeiro - 1) * 100 : 0 })),
      lojas: Object.values(lojas).sort((a, b) => b.valor - a.valor),
    }
  }, [dados])

  const atalhos = [['3 meses', 2], ['6 meses', 5], ['12 meses', 11]]
  return (
    <Pagina titulo="Análise de compras e giro" subtitulo="O que mais vende e dá lucro, quanto você comprou, quanto dura o estoque e como o custo mudou. SKUs diferentes do mesmo produto são somados. Valores com frete e impostos.">
      <div className="filtros">
        <label>De <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        {atalhos.map(([t, n]) => <button key={t} className="botao" onClick={() => setF({ de: mesesAtras(n), ate: hojeISO() })}>{t}</button>)}
        <button className="botao" onClick={() => setF({ de: hojeISO().slice(0, 4) + '-01-01', ate: hojeISO() })}>este ano</button>
      </div>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {r && (!r.pedidos && !r.giro.length ? <Vazio>Nenhuma compra ou venda no período.</Vazio> : (
        <>
          <div className="numeros">
            <div className="numero"><span>Total comprado</span><b>{moeda(r.total)}</b><small>{r.pedidos} pedido(s)</small></div>
            <div className="numero"><span>Unidades</span><b>{numero(r.unidades)}</b><small>{r.produtos.length} produto(s)</small></div>
            <div className="numero"><span>Ticket médio por pedido</span><b>{moeda(r.pedidos ? r.total / r.pedidos : 0)}</b></div>
            <div className="numero"><span>Média por mês</span><b>{moeda(r.total / Math.max(1, r.meses.length))}</b><small>{r.meses.length} mês(es) com compra</small></div>
          </div>

          <Cartao titulo="Por mês">
            <table className="tabela compacta">
              <thead><tr><th>Mês</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Valor</th><th style={{ width: '40%' }} /></tr></thead>
              <tbody>
                {r.meses.map((m) => (
                  <tr key={m.mes}><td>{rotuloMes(m.mes)}</td><td className="num">{m.pedidos}</td><td className="num">{numero(m.unidades)}</td><td className="num">{moeda(m.valor)}</td>
                    <td><Barra valor={m.valor} max={Math.max(...r.meses.map((x) => x.valor))} /></td></tr>
                ))}
              </tbody>
            </table>
          </Cartao>

          <Abas abas={[['giro', 'Giro: vendas × compras'], ['produtos', 'Produtos mais comprados'], ['valor', 'Maior gasto'], ['custo', 'Custo por unidade'], ['lojas', 'Lojas / fornecedores']]} ativa={aba} onTrocar={setAba} />
          {aba === 'giro' && <Giro r={r} />}
          {!['lojas', 'giro'].includes(aba) && (
            <div className="tabela-rolagem">
              <table className="tabela compacta">
                <thead><tr><th>Produto</th><th className="num">Unidades</th><th className="num">Pedidos</th><th className="num">Valor</th><th className="num">Custo médio</th><th className="num">Último custo</th><th className="num">Variação</th><th>Última compra</th></tr></thead>
                <tbody>
                  {[...r.produtos].sort((a, b) => aba === 'produtos' ? b.qtd - a.qtd : aba === 'valor' ? b.valor - a.valor : b.medio - a.medio).map((p) => (
                    <tr key={p.sku}>
                      <td>{p.nome}<div className="dica">{p.sku}</div></td>
                      <td className="num">{numero(p.qtd)}</td><td className="num">{p.pedidos}</td><td className="num">{moeda(p.valor)}</td>
                      <td className="num">{moeda(p.medio)}</td><td className="num">{moeda(p.ultimo)}</td>
                      <td className={`num ${p.variacao > 5 ? 'neg' : p.variacao < -5 ? 'pos' : ''}`}>{p.variacao > 0 ? '+' : ''}{pct(p.variacao)}</td>
                      <td>{p.ultimaData?.split('-').reverse().join('/')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dica">Variação = último custo comparado ao primeiro do período (vermelho: subiu mais de 5%).</p>
            </div>
          )}
          {aba === 'lojas' && (
            <table className="tabela compacta">
              <thead><tr><th>Loja</th><th className="num">Pedidos</th><th className="num">Valor</th><th className="num">% do total</th><th style={{ width: '30%' }} /></tr></thead>
              <tbody>
                {r.lojas.map((l) => (
                  <tr key={l.loja}><td>{l.loja}</td><td className="num">{l.pedidos}</td><td className="num">{moeda(l.valor)}</td><td className="num">{pct(r.total ? l.valor / r.total * 100 : 0)}</td>
                    <td><Barra valor={l.valor} max={r.lojas[0].valor} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ))}
    </Pagina>
  )
}

function Giro({ r }) {
  const [ordem, setOrdem] = useState('vendidas')
  const lista = [...r.giro].sort((a, b) => ordem === 'cobertura' ? (a.cobertura ?? 1e9) - (b.cobertura ?? 1e9) : b[ordem] - a[ordem])
  const max = Math.max(1, ...lista.map((g) => g.vendidas))
  return (
    <>
      <div className="filtros">
        <label>Ordenar por <select value={ordem} onChange={(e) => setOrdem(e.target.value)}>
          <option value="vendidas">Mais vendidos</option><option value="receita">Maior faturamento</option><option value="lucro">Maior lucro</option>
          <option value="margem">Maior margem</option><option value="cobertura">Estoque acabando antes</option><option value="compradas">Mais comprados</option>
        </select></label>
      </div>
      <div className="tabela-rolagem">
        <table className="tabela compacta">
          <thead><tr><th>Produto comprado</th><th className="num">Vendidas</th><th style={{ width: '12%' }} /><th className="num">Faturamento</th><th className="num">Lucro</th><th className="num">Margem</th>
            <th className="num">Compradas</th><th className="num">Custo médio</th><th className="num">Estoque</th><th className="num">Vendas/mês</th><th className="num">Dura</th></tr></thead>
          <tbody>
            {lista.map((g) => (
              <tr key={g.id}>
                <td>{g.nome}<div className="dica">{g.sku}{Object.keys(g.skus).length > 1 || (Object.keys(g.skus)[0] && Object.keys(g.skus)[0] !== g.sku)
                  ? ' · vendido como ' + Object.entries(g.skus).sort((a, b) => b[1] - a[1]).map(([s, q]) => `${s} (${numero(q)})`).join(', ') : ''}</div>
                  <div className="dica">{Object.entries(g.contas).sort((a, b) => b[1] - a[1]).map(([c, q]) => `${c}: ${numero(q)}`).join(' · ')}</div></td>
                <td className="num"><b>{numero(g.vendidas)}</b></td><td><Barra valor={g.vendidas} max={max} /></td>
                <td className="num">{moeda(g.receita)}</td><td className={`num ${g.lucro < 0 ? 'neg' : ''}`}>{moeda(g.lucro)}</td><td className="num">{pct(g.margem)}</td>
                <td className="num">{numero(g.compradas)}</td><td className="num">{moeda(g.custoMedio)}</td>
                <td className="num">{numero(g.estoque)}</td><td className="num">{numero(g.porMes, 1)}</td>
                <td className={`num ${g.cobertura !== null && g.cobertura < 30 ? 'neg' : ''}`}>{g.cobertura === null ? '—' : `${Math.round(g.cobertura)} d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dica">Tudo somado pelo produto comprado no AliExpress: kits (ex.: 1, 2 ou 3 cápsulas) e SKUs diferentes que usam a mesma peça entram juntos. “Dura” = estoque atual ÷ ritmo de vendas do período (vermelho: menos de 30 dias).</p>
    </>
  )
}
