import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Abas, Aviso, Barra, Carregando, Cartao, Pagina, useDados, Vazio } from '../components/ui'
import { buscarTudo } from '../lib/base'
import { hojeISO, moeda, numero } from '../lib/formato'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const mesesAtras = (n) => { const d = new Date(hojeISO() + 'T12:00'); d.setMonth(d.getMonth() - n, 1); return d.toISOString().slice(0, 10) }
// "AliExpress — Nome da loja (importado ...)" → "Nome da loja"
const lojaDe = (p) => (p.observacao || '').match(/—\s*([^(]+?)\s*(\(|$)/)?.[1] || p.fornecedores?.nome || 'Sem loja'

export default function AnaliseCompras() {
  const [f, setF] = useState({ de: mesesAtras(5), ate: hojeISO() })
  const [aba, setAba] = useState('produtos')
  const { dados, erro, carregando } = useDados(async () => {
    const [pedidos, itens] = await Promise.all([
      buscarTudo(() => supabase.from('pedidos_compra').select('id,data_pedido,status,observacao,frete,imposto_importacao,icms,iof,outras_despesas,total_original,fornecedores(nome)')
        .neq('status', 'cancelado').gte('data_pedido', f.de).lte('data_pedido', f.ate)),
      buscarTudo(() => supabase.from('pedido_compra_itens').select('pedido_id,produto_id,quantidade,custo_unitario,produtos(sku,nome),pedidos_compra!inner(data_pedido,status)')
        .neq('pedidos_compra.status', 'cancelado').gte('pedidos_compra.data_pedido', f.de).lte('pedidos_compra.data_pedido', f.ate)),
    ])
    return { pedidos, itens }
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
    return {
      total, unidades, pedidos: dados.pedidos.length,
      meses: Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)),
      produtos: Object.values(prods).map((x) => ({ ...x, pedidos: x.pedidos.size, medio: x.valor / x.qtd, variacao: x.primeiro ? (x.ultimo / x.primeiro - 1) * 100 : 0 })),
      lojas: Object.values(lojas).sort((a, b) => b.valor - a.valor),
    }
  }, [dados])

  const atalhos = [['3 meses', 2], ['6 meses', 5], ['12 meses', 11]]
  return (
    <Pagina titulo="Análise de compras" subtitulo="Quanto você gastou, o que mais comprou, de quem e como o custo de cada produto mudou. Valores com frete e impostos.">
      <div className="filtros">
        <label>De <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        {atalhos.map(([t, n]) => <button key={t} className="botao" onClick={() => setF({ de: mesesAtras(n), ate: hojeISO() })}>{t}</button>)}
        <button className="botao" onClick={() => setF({ de: hojeISO().slice(0, 4) + '-01-01', ate: hojeISO() })}>este ano</button>
      </div>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {r && (!r.pedidos ? <Vazio>Nenhuma compra no período.</Vazio> : (
        <>
          <div className="numeros">
            <div className="numero"><span>Total comprado</span><b>{moeda(r.total)}</b><small>{r.pedidos} pedido(s)</small></div>
            <div className="numero"><span>Unidades</span><b>{numero(r.unidades)}</b><small>{r.produtos.length} produto(s)</small></div>
            <div className="numero"><span>Ticket médio por pedido</span><b>{moeda(r.total / r.pedidos)}</b></div>
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

          <Abas abas={[['produtos', 'Produtos mais comprados'], ['valor', 'Maior gasto'], ['custo', 'Custo por unidade'], ['lojas', 'Lojas / fornecedores']]} ativa={aba} onTrocar={setAba} />
          {aba !== 'lojas' && (
            <div className="tabela-rolagem">
              <table className="tabela compacta">
                <thead><tr><th>Produto</th><th className="num">Unidades</th><th className="num">Pedidos</th><th className="num">Valor</th><th className="num">Custo médio</th><th className="num">Último custo</th><th className="num">Variação</th><th>Última compra</th></tr></thead>
                <tbody>
                  {[...r.produtos].sort((a, b) => aba === 'produtos' ? b.qtd - a.qtd : aba === 'valor' ? b.valor - a.valor : b.medio - a.medio).map((p) => (
                    <tr key={p.sku}>
                      <td>{p.nome}<div className="dica">{p.sku}</div></td>
                      <td className="num">{numero(p.qtd)}</td><td className="num">{p.pedidos}</td><td className="num">{moeda(p.valor)}</td>
                      <td className="num">{moeda(p.medio)}</td><td className="num">{moeda(p.ultimo)}</td>
                      <td className={`num ${p.variacao > 5 ? 'neg' : p.variacao < -5 ? 'pos' : ''}`}>{p.variacao > 0 ? '+' : ''}{numero(p.variacao, 1)}%</td>
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
                  <tr key={l.loja}><td>{l.loja}</td><td className="num">{l.pedidos}</td><td className="num">{moeda(l.valor)}</td><td className="num">{numero(l.valor / r.total * 100, 1)}%</td>
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
