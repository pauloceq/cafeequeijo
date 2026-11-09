import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Abas, Aviso, Barra, Campo, Carregando, Cartao, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { buscarTudo, carregarBase } from '../lib/base'
import { acharCabecalho, acharColuna, lerArquivo } from '../lib/planilha'
import { dataBR, hojeISO, lerData, lerNumero, moeda } from '../lib/formato'

const d = (iso) => (iso ? dataBR(iso + 'T12:00') : '—')
const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

export default function Financeiro() {
  const [aba, setAba] = useState('fluxo')
  return (
    <Pagina titulo="Financeiro">
      <Abas abas={[['fluxo', 'Fluxo de caixa'], ['receber', 'A receber'], ['pagar', 'A pagar'], ['conciliacao', 'Conciliação']]} ativa={aba} onTrocar={setAba} />
      {aba === 'fluxo' && <Fluxo />}
      {aba === 'receber' && <Receber />}
      {aba === 'pagar' && <Pagar />}
      {aba === 'conciliacao' && <Conciliacao />}
    </Pagina>
  )
}

function useFinanceiro() {
  return useDados(async () => {
    const [receber, pagar, config, recebidas, pagas] = await Promise.all([
      buscarTudo(() => supabase.from('vw_vendas').select('id,data,conta_id,conta_nome,codigo_externo,liquido_previsto,previsao_recebimento,itens_resumo')
        // vendas importadas como histórico também entram, se a liberação for recente (as antigas já foram recebidas)
        .eq('status', 'concluida').is('valor_recebido', null).or(`origem.neq.historico,previsao_recebimento.gte.${diasAtras(90)}`)),
      supabase.from('contas_pagar').select('*').is('pago_em', null).order('vencimento').then(ok),
      supabase.from('config_geral').select('*').eq('id', 1).single().then(ok),
      // o que já foi liberado nas últimas semanas (para mostrar o histórico de liberações)
      buscarTudo(() => supabase.from('vendas').select('conta_id,valor_recebido,data_recebimento,contas(nome)')
        .eq('status', 'concluida').not('valor_recebido', 'is', null).gte('data_recebimento', diasAtras(13 * 7))),
      supabase.from('contas_pagar').select('valor,pago_em').not('pago_em', 'is', null).gte('pago_em', diasAtras(13 * 7)).then(ok),
    ])
    return { receber, pagar, config, recebidas, pagas }
  })
}

function Fluxo() {
  const { dados, erro, carregando, recarregar } = useFinanceiro()
  const [semanas, setSemanas] = useState(8)
  const [passadas, setPassadas] = useState(4)
  const acao = useAcao()
  const linhas = useMemo(() => {
    if (!dados) return []
    // semanas de segunda a domingo, como os saques costumam ser planejados
    const hoje = new Date(hojeISO() + 'T12:00')
    const seg = new Date(hoje.getTime() - ((hoje.getDay() + 6) % 7) * 864e5)
    const iso = (x) => x.toISOString().slice(0, 10)
    const out = []
    let saldo = Number(dados.config.saldo_caixa) || 0
    for (let i = -passadas; i < semanas; i++) {
      const ini = new Date(seg.getTime() + i * 7 * 864e5), fim = new Date(ini.getTime() + 6 * 864e5)
      const a = iso(ini), b = iso(fim)
      const dentro = (d) => d && d >= a && d <= b
      if (i < 0) {
        const lib = dados.recebidas.filter((v) => dentro(v.data_recebimento))
        const porConta = {}
        for (const v of lib) porConta[v.contas?.nome || '?'] = (porConta[v.contas?.nome || '?'] || 0) + Number(v.valor_recebido)
        out.push({ ini, fim, passado: true, ent: lib.reduce((s, v) => s + Number(v.valor_recebido), 0), qtd: lib.length, porConta,
          sai: dados.pagas.filter((c) => dentro(c.pago_em)).reduce((s, c) => s + Number(c.valor), 0) })
        continue
      }
      // atrasados (liberação prevista antes de hoje e ainda não marcada) entram na semana atual
      const naSemana = (d) => d && (i === 0 ? d <= b : dentro(d))
      const lib = dados.receber.filter((v) => naSemana(v.previsao_recebimento))
      const porConta = {}
      for (const v of lib) porConta[v.conta_nome] = (porConta[v.conta_nome] || 0) + Number(v.liquido_previsto)
      const ent = lib.reduce((s, v) => s + Number(v.liquido_previsto), 0)
      const sai = dados.pagar.filter((c) => naSemana(c.vencimento)).reduce((s, c) => s + Number(c.valor), 0)
      saldo += ent - sai
      out.push({ ini, fim, ent, sai, saldo, qtd: lib.length, porConta, atual: i === 0 })
    }
    return out
  }, [dados, semanas, passadas])
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  const max = Math.max(1, ...linhas.map((l) => Math.max(l.ent, l.sai)))
  const fmt = (x) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return (
    <>
      <Cartao>
        <div className="linha">
          <Campo rotulo="Saldo em caixa hoje (R$)" dica="Some conta bancária + saldo disponível nos marketplaces">
            <input defaultValue={String(dados.config.saldo_caixa).replace('.', ',')} inputMode="decimal"
              onBlur={(e) => acao.executar(async () => { ok(await supabase.from('config_geral').update({ saldo_caixa: lerNumero(e.target.value) }).eq('id', 1)); recarregar() })} />
          </Campo>
          <Campo rotulo="Semanas passadas"><select value={passadas} onChange={(e) => setPassadas(Number(e.target.value))}><option>0</option><option>4</option><option>8</option><option>12</option></select></Campo>
          <Campo rotulo="Semanas à frente"><select value={semanas} onChange={(e) => setSemanas(Number(e.target.value))}><option>4</option><option>8</option><option>12</option></select></Campo>
        </div>
        <Mensagens acao={acao} />
        <p className="dica">Liberações = dinheiro das vendas que fica disponível para saque em cada marketplace. Semanas passadas mostram o que já foi liberado; as próximas mostram a previsão (data da venda + dias de liberação da conta, em Configurações). Liberações atrasadas entram na semana atual.</p>
      </Cartao>
      <div className="tabela-rolagem">
        <table className="tabela">
          <thead><tr><th>Semana</th><th className="num">Liberações</th><th>Por conta</th><th className="num">Saídas</th><th className="num">Saldo previsto</th><th style={{ width: '22%' }} /></tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className={l.atual ? 'destaque' : l.passado ? 'passado' : ''}>
                <td>{fmt(l.ini)} a {fmt(l.fim)}<div className="dica">{l.passado ? 'liberado' : l.atual ? 'esta semana' : 'previsto'}{l.qtd ? ` · ${l.qtd} venda(s)` : ''}</div></td>
                <td className="num"><b>{moeda(l.ent)}</b></td>
                <td className="dica">{Object.entries(l.porConta).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c}: ${moeda(v)}`).join(' · ')}</td>
                <td className="num neg">{moeda(l.sai)}</td>
                <td className={`num ${l.saldo < 0 ? 'neg' : ''}`}>{l.passado ? '—' : <b>{moeda(l.saldo)}</b>}</td>
                <td><Barra valor={l.ent} max={max} cor="var(--ok)" /><Barra valor={l.sai} max={max} cor="var(--neg)" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.some((l) => !l.passado && l.saldo < 0) && <Aviso tipo="aviso">O saldo previsto fica negativo em alguma semana. Considere adiar compras ou antecipar recebíveis.</Aviso>}
    </>
  )
}

function Receber() {
  const { dados, erro, carregando } = useFinanceiro()
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  const porConta = {}
  for (const v of dados.receber) (porConta[v.conta_nome] ||= []).push(v)
  return (
    <>
      <div className="numeros">
        {Object.entries(porConta).map(([c, l]) => <div className="numero" key={c}><span>{c}</span><b>{moeda(l.reduce((s, v) => s + Number(v.liquido_previsto), 0))}</b><small>{l.length} venda(s)</small></div>)}
      </div>
      {!dados.receber.length ? <Vazio>Nada a receber. Marque os recebimentos na aba Conciliação.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela compacta">
            <thead><tr><th>Liberação prevista</th><th>Conta</th><th>Pedido</th><th>Itens</th><th className="num">Líquido previsto</th></tr></thead>
            <tbody>
              {[...dados.receber].sort((a, b) => (a.previsao_recebimento || '').localeCompare(b.previsao_recebimento || '')).map((v) => (
                <tr key={v.id} className={v.previsao_recebimento < hojeISO() ? 'atrasado' : ''}>
                  <td>{d(v.previsao_recebimento)}</td><td>{v.conta_nome}</td><td>{v.codigo_externo || '#' + v.id}</td><td>{v.itens_resumo}</td><td className="num">{moeda(v.liquido_previsto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Pagar() {
  const [mostrar, setMostrar] = useState('abertas')
  const [nova, setNova] = useState(null)
  const acao = useAcao()
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    let q = supabase.from('contas_pagar').select('*').order('vencimento')
    if (mostrar === 'abertas') q = q.is('pago_em', null)
    else q = q.not('pago_em', 'is', null).order('pago_em', { ascending: false }).limit(200)
    return ok(await q)
  }, [mostrar])
  const pagar = (c, data) => acao.executar(async () => { ok(await supabase.from('contas_pagar').update({ pago_em: data }).eq('id', c.id)); recarregar() })
  return (
    <>
      <div className="filtros">
        <select value={mostrar} onChange={(e) => setMostrar(e.target.value)}><option value="abertas">Em aberto</option><option value="pagas">Pagas</option></select>
        <button className="botao primario" onClick={() => setNova({ descricao: '', valor: null, vencimento: hojeISO(), categoria: 'despesa', parcelas: 1 })}>+ Nova conta a pagar</button>
      </div>
      <Mensagens acao={acao} />
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {dados && (!dados.length ? <Vazio>Nenhuma conta.</Vazio> : (
        <table className="tabela">
          <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>
            {dados.map((c) => (
              <tr key={c.id} className={!c.pago_em && c.vencimento < hojeISO() ? 'atrasado' : ''}>
                <td>{d(c.vencimento)}</td><td>{c.descricao}{c.parcela && ` (${c.parcela})`}</td><td>{c.categoria}</td><td className="num">{moeda(c.valor)}</td>
                <td>{c.pago_em ? <>pago {d(c.pago_em)} <button className="link" onClick={() => pagar(c, null)}>desfazer</button></>
                  : <><button className="botao" onClick={() => pagar(c, hojeISO())}>Marcar pago</button>{!c.pedido_compra_id && <button className="link" onClick={() => confirm('Excluir?') && acao.executar(async () => { ok(await supabase.from('contas_pagar').delete().eq('id', c.id)); recarregar() })}>excluir</button>}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="dica">Parcelas de compras são criadas sozinhas a partir dos pedidos de compra (forma de pagamento + parcelas).</p>
      {nova && (
        <Modal titulo="Nova conta a pagar" onFechar={() => setNova(null)}>
          <div className="form">
            <Campo rotulo="Descrição"><input value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} placeholder="Ex.: Embalagens, contador, aluguel" /></Campo>
            <div className="linha">
              <Campo rotulo="Valor de cada parcela (R$)"><Num value={nova.valor} onChange={(v) => setNova({ ...nova, valor: v })} /></Campo>
              <Campo rotulo="1º vencimento"><input type="date" value={nova.vencimento} onChange={(e) => setNova({ ...nova, vencimento: e.target.value })} /></Campo>
              <Campo rotulo="Parcelas (mensais)"><Num casas={0} value={nova.parcelas} onChange={(v) => setNova({ ...nova, parcelas: v || 1 })} /></Campo>
              <Campo rotulo="Categoria"><input value={nova.categoria} onChange={(e) => setNova({ ...nova, categoria: e.target.value })} /></Campo>
            </div>
            <div className="acoes-form"><span style={{ flex: 1 }} />
              <button className="botao primario" disabled={acao.ocupado} onClick={() => acao.executar(async () => {
                if (!nova.descricao || !nova.valor) throw new Error('Preencha descrição e valor.')
                const n = Math.max(1, nova.parcelas)
                const linhas = Array.from({ length: n }, (_, i) => {
                  const v = new Date(nova.vencimento + 'T12:00'); v.setMonth(v.getMonth() + i)
                  return { descricao: nova.descricao, valor: nova.valor, vencimento: v.toISOString().slice(0, 10), categoria: nova.categoria || 'despesa', parcela: n > 1 ? `${i + 1}/${n}` : null }
                })
                ok(await supabase.from('contas_pagar').insert(linhas)); setNova(null); recarregar()
              })}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

const AP_PEDIDO = ['n.º de venda', 'nº de venda', 'numero de venda', 'source_id', 'id da origem', 'id do pedido', 'amazon-order-id', 'order-id', 'order id', 'referencia', 'pedido']
const AP_VALOR = ['net_credit_amount', 'valor liquido', 'valor liberado', 'valor total lancado', 'total (brl)', 'total', 'amount', 'valor']
const AP_DATA = ['money_release_date', 'data de liberacao', 'data de lancamento', 'data da liberacao', 'date', 'data']

function Conciliacao() {
  const base = useDados(() => carregarBase({ produtos: false }))
  const [f, setF] = useState({ de: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), ate: hojeISO(), conta: '', so: 'diferenca' })
  const acao = useAcao()
  const [imp, setImp] = useState(null)
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    let q = supabase.from('vw_vendas').select('id,data,conta_id,conta_nome,codigo_externo,receita,taxa_marketplace,frete,liquido_previsto,valor_recebido,data_recebimento,diferenca_recebido,itens_resumo')
      .eq('status', 'concluida').gte('data', `${f.de}T00:00:00-03:00`).lte('data', `${f.ate}T23:59:59-03:00`).order('data', { ascending: false }).limit(2000)
    if (f.conta) q = q.eq('conta_id', Number(f.conta))
    return ok(await q)
  }, [f.de, f.ate, f.conta])

  const lista = (dados || []).filter((v) => f.so === 'todas' || (f.so === 'pendentes' ? v.valor_recebido === null : v.valor_recebido !== null && Math.abs(v.diferenca_recebido) > 0.05))
  const totDif = (dados || []).filter((v) => v.valor_recebido !== null).reduce((s, v) => s + Number(v.diferenca_recebido), 0)

  async function salvarRecebido(v, valor) {
    await acao.executar(async () => {
      ok(await supabase.from('vendas').update({ valor_recebido: valor, data_recebimento: valor === null ? null : (v.data_recebimento || hojeISO()) }).eq('id', v.id))
      recarregar()
    })
  }

  async function lerLiberacoes(file) {
    await acao.executar(async () => {
      if (!f.conta) throw new Error('Escolha primeiro a conta (filtro acima) a que esse relatório pertence.')
      const abas = await lerArquivo(file)
      const aba = abas[0]
      const { indice } = acharCabecalho(aba.linhas, [...AP_PEDIDO, ...AP_VALOR, ...AP_DATA])
      const cab = aba.linhas[indice]
      const cp = acharColuna(cab, AP_PEDIDO), cv = acharColuna(cab, AP_VALOR), cd = acharColuna(cab, AP_DATA)
      if (cp < 0 || cv < 0) throw new Error('Não achei as colunas de nº do pedido e valor. Use o relatório de liberações/pagamentos do marketplace.')
      const soma = {}
      for (const l of aba.linhas.slice(indice + 1)) {
        const ped = String(l[cp] ?? '').trim()
        if (!ped) continue
        soma[ped] ||= { valor: 0, data: null }
        soma[ped].valor += lerNumero(l[cv])
        if (cd > -1) soma[ped].data = lerData(l[cd]) || soma[ped].data
      }
      setImp({ soma, colunas: [cab[cp], cab[cv], cd > -1 ? cab[cd] : null] })
    })
  }

  async function aplicarLiberacoes() {
    await acao.executar(async () => {
      const cods = Object.keys(imp.soma)
      const vendas = []
      for (let i = 0; i < cods.length; i += 200) {
        vendas.push(...ok(await supabase.from('vendas').select('id,codigo_externo').eq('conta_id', Number(f.conta)).in('codigo_externo', cods.slice(i, i + 200))))
      }
      for (const v of vendas) {
        const s = imp.soma[v.codigo_externo]
        ok(await supabase.from('vendas').update({ valor_recebido: Math.round(s.valor * 100) / 100, data_recebimento: s.data ? s.data.toISOString().slice(0, 10) : hojeISO() }).eq('id', v.id))
      }
      setImp(null); recarregar()
      return { ok: vendas.length, total: cods.length }
    }, (r) => `${r.ok} de ${r.total} pedido(s) do relatório conciliados. ${r.total - r.ok > 0 ? `${r.total - r.ok} não foram encontrados nas vendas desta conta (importe as vendas antes).` : ''}`)
  }

  return (
    <>
      <div className="filtros">
        <label>De <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
        <label>Até <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
        <select value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })}>
          <option value="">Todas as contas</option>{base.dados?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={f.so} onChange={(e) => setF({ ...f, so: e.target.value })}>
          <option value="diferenca">Só com diferença</option><option value="pendentes">Ainda não recebidas</option><option value="todas">Todas</option>
        </select>
      </div>
      <Cartao titulo="Importar relatório de liberações / pagamentos do marketplace">
        <p className="dica">Mercado Livre: Faturamento/Mercado Pago → Relatórios → <b>Liberações</b>. Shopee: Minhas finanças → <b>Minha renda</b> → Exportar. Amazon: Relatórios → Pagamentos → <b>Relatório de transações</b>. Escolha a conta no filtro acima antes.</p>
        <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => e.target.files[0] && lerLiberacoes(e.target.files[0])} />
        {imp && (
          <Aviso tipo="info">
            {Object.keys(imp.soma).length} pedido(s) no relatório (colunas: {imp.colunas.filter(Boolean).join(' · ')}).{' '}
            <button className="botao primario" onClick={aplicarLiberacoes} disabled={acao.ocupado}>Conciliar</button>
          </Aviso>
        )}
      </Cartao>
      <Mensagens acao={acao} />
      {dados && <div className="numeros"><div className="numero"><span>Diferença total (recebido − previsto)</span><b className={totDif < -0.05 ? 'neg' : ''}>{moeda(totDif)}</b></div></div>}
      {(carregando || base.carregando) && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {dados && (!lista.length ? <Vazio>Nada aqui. {f.so === 'diferenca' && 'Nenhuma diferença encontrada. 🎉'}</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela compacta">
            <thead><tr><th>Data</th><th>Conta</th><th>Pedido</th><th className="num">Receita</th><th className="num">Tarifas+frete</th><th className="num">Líquido previsto</th><th className="num">Recebido</th><th className="num">Diferença</th></tr></thead>
            <tbody>
              {lista.map((v) => {
                const dif = v.diferenca_recebido
                return (
                  <tr key={v.id}>
                    <td>{dataBR(v.data)}</td><td>{v.conta_nome}</td><td>{v.codigo_externo || '#' + v.id}<div className="dica">{v.itens_resumo}</div></td>
                    <td className="num">{moeda(v.receita)}</td><td className="num">{moeda(Number(v.taxa_marketplace) + Number(v.frete))}</td>
                    <td className="num">{moeda(v.liquido_previsto)}</td>
                    <td className="num"><input className="mini num" defaultValue={v.valor_recebido === null ? '' : String(v.valor_recebido).replace('.', ',')} placeholder="—"
                      onBlur={(e) => { const x = e.target.value.trim() === '' ? null : lerNumero(e.target.value); if (x !== (v.valor_recebido === null ? null : Number(v.valor_recebido))) salvarRecebido(v, x) }} /></td>
                    <td className="num">{dif === null ? <Selo>pendente</Selo> : <span className={Math.abs(dif) > 0.05 ? (dif < 0 ? 'neg' : 'pos') : ''}>{moeda(dif)}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
