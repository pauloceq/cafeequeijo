import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { Aviso, Campo, Carregando, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { dataBR, hojeISO, moeda, numero } from '../lib/formato'

const STATUS = { rascunho: ['neutro', 'rascunho'], enviado: ['info', 'a caminho'], recebido: ['ok', 'recebido'], cancelado: ['neutro', 'cancelado'] }
const EXTRAS = [['frete', 'Frete'], ['imposto_importacao', 'Imposto de importação'], ['icms', 'ICMS'], ['iof', 'IOF'], ['outras_despesas', 'Outras despesas']]

export default function Compras() {
  const [status, setStatus] = useState('abertos')
  const [editando, setEditando] = useState(null)
  const base = useDados(async () => {
    const b = await carregarBase({ locais: true })
    const fornecedores = await supabase.from('fornecedores').select('*').order('nome').then(ok)
    return { ...b, fornecedores }
  })
  const { dados: pedidos, erro, carregando, recarregar } = useDados(async () => {
    let q = supabase.from('pedidos_compra').select('*, fornecedores(nome), pedido_compra_itens(*)').order('data_pedido', { ascending: false }).limit(500)
    if (status === 'abertos') q = q.in('status', ['rascunho', 'enviado'])
    else if (status) q = q.eq('status', status)
    return ok(await q)
  }, [status])

  const total = (p) => p.pedido_compra_itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0) + EXTRAS.reduce((s, [k]) => s + Number(p[k] || 0), 0)

  return (
    <Pagina titulo="Pedidos de compra" subtitulo="Rascunho → a caminho → recebido. Ao receber, as peças entram no estoque e o custo médio é atualizado com frete e impostos rateados."
      acoes={<>
        <Link className="botao" to="/aliexpress">🌏 Importar AliExpress</Link>
        <button className="botao primario" onClick={() => setEditando({})}>+ Novo pedido</button>
      </>}>
      <div className="filtros">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="abertos">Em aberto (rascunho e a caminho)</option><option value="recebido">Recebidos</option><option value="cancelado">Cancelados</option><option value="">Todos</option>
        </select>
      </div>
      {(carregando || base.carregando) && <Carregando />}
      <Aviso tipo="erro">{erro || base.erro}</Aviso>
      {pedidos && base.dados && (pedidos.length === 0 ? <Vazio>Nenhum pedido.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>#</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th className="num">Total</th><th>Chegada</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pedidos.map((p) => {
                const atrasado = p.status === 'enviado' && p.previsao_chegada && p.previsao_chegada < hojeISO()
                return (
                  <tr key={p.id}>
                    <td>{p.id}{p.numero_externo && <div className="dica">{p.numero_externo}</div>}</td>
                    <td>{dataBR(p.data_pedido + 'T12:00')}</td>
                    <td>{p.fornecedores?.nome}</td>
                    <td>{p.pedido_compra_itens.map((i) => `${numero(i.quantidade)}× ${base.dados.produtos.find((x) => x.id === i.produto_id)?.sku || '?'}`).join(', ')}</td>
                    <td className="num">{moeda(total(p))}{p.parcelas > 1 && <div className="dica">{p.parcelas}x {p.forma_pagamento}</div>}</td>
                    <td className={atrasado ? 'neg' : ''}>{p.status === 'recebido' ? `recebido ${dataBR(p.data_recebimento + 'T12:00')}` : p.previsao_chegada ? dataBR(p.previsao_chegada + 'T12:00') : '—'}{p.rastreio && <div className="dica">{p.rastreio}</div>}</td>
                    <td><Selo tipo={atrasado ? 'aviso' : STATUS[p.status][0]}>{atrasado ? 'atrasado' : STATUS[p.status][1]}</Selo></td>
                    <td><button className="link" onClick={() => setEditando(p)}>{p.status === 'recebido' ? 'ver' : 'abrir'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      {editando && base.dados && <FormPedido pedido={editando} base={base.dados} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); recarregar() }} />}
    </Pagina>
  )
}

function FormPedido({ pedido, base, onFechar, onSalvo }) {
  const novo = !pedido.id
  const [p, setP] = useState({
    fornecedor_id: base.fornecedores[0]?.id, status: 'rascunho', data_pedido: hojeISO(), previsao_chegada: '', local_id: base.locais.find((l) => l.padrao)?.id,
    frete: 0, imposto_importacao: 0, icms: 0, iof: 0, outras_despesas: 0, forma_pagamento: '', parcelas: 1, primeiro_vencimento: '', rastreio: '', observacao: '', ...pedido,
  })
  const [itens, setItens] = useState((pedido.pedido_compra_itens || []).map((i) => ({ ...i })).concat(novo ? [{ produto_id: '', quantidade: 1, custo_unitario: 0 }] : []))
  const [dataReceb, setDataReceb] = useState(hojeISO())
  const acao = useAcao()
  const ro = p.status === 'recebido' || p.status === 'cancelado'
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))
  const subtotal = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.custo_unitario) || 0), 0)
  const extras = EXTRAS.reduce((s, [k]) => s + (Number(p[k]) || 0), 0)
  const forn = base.fornecedores.find((f) => f.id === Number(p.fornecedor_id))

  async function salvar(novoStatus) {
    return acao.executar(async () => {
      const its = itens.filter((i) => i.produto_id && i.quantidade > 0)
      if (!its.length) throw new Error('Adicione pelo menos um item.')
      const status = novoStatus || p.status
      const prev = p.previsao_chegada || (status === 'enviado' && forn ? new Date(new Date(p.data_pedido).getTime() + forn.prazo_entrega_dias * 864e5).toISOString().slice(0, 10) : null)
      const campos = {
        fornecedor_id: Number(p.fornecedor_id), status, data_pedido: p.data_pedido, previsao_chegada: prev || null, local_id: p.local_id || null,
        frete: p.frete || 0, imposto_importacao: p.imposto_importacao || 0, icms: p.icms || 0, iof: p.iof || 0, outras_despesas: p.outras_despesas || 0,
        forma_pagamento: p.forma_pagamento || null, parcelas: Number(p.parcelas) || 1, primeiro_vencimento: p.primeiro_vencimento || null,
        rastreio: p.rastreio || null, observacao: p.observacao || null,
      }
      let id = p.id
      if (novo) {
        id = ok(await supabase.rpc('criar_pedido_compra', { p: { ...campos, itens: its.map((i) => ({ produto_id: Number(i.produto_id), quantidade: i.quantidade, custo_unitario: i.custo_unitario || 0 })) } }))
      } else {
        ok(await supabase.from('pedidos_compra').update(campos).eq('id', id))
        ok(await supabase.from('pedido_compra_itens').delete().eq('pedido_id', id))
        ok(await supabase.from('pedido_compra_itens').insert(its.map((i) => ({
          pedido_id: id, produto_id: Number(i.produto_id), quantidade: i.quantidade, custo_unitario: i.custo_unitario || 0,
          descricao_externa: i.descricao_externa || null, variacao_externa: i.variacao_externa || null, preco_original: i.preco_original ?? null,
        }))))
        ok(await supabase.rpc('gerar_contas_pagar', { p_pedido_id: id }))
      }
      return id
    })
  }

  async function receber() {
    const id = await salvar()
    if (!id) return
    await acao.executar(async () => {
      ok(await supabase.rpc('receber_pedido_compra', { p_pedido_id: id, p_data: dataReceb, p_local_id: p.local_id || null }))
      onSalvo()
    })
  }

  return (
    <Modal titulo={novo ? 'Novo pedido de compra' : `Pedido #${p.id}${p.numero_externo ? ' — ' + p.numero_externo : ''}`} onFechar={onFechar} largura={900}>
      <div className="form">
        <div className="linha">
          <Campo rotulo="Fornecedor"><select value={p.fornecedor_id} onChange={set('fornecedor_id')} disabled={ro}>{base.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Campo>
          <Campo rotulo="Data do pedido"><input type="date" value={p.data_pedido} onChange={set('data_pedido')} disabled={ro} /></Campo>
          <Campo rotulo="Previsão de chegada" dica={forn ? `vazio = +${forn.prazo_entrega_dias} dias` : null}><input type="date" value={p.previsao_chegada || ''} onChange={set('previsao_chegada')} disabled={ro} /></Campo>
          <Campo rotulo="Entra no local"><select value={p.local_id || ''} onChange={(e) => set('local_id')(Number(e.target.value))} disabled={ro}>{base.locais.filter((l) => l.ativo).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></Campo>
        </div>
        <fieldset>
          <legend>Itens (custo unitário em R$, sem frete e impostos)</legend>
          {itens.map((it, i) => {
            const up = (k, v) => setItens((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
            return (
              <div className="linha" key={i}>
                <select style={{ flex: 1 }} value={it.produto_id} disabled={ro} onChange={(e) => {
                  const prod = base.produtos.find((x) => x.id === Number(e.target.value))
                  setItens((l) => l.map((x, j) => (j === i ? { ...x, produto_id: Number(e.target.value), custo_unitario: x.custo_unitario || Number(prod?.custo_medio) || 0 } : x)))
                }}>
                  <option value="">Produto…</option>
                  {base.produtos.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.sku} — {x.nome}{x.tipo === 'kit' ? ' (kit: entra como peças)' : ''}</option>)}
                </select>
                <Num casas={0} style={{ width: 80 }} value={it.quantidade} disabled={ro} onChange={(v) => up('quantidade', v || 0)} title="Quantidade" />
                <Num style={{ width: 100 }} value={it.custo_unitario} disabled={ro} onChange={(v) => up('custo_unitario', v || 0)} title="Custo unitário" />
                <span className="num" style={{ width: 100 }}>{moeda(it.quantidade * it.custo_unitario)}</span>
                {it.descricao_externa && <small className="dica" title={it.descricao_externa}>AliExpress</small>}
                {!ro && <button className="link" onClick={() => setItens((l) => l.filter((_, j) => j !== i))}>remover</button>}
              </div>
            )
          })}
          {!ro && <button className="botao" onClick={() => setItens([...itens, { produto_id: '', quantidade: 1, custo_unitario: 0 }])}>+ Item</button>}
        </fieldset>
        <fieldset>
          <legend>Custos extras do pedido (R$) — rateados pelo valor de cada item</legend>
          <div className="linha">
            {EXTRAS.map(([k, rot]) => <Campo key={k} rotulo={rot}><Num value={p[k]} disabled={ro} onChange={set(k)} /></Campo>)}
          </div>
          <p>Produtos <b>{moeda(subtotal)}</b> + extras <b>{moeda(extras)}</b> = <b>{moeda(subtotal + extras)}</b>
            {subtotal > 0 && <> · extras = {numero((extras / subtotal) * 100, 1)}% sobre o valor</>}</p>
        </fieldset>
        <fieldset>
          <legend>Pagamento (gera as parcelas em Contas a pagar)</legend>
          <div className="linha">
            <Campo rotulo="Forma"><select value={p.forma_pagamento || ''} onChange={set('forma_pagamento')} disabled={ro}>
              <option value="">— não lançar —</option><option value="cartao">Cartão de crédito</option><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option>
            </select></Campo>
            <Campo rotulo="Parcelas"><Num casas={0} value={p.parcelas} onChange={set('parcelas')} disabled={ro} /></Campo>
            <Campo rotulo="1º vencimento" dica="Ex.: vencimento da fatura do cartão"><input type="date" value={p.primeiro_vencimento || ''} onChange={set('primeiro_vencimento')} disabled={ro} /></Campo>
            <Campo rotulo="Rastreio"><input value={p.rastreio || ''} onChange={set('rastreio')} disabled={ro} /></Campo>
          </div>
        </fieldset>
        <Campo rotulo="Observação"><textarea rows={2} value={p.observacao || ''} onChange={set('observacao')} disabled={ro} /></Campo>
        <Mensagens acao={acao} />
        {!ro && (
          <div className="acoes-form">
            {!novo && <button className="botao perigo" onClick={() => confirm('Cancelar este pedido?') && acao.executar(async () => {
              ok(await supabase.from('pedidos_compra').update({ status: 'cancelado' }).eq('id', p.id)); ok(await supabase.rpc('gerar_contas_pagar', { p_pedido_id: p.id })); onSalvo()
            })}>Cancelar pedido</button>}
            <span style={{ flex: 1 }} />
            <button className="botao" disabled={acao.ocupado} onClick={async () => (await salvar()) && onSalvo()}>Salvar</button>
            {p.status === 'rascunho' && <button className="botao" disabled={acao.ocupado} onClick={async () => (await salvar('enviado')) && onSalvo()}>Marcar como enviado</button>}
            {!novo && (
              <span className="linha-inline">
                <input type="date" value={dataReceb} onChange={(e) => setDataReceb(e.target.value)} title="Data do recebimento" />
                <button className="botao primario" disabled={acao.ocupado} onClick={() => confirm('Confirmar recebimento? As peças entram no estoque e o custo médio é recalculado.') && receber()}>Marcar como recebido</button>
              </span>
            )}
          </div>
        )}
        {ro && <Aviso tipo="info">Pedido {p.status}. {p.status === 'recebido' && 'O estoque e o custo médio já foram atualizados.'}</Aviso>}
      </div>
    </Modal>
  )
}
