import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Abas, Aviso, Barra, Carregando, Pagina, Selo, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { buscarTudo, carregarBase } from '../lib/base'
import { baixar, gerarCSV } from '../lib/planilha'
import { dataBR, hojeISO, moeda, numero, pct } from '../lib/formato'

const somar = (l, k) => l.reduce((s, x) => s + Number(x[k] || 0), 0)

function agrupar(itens, chave, nome) {
  const m = new Map()
  for (const i of itens) {
    const k = chave(i)
    if (!m.has(k)) m.set(k, { chave: k, nome: nome(i), qtd: 0, receita: 0, taxa: 0, frete: 0, outros: 0, custo: 0, lucro: 0, lucro_planejado: 0, vendas: new Set() })
    const g = m.get(k)
    g.qtd += Number(i.quantidade); g.receita += Number(i.receita); g.taxa += Number(i.taxa); g.frete += Number(i.frete)
    g.outros += Number(i.custos_venda) + Number(i.ads_impostos); g.custo += Number(i.custo); g.lucro += Number(i.lucro)
    g.lucro_planejado += Number(i.lucro_planejado); g.vendas.add(i.venda_id)
  }
  return [...m.values()].map((g) => ({ ...g, nVendas: g.vendas.size, margem: g.receita ? (g.lucro / g.receita) * 100 : 0 }))
}

function TabelaResultado({ linhas, rotulo, extra }) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela">
        <thead><tr><th>{rotulo}</th><th className="num">Vendas</th><th className="num">Unid.</th><th className="num">Faturamento</th><th className="num">Tarifas</th><th className="num">Frete</th><th className="num">Emb./ADS/imp.</th><th className="num">Custo produto</th><th className="num">Lucro</th><th className="num">Margem</th>{extra && <th />}</tr></thead>
        <tbody>
          {linhas.map((g) => (
            <tr key={g.chave}>
              <td>{g.nome}</td><td className="num">{g.nVendas}</td><td className="num">{numero(g.qtd)}</td><td className="num">{moeda(g.receita)}</td>
              <td className="num">{moeda(g.taxa)}</td><td className="num">{moeda(g.frete)}</td><td className="num">{moeda(g.outros)}</td><td className="num">{moeda(g.custo)}</td>
              <td className={`num ${g.lucro < 0 ? 'neg' : ''}`}><b>{moeda(g.lucro)}</b></td><td className="num">{pct(g.margem)}</td>{extra && <td>{extra(g)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Relatorios() {
  const [aba, setAba] = useState('resumo')
  const [f, setF] = useState({ de: hojeISO().slice(0, 8) + '01', ate: hojeISO(), conta: '' })
  const base = useDados(() => carregarBase({ config: true }))
  const { dados, erro, carregando } = useDados(async () => {
    const filtro = (q) => {
      q = q.gte('data', `${f.de}T00:00:00-03:00`).lte('data', `${f.ate}T23:59:59-03:00`)
      return f.conta ? q.eq('conta_id', Number(f.conta)) : q
    }
    const [itens, perdidas, consumo] = await Promise.all([
      buscarTudo(() => filtro(supabase.from('vw_vendas_itens').select('*').eq('status', 'concluida'))),
      buscarTudo(() => filtro(supabase.from('vw_vendas_itens').select('venda_id,produto_id,sku,produto_nome,quantidade,receita,status,conta_nome').in('status', ['devolvida', 'cancelada']))),
      supabase.from('vw_consumo_pecas').select('*').then(ok),
    ])
    return { itens, perdidas, consumo }
  }, [f])

  const r = useMemo(() => {
    if (!dados) return null
    const it = dados.itens
    const tot = { receita: somar(it, 'receita'), taxa: somar(it, 'taxa'), frete: somar(it, 'frete'), outros: somar(it, 'custos_venda') + somar(it, 'ads_impostos'), custo: somar(it, 'custo'), lucro: somar(it, 'lucro'), planejado: somar(it, 'lucro_planejado'), vendas: new Set(it.map((i) => i.venda_id)).size }
    const porConta = agrupar(it, (i) => i.conta_id, (i) => i.conta_nome).sort((a, b) => b.receita - a.receita)
    const porProduto = agrupar(it, (i) => i.produto_id, (i) => `${i.sku} — ${i.produto_nome}`).sort((a, b) => b.receita - a.receita)
    const porMes = agrupar(it, (i) => String(i.data).slice(0, 7), (i) => String(i.data).slice(0, 7)).sort((a, b) => a.chave.localeCompare(b.chave))
    let acum = 0
    const abc = porProduto.map((g) => { acum += g.receita; const p = tot.receita ? (acum / tot.receita) * 100 : 0; return { ...g, acum: p, classe: p <= 80 ? 'A' : p <= 95 ? 'B' : 'C' } })
    // corrige: o item que cruza 80% ainda é A
    for (let i = 0; i < abc.length; i++) { const antes = i ? abc[i - 1].acum : 0; abc[i].classe = antes < 80 ? 'A' : antes < 95 ? 'B' : 'C' }
    return { tot, porConta, porProduto, porMes, abc }
  }, [dados])

  if (base.carregando) return <Pagina titulo="Relatórios"><Carregando /></Pagina>

  const exportar = (nome, cab, linhas) => baixar(gerarCSV(cab, linhas), `${nome}-${f.de}-a-${f.ate}.csv`)
  const csvGrupo = (l) => l.map((g) => [g.nome, g.nVendas, g.qtd, g.receita.toFixed(2), g.taxa.toFixed(2), g.frete.toFixed(2), g.outros.toFixed(2), g.custo.toFixed(2), g.lucro.toFixed(2), g.margem.toFixed(1)].map((x) => String(x).replace('.', ',')))
  const CAB = ['Nome', 'Vendas', 'Unidades', 'Faturamento', 'Tarifas', 'Frete', 'Emb/ADS/Imp', 'Custo', 'Lucro', 'Margem %']

  return (
    <Pagina titulo="Relatórios">
      <div className="filtros">
        <label>De <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        <select value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })}>
          <option value="">Todas as contas</option>{base.dados?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <button className="link" onClick={() => setF({ ...f, de: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), ate: hojeISO() })}>últimos 30 dias</button>
        <button className="link" onClick={() => setF({ ...f, de: hojeISO().slice(0, 4) + '-01-01', ate: hojeISO() })}>este ano</button>
      </div>
      <Abas abas={[['resumo', 'Resumo'], ['produtos', 'Por produto'], ['abc', 'Curva ABC'], ['parados', 'Produtos parados'], ['planejado', 'Real × planejado'], ['devolucoes', 'Devoluções']]} ativa={aba} onTrocar={setAba} />
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro || base.erro}</Aviso>
      {r && aba === 'resumo' && (
        <>
          <div className="numeros">
            <div className="numero"><span>Faturamento</span><b>{moeda(r.tot.receita)}</b><small>{r.tot.vendas} vendas</small></div>
            <div className="numero"><span>Tarifas + frete</span><b>{moeda(r.tot.taxa + r.tot.frete)}</b><small>{pct(r.tot.receita ? ((r.tot.taxa + r.tot.frete) / r.tot.receita) * 100 : 0)}</small></div>
            <div className="numero"><span>Custo dos produtos</span><b>{moeda(r.tot.custo)}</b></div>
            <div className="numero"><span>Embalagem, ADS e impostos</span><b>{moeda(r.tot.outros)}</b></div>
            <div className="numero"><span>Lucro</span><b className={r.tot.lucro < 0 ? 'neg' : ''}>{moeda(r.tot.lucro)}</b><small>{pct(r.tot.receita ? (r.tot.lucro / r.tot.receita) * 100 : 0)} de margem</small></div>
          </div>
          <h3>Por conta <button className="link" onClick={() => exportar('por-conta', CAB, csvGrupo(r.porConta))}>baixar .csv</button></h3>
          {r.porConta.length ? <TabelaResultado linhas={r.porConta} rotulo="Conta" /> : <Vazio>Sem vendas no período.</Vazio>}
          <h3>Por mês</h3>
          {r.porMes.length > 0 && <TabelaResultado linhas={r.porMes} rotulo="Mês" />}
        </>
      )}
      {r && aba === 'produtos' && (
        <>
          <button className="link" onClick={() => exportar('por-produto', CAB, csvGrupo(r.porProduto))}>baixar .csv</button>
          {r.porProduto.length ? <TabelaResultado linhas={r.porProduto} rotulo="Produto" /> : <Vazio>Sem vendas no período.</Vazio>}
        </>
      )}
      {r && aba === 'abc' && (
        <>
          <Aviso tipo="info">Curva ABC pelo faturamento: <b>A</b> = produtos que somam os primeiros 80% do faturamento (os mais importantes), <b>B</b> = os próximos 15%, <b>C</b> = os últimos 5%.</Aviso>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Classe</th><th>Produto</th><th className="num">Faturamento</th><th className="num">% acumulado</th><th className="num">Lucro</th><th style={{ width: '25%' }} /></tr></thead>
              <tbody>{r.abc.map((g) => (
                <tr key={g.chave}><td><Selo tipo={g.classe === 'A' ? 'ok' : g.classe === 'B' ? 'info' : 'neutro'}>{g.classe}</Selo></td><td>{g.nome}</td><td className="num">{moeda(g.receita)}</td><td className="num">{pct(g.acum)}</td><td className="num">{moeda(g.lucro)}</td><td><Barra valor={g.receita} max={r.abc[0]?.receita} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {dados && base.dados && aba === 'parados' && <Parados produtos={base.dados.produtos} consumo={dados.consumo} dias={base.dados.config.dias_produto_parado} />}
      {r && aba === 'planejado' && (
        <>
          <Aviso tipo="info">“Planejado” = lucro calculado com a tabela de tarifas e faixas de frete vigente na data da venda. “Real” = com as tarifas e o frete que o marketplace cobrou de fato. Diferença grande = tarifa/frete diferente do esperado.</Aviso>
          {[['Por conta', r.porConta], ['Por produto', r.porProduto]].map(([t, l]) => (
            <div key={t}>
              <h3>{t}</h3>
              <table className="tabela">
                <thead><tr><th>Nome</th><th className="num">Faturamento</th><th className="num">Lucro planejado</th><th className="num">Lucro real</th><th className="num">Diferença</th></tr></thead>
                <tbody>{l.map((g) => {
                  const dif = g.lucro - g.lucro_planejado
                  return <tr key={g.chave}><td>{g.nome}</td><td className="num">{moeda(g.receita)}</td><td className="num">{moeda(g.lucro_planejado)}</td><td className="num">{moeda(g.lucro)}</td><td className={`num ${dif < -0.5 ? 'neg' : dif > 0.5 ? 'pos' : ''}`}>{moeda(dif)}</td></tr>
                })}</tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {dados && r && aba === 'devolucoes' && <Devolucoes perdidas={dados.perdidas} porProduto={r.porProduto} />}
    </Pagina>
  )
}

function Parados({ produtos, consumo, dias }) {
  const limite = Date.now() - dias * 864e5
  const lista = produtos.filter((p) => p.tipo === 'peca' && Number(p.estoque_real) > 0).map((p) => {
    const c = consumo.find((x) => x.produto_id === p.id)
    const ultima = c?.ultima_venda ? new Date(c.ultima_venda) : null
    return { p, ultima, valor: Number(p.estoque_real) * Number(p.custo_medio) }
  }).filter((x) => !x.ultima || x.ultima.getTime() < limite).sort((a, b) => b.valor - a.valor)
  return (
    <>
      <Aviso tipo="info">Peças com estoque e sem venda há mais de {dias} dias (ajuste em Configurações). Valor parado: <b>{moeda(lista.reduce((s, x) => s + x.valor, 0))}</b>.</Aviso>
      {!lista.length ? <Vazio>Nenhum produto parado. 🎉</Vazio> : (
        <table className="tabela">
          <thead><tr><th>SKU</th><th>Peça</th><th className="num">Estoque</th><th className="num">Valor parado</th><th>Última venda</th></tr></thead>
          <tbody>{lista.map(({ p, ultima, valor }) => <tr key={p.id}><td>{p.sku}</td><td>{p.nome}</td><td className="num">{numero(p.estoque_real)}</td><td className="num">{moeda(valor)}</td><td>{ultima ? dataBR(ultima) : 'nunca (desde que o app começou)'}</td></tr>)}</tbody>
        </table>
      )}
    </>
  )
}

function Devolucoes({ perdidas, porProduto }) {
  const m = new Map()
  for (const i of perdidas) {
    if (!m.has(i.produto_id)) m.set(i.produto_id, { nome: `${i.sku} — ${i.produto_nome}`, devolvidas: 0, canceladas: 0, valor: 0 })
    const g = m.get(i.produto_id)
    if (i.status === 'devolvida') g.devolvidas += Number(i.quantidade); else g.canceladas += Number(i.quantidade)
    g.valor += Number(i.receita)
  }
  const lista = [...m.entries()].map(([id, g]) => {
    const vendidas = porProduto.find((x) => x.chave === id)?.qtd || 0
    return { ...g, taxa: vendidas + g.devolvidas ? (g.devolvidas / (vendidas + g.devolvidas)) * 100 : 0 }
  }).sort((a, b) => b.devolvidas - a.devolvidas)
  return !lista.length ? <Vazio>Nenhuma devolução ou cancelamento no período.</Vazio> : (
    <table className="tabela">
      <thead><tr><th>Produto</th><th className="num">Devolvidas</th><th className="num">Canceladas</th><th className="num">Valor</th><th className="num">Taxa de devolução</th></tr></thead>
      <tbody>{lista.map((g) => <tr key={g.nome}><td>{g.nome}</td><td className="num">{numero(g.devolvidas)}</td><td className="num">{numero(g.canceladas)}</td><td className="num">{moeda(g.valor)}</td><td className={`num ${g.taxa > 5 ? 'neg' : ''}`}>{pct(g.taxa)}</td></tr>)}</tbody>
    </table>
  )
}
