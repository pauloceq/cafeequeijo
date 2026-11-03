import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Aviso, Campo, Carregando, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { dataHoraBR, hojeISO, moeda, numero } from '../lib/formato'

const STATUS = { concluida: ['ok', 'concluída'], cancelada: ['neutro', 'cancelada'], devolvida: ['aviso', 'devolvida'] }

export default function Vendas() {
  const { ehDono } = useAuth()
  const [filtro, setFiltro] = useState({ de: hojeISO().slice(0, 8) + '01', ate: hojeISO(), conta: '', status: '' })
  const [nova, setNova] = useState(false)
  const [cancelando, setCancelando] = useState(null)
  const base = useDados(() => carregarBase({ locais: true }))
  const { dados: vendas, erro, carregando, recarregar } = useDados(async () => {
    let q = supabase.from('vw_vendas').select('*')
      .gte('data', `${filtro.de}T00:00:00-03:00`).lte('data', `${filtro.ate}T23:59:59-03:00`)
      .order('data', { ascending: false }).limit(1000)
    if (filtro.conta) q = q.eq('conta_id', Number(filtro.conta))
    if (filtro.status) q = q.eq('status', filtro.status)
    return ok(await q)
  }, [filtro])

  const tot = (vendas || []).filter((v) => v.status === 'concluida').reduce((t, v) => ({
    n: t.n + 1, receita: t.receita + Number(v.receita), taxa: t.taxa + Number(v.taxa_marketplace), frete: t.frete + Number(v.frete), lucro: t.lucro + Number(v.lucro),
  }), { n: 0, receita: 0, taxa: 0, frete: 0, lucro: 0 })

  return (
    <Pagina titulo="Vendas" acoes={<>
      <Link to="/importar-vendas" className="botao">📥 Importar planilha</Link>
      <button className="botao primario" onClick={() => setNova(true)}>+ Lançar venda</button>
    </>}>
      <div className="filtros">
        <label>De <input type="date" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} /></label>
        <label>Até <input type="date" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} /></label>
        <select value={filtro.conta} onChange={(e) => setFiltro({ ...filtro, conta: e.target.value })}>
          <option value="">Todas as contas</option>
          {base.dados?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })}>
          <option value="">Todos os status</option><option value="concluida">Concluídas</option><option value="cancelada">Canceladas</option><option value="devolvida">Devolvidas</option>
        </select>
      </div>
      <div className="numeros">
        <div className="numero"><span>Vendas</span><b>{tot.n}</b></div>
        <div className="numero"><span>Faturamento</span><b>{moeda(tot.receita)}</b></div>
        {ehDono && <div className="numero"><span>Tarifas + frete</span><b>{moeda(tot.taxa + tot.frete)}</b></div>}
        {ehDono && <div className="numero"><span>Lucro</span><b className={tot.lucro < 0 ? 'neg' : ''}>{moeda(tot.lucro)}</b></div>}
      </div>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {vendas && (vendas.length === 0 ? <Vazio>Nenhuma venda no período.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Data</th><th>Conta</th><th>Pedido</th><th>Itens</th><th className="num">Receita</th>{ehDono && <><th className="num">Tarifas</th><th className="num">Frete</th><th className="num">Lucro</th></>}<th>Status</th><th /></tr></thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id} className={v.status !== 'concluida' ? 'inativo' : ''}>
                  <td>{dataHoraBR(v.data)}</td><td>{v.conta_nome}</td>
                  <td>{v.codigo_externo || `#${v.id}`}<div className="dica">{v.origem === 'api' ? 'API' : v.origem === 'importacao' ? 'planilha' : v.origem === 'historico' ? 'histórico' : 'manual'}{v.envio?.rastreio ? ` · rastreio ${v.envio.rastreio}` : ''}</div></td>
                  <td>{v.itens_resumo}</td>
                  <td className="num">{moeda(v.receita)}</td>
                  {ehDono && <>
                    <td className="num">{moeda(v.taxa_marketplace)}</td><td className="num">{moeda(v.frete)}</td>
                    <td className={`num ${v.lucro < 0 ? 'neg' : ''}`}>{moeda(v.lucro)}</td>
                  </>}
                  <td><Selo tipo={STATUS[v.status][0]}>{STATUS[v.status][1]}</Selo></td>
                  <td>{ehDono && v.status === 'concluida' && <button className="link" onClick={() => setCancelando(v)}>cancelar/devolver</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {nova && base.dados && <NovaVenda base={base.dados} onFechar={() => setNova(false)} onSalvo={() => { setNova(false); recarregar() }} />}
      {cancelando && <Cancelar venda={cancelando} onFechar={() => setCancelando(null)} onSalvo={() => { setCancelando(null); recarregar() }} />}
    </Pagina>
  )
}

function NovaVenda({ base, onFechar, onSalvo }) {
  const [v, setV] = useState({ conta_id: base.contas[0]?.id, data: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16), codigo_externo: '', comprador: '', taxa_marketplace: null, frete: null, local_id: '' })
  const [itens, setItens] = useState([{ produto_id: '', quantidade: 1, preco_unitario: null }])
  const acao = useAcao()
  const produtos = base.produtos.filter((p) => p.ativo)

  async function salvar() {
    await acao.executar(async () => {
      const its = itens.filter((i) => i.produto_id && i.quantidade > 0)
      if (!its.length) throw new Error('Adicione pelo menos um produto.')
      const id = ok(await supabase.rpc('registrar_venda', {
        p_venda: {
          ...v, data: new Date(v.data + ':00-03:00').toISOString(), local_id: v.local_id || null,
          usar_taxa_prevista: v.taxa_marketplace === null,
          taxa_marketplace: v.taxa_marketplace ?? 0, frete: v.frete ?? 0,
          itens: its.map((i) => ({ produto_id: Number(i.produto_id), quantidade: i.quantidade, preco_unitario: i.preco_unitario || 0 })),
        },
      }))
      if (id === null) throw new Error('Já existe uma venda com esse número de pedido nessa conta.')
      onSalvo()
    })
  }

  return (
    <Modal titulo="Lançar venda" onFechar={onFechar} largura={760}>
      <div className="form">
        <div className="linha">
          <Campo rotulo="Conta"><select value={v.conta_id} onChange={(e) => setV({ ...v, conta_id: Number(e.target.value) })}>{base.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
          <Campo rotulo="Data e hora"><input type="datetime-local" value={v.data} onChange={(e) => setV({ ...v, data: e.target.value })} /></Campo>
          <Campo rotulo="Nº do pedido no marketplace" dica="Evita lançar duas vezes"><input value={v.codigo_externo} onChange={(e) => setV({ ...v, codigo_externo: e.target.value })} /></Campo>
        </div>
        <fieldset>
          <legend>Produtos (kits baixam as peças automaticamente)</legend>
          {itens.map((it, i) => {
            const prod = produtos.find((p) => p.id === Number(it.produto_id))
            const up = (k, val) => setItens((l) => l.map((x, j) => (j === i ? { ...x, [k]: val } : x)))
            return (
              <div className="linha" key={i}>
                <select style={{ flex: 1 }} value={it.produto_id} onChange={(e) => {
                  const p = produtos.find((x) => x.id === Number(e.target.value))
                  setItens((l) => l.map((x, j) => (j === i ? { ...x, produto_id: e.target.value, preco_unitario: x.preco_unitario ?? (Number(p?.preco_venda) || null) } : x)))
                }}>
                  <option value="">Produto…</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome} {p.tipo === 'kit' ? '(kit)' : ''} · disp. {numero(p.disponivel)}</option>)}
                </select>
                <Num casas={0} style={{ width: 70 }} value={it.quantidade} onChange={(val) => up('quantidade', val || 0)} title="Quantidade" />
                <Num style={{ width: 100 }} value={it.preco_unitario} onChange={(val) => up('preco_unitario', val)} placeholder="Preço un." />
                {prod && Number(prod.disponivel) < it.quantidade && <Selo tipo="aviso">estoque insuficiente</Selo>}
                <button className="link" onClick={() => setItens((l) => l.filter((_, j) => j !== i))}>remover</button>
              </div>
            )
          })}
          <button className="botao" onClick={() => setItens([...itens, { produto_id: '', quantidade: 1, preco_unitario: null }])}>+ Produto</button>
        </fieldset>
        <div className="linha">
          <Campo rotulo="Tarifas do marketplace (R$)" dica="Vazio = calcula pela tabela de tarifas"><Num value={v.taxa_marketplace} onChange={(x) => setV({ ...v, taxa_marketplace: x })} /></Campo>
          <Campo rotulo="Frete pago por você (R$)"><Num value={v.frete} onChange={(x) => setV({ ...v, frete: x })} /></Campo>
          <Campo rotulo="Baixar do local">
            <select value={v.local_id} onChange={(e) => setV({ ...v, local_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">Local padrão</option>{base.locais.filter((l) => l.ativo).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </Campo>
        </div>
        <Campo rotulo="Comprador (opcional)"><input value={v.comprador} onChange={(e) => setV({ ...v, comprador: e.target.value })} /></Campo>
        <Mensagens acao={acao} />
        <div className="acoes-form"><span style={{ flex: 1 }} /><button className="botao" onClick={onFechar}>Cancelar</button><button className="botao primario" disabled={acao.ocupado} onClick={salvar}>Salvar venda</button></div>
      </div>
    </Modal>
  )
}

function Cancelar({ venda, onFechar, onSalvo }) {
  const [status, setStatus] = useState('cancelada')
  const [volta, setVolta] = useState(true)
  const acao = useAcao()
  return (
    <Modal titulo={`Venda ${venda.codigo_externo || '#' + venda.id}`} onFechar={onFechar}>
      <div className="form">
        <p>{venda.itens_resumo} — {moeda(venda.receita)}</p>
        <Campo rotulo="O que aconteceu?">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="cancelada">Cancelada (não foi enviada)</option>
            <option value="devolvida">Devolvida pelo cliente</option>
          </select>
        </Campo>
        <label className="check"><input type="checkbox" checked={volta} onChange={(e) => setVolta(e.target.checked)} /> Os produtos voltam para o estoque (desmarque se vieram estragados)</label>
        <Mensagens acao={acao} />
        <div className="acoes-form"><span style={{ flex: 1 }} /><button className="botao" onClick={onFechar}>Voltar</button>
          <button className="botao perigo" disabled={acao.ocupado} onClick={() => acao.executar(async () => {
            ok(await supabase.rpc('cancelar_venda', { p_venda_id: venda.id, p_status: status, p_volta_estoque: volta })); onSalvo()
          })}>Confirmar</button>
        </div>
      </div>
    </Modal>
  )
}
