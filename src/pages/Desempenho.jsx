import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Aviso, Barra, Carregando, Cartao, Pagina, useDados, Vazio } from '../components/ui'
import { buscarTudo, carregarBase } from '../lib/base'
import { hojeISO, moeda, pct } from '../lib/formato'

const mesesAtras = (n) => { const d = new Date(hojeISO() + 'T12:00'); d.setMonth(d.getMonth() - n, 1); return d.toISOString().slice(0, 10) }
const int = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR')

// Classificação pelo cruzamento giro × margem (comparado à mediana do período)
const CLASSES = {
  estrela: ['⭐ Estrela', 'vende muito e com boa margem: priorize estoque e anúncios', 'var(--ok)'],
  volume: ['🚚 Carro-chefe', 'vende muito, margem menor: cuide do custo e da tarifa', 'var(--acento)'],
  joia: ['💎 Joia', 'margem boa, vende pouco: vale anunciar mais', '#7a5af8'],
  rever: ['⚠️ Rever', 'vende pouco e com margem baixa: reprecificar, trocar fornecedor ou parar', 'var(--neg)'],
}
const mediana = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0 }

export default function Desempenho() {
  const [f, setF] = useState({ de: mesesAtras(5), ate: hojeISO(), conta: '', por: 'peca', minimo: 5 })
  const base = useDados(() => carregarBase({ produtos: true }))
  const { dados, erro, carregando } = useDados(async () => {
    let q = () => {
      let x = supabase.from('vw_vendas_pecas').select('peca_id,vendido_id,sku_vendido,conta_id,quantidade,receita,custo,lucro,tarifas')
        .eq('status', 'concluida').gte('data', `${f.de}T00:00:00-03:00`).lte('data', `${f.ate}T23:59:59-03:00`)
      if (f.conta) x = x.eq('conta_id', Number(f.conta))
      return x
    }
    return buscarTudo(q)
  }, [f.de, f.ate, f.conta])

  const r = useMemo(() => {
    if (!dados || !base.dados) return null
    const prods = base.dados.produtos
    const dias = Math.max(1, (new Date(f.ate) - new Date(f.de)) / 864e5 + 1)
    const g = {}
    for (const v of dados) {
      const id = f.por === 'peca' ? v.peca_id : v.vendido_id
      const p = prods.find((x) => x.id === id) || {}
      const x = (g[id] ||= { id, sku: p.sku || v.sku_vendido, nome: p.nome || v.sku_vendido, estoque: Number(p.estoque_real) || 0, qtd: 0, receita: 0, custo: 0, lucro: 0, tarifas: 0 })
      x.qtd += Number(v.quantidade); x.receita += Number(v.receita); x.custo += Number(v.custo); x.lucro += Number(v.lucro); x.tarifas += Number(v.tarifas)
    }
    let lista = Object.values(g).map((x) => ({
      ...x, margem: x.receita ? x.lucro / x.receita * 100 : 0, roi: x.custo > 0 ? x.lucro / x.custo * 100 : null,
      lucroUn: x.qtd ? x.lucro / x.qtd : 0, ticket: x.qtd ? x.receita / x.qtd : 0, porMes: x.qtd / dias * 30,
      semCusto: x.custo <= 0,
    }))
    const relevantes = lista.filter((x) => x.qtd >= f.minimo && !x.semCusto)
    const mQtd = mediana(relevantes.map((x) => x.qtd)), mMargem = mediana(relevantes.map((x) => x.margem))
    lista = lista.map((x) => ({ ...x, classe: x.qtd < f.minimo || x.semCusto ? null : x.qtd >= mQtd ? (x.margem >= mMargem ? 'estrela' : 'volume') : (x.margem >= mMargem ? 'joia' : 'rever') }))
    const tot = lista.reduce((s, x) => ({ qtd: s.qtd + x.qtd, receita: s.receita + x.receita, lucro: s.lucro + x.lucro, custo: s.custo + x.custo }), { qtd: 0, receita: 0, lucro: 0, custo: 0 })
    return { lista, tot, mQtd, mMargem, dias }
  }, [dados, base.dados, f.por, f.minimo, f.de, f.ate])

  const atalhos = [['3 meses', 2], ['6 meses', 5], ['12 meses', 11]]
  return (
    <Pagina titulo="Desempenho dos produtos" subtitulo="Quais produtos mais vendem, dão mais lucro e melhor retorno sobre o que você investe. Lucro já desconta custo do produto (com frete e impostos de importação), tarifas, frete, embalagem e publicidade.">
      <div className="filtros">
        <label>De <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        {atalhos.map(([t, n]) => <button key={t} className="botao" onClick={() => setF({ ...f, de: mesesAtras(n), ate: hojeISO() })}>{t}</button>)}
        <button className="botao" onClick={() => setF({ ...f, de: hojeISO().slice(0, 4) + '-01-01', ate: hojeISO() })}>este ano</button>
        <select value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })}>
          <option value="">Todas as contas</option>{base.dados?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={f.por} onChange={(e) => setF({ ...f, por: e.target.value })}>
          <option value="peca">Por produto comprado (soma SKUs e kits)</option><option value="vendido">Por SKU / anúncio vendido</option>
        </select>
        <label>Mín. vendidas <input className="mini" type="number" min="1" value={f.minimo} onChange={(e) => setF({ ...f, minimo: Math.max(1, Number(e.target.value) || 1) })} /></label>
      </div>
      {(carregando || base.carregando) && <Carregando />}
      <Aviso tipo="erro">{erro || base.erro}</Aviso>
      {r && (!r.lista.length ? <Vazio>Nenhuma venda no período.</Vazio> : <Conteudo r={r} minimo={f.minimo} />)}
    </Pagina>
  )
}

function Conteudo({ r, minimo }) {
  const [classe, setClasse] = useState('')
  const rel = r.lista.filter((x) => x.qtd >= minimo && !x.semCusto)
  const top = (campo, n = 5, asc = false) => [...rel].sort((a, b) => asc ? a[campo] - b[campo] : b[campo] - a[campo]).slice(0, n)
  const semCusto = r.lista.filter((x) => x.semCusto && x.qtd > 0)
  const tabela = [...r.lista].filter((x) => !classe || x.classe === classe).sort((a, b) => b.lucro - a.lucro)
  return (
    <>
      <div className="numeros">
        <div className="numero"><span>Unidades vendidas</span><b>{int(r.tot.qtd)}</b><small>{r.lista.length} produto(s)</small></div>
        <div className="numero"><span>Faturamento</span><b>{moeda(r.tot.receita)}</b></div>
        <div className="numero"><span>Lucro</span><b>{moeda(r.tot.lucro)}</b><small>margem {pct(r.tot.receita ? r.tot.lucro / r.tot.receita * 100 : 0)}</small></div>
        <div className="numero"><span>Retorno sobre o custo</span><b>{pct(r.tot.custo ? r.tot.lucro / r.tot.custo * 100 : 0)}</b><small>cada R$ 1 em mercadoria vira {moeda(r.tot.custo ? 1 + r.tot.lucro / r.tot.custo : 0)}</small></div>
      </div>

      <div className="grade-cartoes">
        <Ranking titulo="🏆 Mais vendidos" lista={top('qtd')} campo="qtd" valor={(x) => `${int(x.qtd)} un`} />
        <Ranking titulo="💰 Maior lucro total" lista={top('lucro')} campo="lucro" valor={(x) => moeda(x.lucro)} />
        <Ranking titulo="📈 Melhor margem" lista={top('margem')} campo="margem" valor={(x) => pct(x.margem)} />
        <Ranking titulo="🔁 Melhor retorno (lucro ÷ custo)" lista={top('roi')} campo="roi" valor={(x) => pct(x.roi)} />
        <Ranking titulo="🪙 Maior lucro por unidade" lista={top('lucroUn')} campo="lucroUn" valor={(x) => moeda(x.lucroUn)} />
        <Ranking titulo="🔻 Menor margem (atenção)" lista={top('margem', 5, true)} campo="margem" valor={(x) => pct(x.margem)} alerta />
      </div>

      <Cartao titulo="O que vale mais a pena">
        <Mapa lista={rel} mQtd={r.mQtd} mMargem={r.mMargem} />
        <div className="legenda-classes">
          {Object.entries(CLASSES).map(([k, [nome, desc, cor]]) => (
            <button key={k} className={`botao ${classe === k ? 'primario' : ''}`} onClick={() => setClasse(classe === k ? '' : k)} title={desc}>
              <span style={{ color: classe === k ? undefined : cor }}>{nome}</span> ({r.lista.filter((x) => x.classe === k).length})
            </button>
          ))}
        </div>
        <p className="dica">Cada bolinha é um produto: mais à direita vende mais, mais acima tem margem maior, e o tamanho é o lucro total. As linhas tracejadas são a mediana ({int(r.mQtd)} un · {pct(r.mMargem)}). Produtos com menos de {minimo} vendas no período ficam de fora da classificação.</p>
      </Cartao>

      {semCusto.length > 0 && <Aviso tipo="aviso">Sem custo cadastrado (lucro e margem ficam altos demais e eles ficam fora dos rankings): {semCusto.map((x) => x.sku).join(', ')}. Informe o custo em Produtos.</Aviso>}

      <div className="tabela-rolagem">
        <table className="tabela compacta">
          <thead><tr><th>Produto</th><th>Classe</th><th className="num">Vendidas</th><th className="num">Vendas/mês</th><th className="num">Preço médio</th><th className="num">Faturamento</th><th className="num">Custo</th><th className="num">Lucro</th><th className="num">Lucro/un</th><th className="num">Margem</th><th className="num">Retorno</th><th className="num">Estoque</th></tr></thead>
          <tbody>
            {tabela.map((x) => (
              <tr key={x.id}>
                <td>{x.nome}<div className="dica">{x.sku}</div></td>
                <td>{x.classe ? <span title={CLASSES[x.classe][1]}>{CLASSES[x.classe][0]}</span> : <span className="dica">{x.semCusto ? 'sem custo' : 'poucas vendas'}</span>}</td>
                <td className="num">{int(x.qtd)}</td><td className="num">{(Math.round(x.porMes * 10) / 10).toLocaleString('pt-BR')}</td>
                <td className="num">{moeda(x.ticket)}</td><td className="num">{moeda(x.receita)}</td><td className="num">{x.semCusto ? '—' : moeda(x.custo)}</td>
                <td className={`num ${x.lucro < 0 ? 'neg' : ''}`}><b>{moeda(x.lucro)}</b></td><td className="num">{moeda(x.lucroUn)}</td>
                <td className={`num ${x.margem < 10 ? 'neg' : ''}`}>{pct(x.margem)}</td><td className="num">{x.roi === null ? '—' : pct(x.roi)}</td>
                <td className="num">{int(x.estoque)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Ranking({ titulo, lista, campo, valor, alerta }) {
  const max = Math.max(1, ...lista.map((x) => Math.abs(Number(x[campo]) || 0)))
  return (
    <Cartao titulo={titulo}>
      {!lista.length ? <p className="dica">Sem produtos com vendas suficientes.</p> : (
        <ol className="ranking">
          {lista.map((x) => {
            const v = Math.abs(Number(x[campo]) || 0)
            return (
              <li key={x.id}>
                <div className="ranking-linha"><span title={x.nome}>{x.nome}</span><b className={alerta ? 'neg' : ''}>{valor(x)}</b></div>
                <Barra valor={v} max={max} cor={alerta ? 'var(--neg)' : undefined} />
              </li>
            )
          })}
        </ol>
      )}
    </Cartao>
  )
}

// Gráfico de dispersão: vendas (x) × margem (y), bolha = lucro
function Mapa({ lista, mQtd, mMargem }) {
  if (!lista.length) return <p className="dica">Sem produtos com vendas suficientes no período.</p>
  const W = 720, H = 360, P = 48
  const maxQ = Math.max(...lista.map((x) => x.qtd)) * 1.08
  const minM = Math.min(0, ...lista.map((x) => x.margem)), maxM = Math.max(...lista.map((x) => x.margem)) * 1.1
  const maxL = Math.max(1, ...lista.map((x) => Math.abs(x.lucro)))
  const X = (q) => P + (q / maxQ) * (W - 2 * P)
  const Y = (m) => H - P - ((m - minM) / (maxM - minM || 1)) * (H - 2 * P)
  const cor = (x) => CLASSES[x.classe]?.[2] || 'var(--texto-2)'
  return (
    <div className="mapa-produtos">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vendas por margem de cada produto">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--borda)" />
        <line x1={P} y1={P / 2} x2={P} y2={H - P} stroke="var(--borda)" />
        <line x1={X(mQtd)} y1={P / 2} x2={X(mQtd)} y2={H - P} stroke="var(--texto-2)" strokeDasharray="4 4" opacity=".5" />
        <line x1={P} y1={Y(mMargem)} x2={W - P} y2={Y(mMargem)} stroke="var(--texto-2)" strokeDasharray="4 4" opacity=".5" />
        <text x={W - P} y={H - 14} textAnchor="end" fontSize="12" fill="var(--texto-2)">unidades vendidas →</text>
        <text x={14} y={P / 2 + 4} fontSize="12" fill="var(--texto-2)">margem ↑</text>
        <text x={W - P - 4} y={P / 2 + 14} textAnchor="end" fontSize="11" fill="var(--ok)">⭐ Estrelas</text>
        <text x={P + 6} y={P / 2 + 14} fontSize="11" fill="#7a5af8">💎 Joias</text>
        <text x={W - P - 4} y={H - P - 8} textAnchor="end" fontSize="11" fill="var(--acento)">🚚 Carros-chefe</text>
        <text x={P + 6} y={H - P - 8} fontSize="11" fill="var(--neg)">⚠️ Rever</text>
        {lista.map((x) => (
          <g key={x.id}>
            <circle cx={X(x.qtd)} cy={Y(x.margem)} r={5 + 18 * Math.sqrt(Math.abs(x.lucro) / maxL)} fill={cor(x)} fillOpacity=".35" stroke={cor(x)}>
              <title>{`${x.sku} — ${x.nome}\n${int(x.qtd)} vendidas · margem ${pct(x.margem)} · lucro ${moeda(x.lucro)}`}</title>
            </circle>
            <text x={X(x.qtd)} y={Y(x.margem) + 3} textAnchor="middle" fontSize="9" fill="var(--texto)">{x.sku}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
