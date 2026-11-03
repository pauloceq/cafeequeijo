import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Aviso, Carregando, Cartao, Pagina, Selo, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase, buscarTudo } from '../lib/base'
import { dataBR, hojeISO, moeda, numero, pct } from '../lib/formato'
import { analisar, parametros, tarifaVigente } from '../lib/precificacao'

export default function Painel() {
  const { ehDono } = useAuth()
  const { dados, erro, carregando } = useDados(async () => {
    const hoje = hojeISO()
    const inicioMes = `${hoje.slice(0, 8)}01T00:00:00-03:00`
    const base = await carregarBase({ tarifas: ehDono, config: true, produtoConta: ehDono })
    const [vendasMes, compras, prejuizo, pagar] = await Promise.all([
      buscarTudo(() => supabase.from('vw_vendas').select('id,data,conta_id,status,receita,lucro').gte('data', inicioMes).eq('status', 'concluida')),
      supabase.from('pedidos_compra').select('id,status,data_pedido,previsao_chegada,fornecedores(nome),numero_externo')
        .in('status', ['rascunho', 'enviado']).order('previsao_chegada', { nullsFirst: false }).then(ok),
      ehDono ? supabase.from('vw_vendas').select('id,data,conta_nome,codigo_externo,receita,lucro,itens_resumo')
        .eq('status', 'concluida').lt('lucro', 0).gte('data', new Date(Date.now() - 30 * 864e5).toISOString())
        .order('data', { ascending: false }).limit(20).then(ok) : [],
      ehDono ? supabase.from('contas_pagar').select('*').is('pago_em', null)
        .lte('vencimento', new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).order('vencimento').then(ok) : [],
    ])
    return { tarifas: [], produtoConta: [], ...base, vendasMes, compras, prejuizo, pagar, inicioDia: new Date(`${hoje}T00:00:00-03:00`), carregadoComoDono: ehDono }
  }, [ehDono])

  if (carregando) return <Pagina titulo="Painel"><Carregando /></Pagina>
  if (erro) return <Pagina titulo="Painel"><Aviso tipo="erro">{erro}</Aviso></Pagina>

  const { contas, produtos, vendasMes, compras, prejuizo, pagar, inicioDia, tarifas, config, produtoConta, carregadoComoDono } = dados
  const porConta = contas.map((c) => {
    const mes = vendasMes.filter((v) => v.conta_id === c.id)
    const dia = mes.filter((v) => new Date(v.data) >= inicioDia)
    const soma = (l, k) => l.reduce((s, v) => s + Number(v[k] || 0), 0)
    return { conta: c, qDia: dia.length, fDia: soma(dia, 'receita'), qMes: mes.length, fMes: soma(mes, 'receita'), lMes: soma(mes, 'lucro') }
  })
  const tot = porConta.reduce((t, r) => ({ qDia: t.qDia + r.qDia, fDia: t.fDia + r.fDia, qMes: t.qMes + r.qMes, fMes: t.fMes + r.fMes, lMes: t.lMes + r.lMes }),
    { qDia: 0, fDia: 0, qMes: 0, fMes: 0, lMes: 0 })

  const abaixoMinimo = produtos.filter((p) => p.ativo && p.tipo === 'peca' && Number(p.estoque_real) <= Number(p.estoque_minimo))

  // anúncios abaixo do preço mínimo (lucro zero)
  const alertasPreco = []
  if (ehDono && carregadoComoDono) {
    for (const pc of produtoConta) {
      const prod = produtos.find((p) => p.id === pc.produto_id)
      const conta = contas.find((c) => c.id === pc.conta_id)
      if (!prod || !conta || !pc.preco || !pc.ativo) continue
      const par = parametros({ produto: prod, conta, tarifa: tarifaVigente(tarifas, conta.id), config, pc })
      const a = analisar(Number(pc.preco), par)
      if (a.alerta === 'abaixo_minimo') alertasPreco.push({ prod, conta, preco: pc.preco, minimo: a.minimo })
    }
  }

  return (
    <Pagina titulo="Painel" subtitulo={`Hoje, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
      <div className="numeros">
        <div className="numero"><span>Vendas hoje</span><b>{tot.qDia}</b><small>{moeda(tot.fDia)}</small></div>
        <div className="numero"><span>Vendas no mês</span><b>{tot.qMes}</b><small>{moeda(tot.fMes)}</small></div>
        {ehDono && <div className="numero"><span>Lucro no mês</span><b className={tot.lMes < 0 ? 'neg' : ''}>{moeda(tot.lMes)}</b><small>{tot.fMes ? pct((tot.lMes / tot.fMes) * 100) + ' de margem' : '—'}</small></div>}
        <div className="numero"><span>Abaixo do mínimo</span><b className={abaixoMinimo.length ? 'neg' : ''}>{abaixoMinimo.length}</b><small>peças</small></div>
      </div>

      <div className="grade-2">
        <Cartao titulo="Vendas por conta">
          <table className="tabela">
            <thead><tr><th>Conta</th><th className="num">Hoje</th><th className="num">R$ hoje</th><th className="num">Mês</th><th className="num">R$ mês</th>{ehDono && <th className="num">Lucro mês</th>}</tr></thead>
            <tbody>
              {porConta.map((r) => (
                <tr key={r.conta.id}>
                  <td className="nowrap"><span className="bolinha" style={{ background: r.conta.cor }} />{r.conta.nome}</td>
                  <td className="num">{r.qDia}</td><td className="num">{moeda(r.fDia)}</td>
                  <td className="num">{r.qMes}</td><td className="num">{moeda(r.fMes)}</td>
                  {ehDono && <td className={`num ${r.lMes < 0 ? 'neg' : ''}`}>{moeda(r.lMes)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>

        <Cartao titulo="Produtos abaixo do estoque mínimo" acoes={ehDono && <Link to="/reposicao" className="botao">Lista de compra</Link>}>
          {abaixoMinimo.length === 0 ? <Vazio>Tudo certo! Nenhuma peça abaixo do mínimo.</Vazio> : (
            <table className="tabela">
              <thead><tr><th>SKU</th><th>Produto</th><th className="num">Estoque</th><th className="num">Mínimo</th></tr></thead>
              <tbody>
                {abaixoMinimo.slice(0, 15).map((p) => (
                  <tr key={p.id}><td>{p.sku}</td><td>{p.nome}</td><td className="num neg">{numero(p.estoque_real)}</td><td className="num">{numero(p.estoque_minimo)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Cartao>

        <Cartao titulo="Pedidos de compra pendentes" acoes={ehDono && <Link to="/compras" className="botao">Ver compras</Link>}>
          {compras.length === 0 ? <Vazio>Nenhum pedido pendente.</Vazio> : (
            <table className="tabela">
              <thead><tr><th>#</th><th>Fornecedor</th><th>Status</th><th>Chegada prevista</th></tr></thead>
              <tbody>
                {compras.map((c) => {
                  const atrasado = c.status === 'enviado' && c.previsao_chegada && c.previsao_chegada < hojeISO()
                  return (
                    <tr key={c.id}>
                      <td>{c.id}{c.numero_externo ? <small className="dica"> ({c.numero_externo})</small> : null}</td>
                      <td>{c.fornecedores?.nome}</td>
                      <td><Selo tipo={c.status === 'enviado' ? 'info' : 'neutro'}>{c.status === 'enviado' ? 'a caminho' : 'rascunho'}</Selo></td>
                      <td className={atrasado ? 'neg' : ''}>{c.previsao_chegada ? dataBR(c.previsao_chegada + 'T12:00') : '—'}{atrasado ? ' (atrasado)' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Cartao>

        {ehDono && (
          <Cartao titulo="Alertas">
            {!alertasPreco.length && !prejuizo.length && !pagar.length && <Vazio>Nenhum alerta. 🎉</Vazio>}
            {alertasPreco.length > 0 && (
              <>
                <h3>Anúncios abaixo do preço mínimo (dão prejuízo)</h3>
                <ul className="lista">
                  {alertasPreco.map((a, i) => (
                    <li key={i}><b>{a.prod.sku}</b> em {a.conta.nome}: {moeda(a.preco)} — mínimo {moeda(a.minimo)} <Link to="/precificacao">ajustar</Link></li>
                  ))}
                </ul>
              </>
            )}
            {prejuizo.length > 0 && (
              <>
                <h3>Vendas com prejuízo (últimos 30 dias)</h3>
                <ul className="lista">
                  {prejuizo.map((v) => (
                    <li key={v.id}>{dataBR(v.data)} · {v.conta_nome} · {v.itens_resumo}: <span className="neg">{moeda(v.lucro)}</span></li>
                  ))}
                </ul>
              </>
            )}
            {pagar.length > 0 && (
              <>
                <h3>Contas a pagar nos próximos 7 dias</h3>
                <ul className="lista">
                  {pagar.map((c) => (
                    <li key={c.id} className={c.vencimento < hojeISO() ? 'neg' : ''}>{dataBR(c.vencimento + 'T12:00')} · {c.descricao} {c.parcela && `(${c.parcela})`}: <b>{moeda(c.valor)}</b></li>
                  ))}
                </ul>
                <Link to="/financeiro">Abrir financeiro</Link>
              </>
            )}
          </Cartao>
        )}
      </div>
    </Pagina>
  )
}
