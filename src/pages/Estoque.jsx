import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Abas, Aviso, Campo, Carregando, Cartao, Mensagens, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { dataHoraBR, moeda, MOTIVOS, normalizar, numero } from '../lib/formato'

const TIPOS_MOV = {
  venda: 'Venda', cancelamento_venda: 'Venda cancelada', devolucao: 'Devolução', compra: 'Compra recebida',
  ajuste: 'Ajuste', transferencia: 'Transferência', inicial: 'Estoque inicial', ajuste_custo: 'Custo alterado',
}

export default function Estoque() {
  const { ehDono } = useAuth()
  const [aba, setAba] = useState('locais')
  const [busca, setBusca] = useState('')
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const base = await carregarBase({ locais: true })
    const est = await supabase.from('estoque_locais').select('*').then(ok)
    return { ...base, est }
  })

  return (
    <Pagina titulo="Estoque" subtitulo="Estoque REAL das peças, por local. Kits não têm estoque próprio: usam as peças.">
      <Abas abas={[['locais', 'Por local'], ['ajuste', 'Ajustar / transferir'], ['mov', 'Movimentações']]} ativa={aba} onTrocar={setAba} />
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {dados && aba === 'locais' && <PorLocal dados={dados} ehDono={ehDono} busca={busca} setBusca={setBusca} recarregar={recarregar} />}
      {dados && aba === 'ajuste' && <Ajustes dados={dados} ehDono={ehDono} recarregar={recarregar} />}
      {dados && aba === 'mov' && <Movimentos dados={dados} />}
    </Pagina>
  )
}

function PorLocal({ dados, ehDono, busca, setBusca, recarregar }) {
  const { produtos, locais, est } = dados
  const pecas = produtos.filter((p) => p.tipo === 'peca' && (!busca || normalizar(`${p.sku} ${p.nome}`).includes(normalizar(busca))))
  const acao = useAcao()
  const qtd = (pid, lid) => est.find((e) => e.produto_id === pid && e.local_id === lid)
  const valorLocal = (lid) => est.filter((e) => e.local_id === lid)
    .reduce((s, e) => s + Number(e.quantidade) * Number(produtos.find((p) => p.id === e.produto_id)?.custo_medio || 0), 0)

  async function salvarLocalizacao(pid, lid, texto) {
    await acao.executar(async () => {
      ok(await supabase.from('estoque_locais').upsert({ produto_id: pid, local_id: lid, localizacao: texto || null }, { onConflict: 'produto_id,local_id' }))
      recarregar()
    }, 'Localização salva.')
  }

  return (
    <>
      {ehDono && (
        <div className="numeros">
          {locais.filter((l) => l.ativo).map((l) => (
            <div className="numero" key={l.id}><span>Valor em estoque — {l.nome}</span><b>{moeda(valorLocal(l.id))}</b><small>pelo custo médio</small></div>
          ))}
          <div className="numero"><span>Total</span><b>{moeda(locais.reduce((s, l) => s + valorLocal(l.id), 0))}</b></div>
        </div>
      )}
      <Mensagens acao={acao} />
      <div className="filtros"><input placeholder="Buscar peça…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {!pecas.length ? <Vazio>Nenhuma peça cadastrada.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>SKU</th><th>Peça</th>
                {locais.filter((l) => l.ativo).map((l) => <th key={l.id} className="num">{l.nome}{l.padrao ? ' ★' : ''}</th>)}
                <th className="num">Total</th><th className="num">Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {pecas.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.sku}</b></td><td>{p.nome}</td>
                  {locais.filter((l) => l.ativo).map((l) => {
                    const e = qtd(p.id, l.id)
                    return (
                      <td key={l.id} className="num">
                        {numero(e?.quantidade || 0)}
                        {ehDono ? (
                          <input className="mini" defaultValue={e?.localizacao || ''} placeholder="localização"
                            onBlur={(ev) => ev.target.value !== (e?.localizacao || '') && salvarLocalizacao(p.id, l.id, ev.target.value)} />
                        ) : e?.localizacao && <div className="dica">{e.localizacao}</div>}
                      </td>
                    )
                  })}
                  <td className={`num ${Number(p.estoque_real) <= Number(p.estoque_minimo) ? 'neg' : ''}`}><b>{numero(p.estoque_real)}</b></td>
                  <td className="num">{numero(p.estoque_minimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dica">★ = local de onde as vendas baixam o estoque. Cadastre locais em Configurações.</p>
    </>
  )
}

function Ajustes({ dados, ehDono, recarregar }) {
  const pecas = dados.produtos.filter((p) => p.tipo === 'peca' && p.ativo)
  const locais = dados.locais.filter((l) => l.ativo)
  const padrao = locais.find((l) => l.padrao)?.id || locais[0]?.id
  const [f, setF] = useState({ produto_id: '', local_id: padrao, operacao: 'saida', quantidade: null, motivo: 'perda', observacao: '' })
  const [t, setT] = useState({ produto_id: '', de: padrao, para: locais.find((l) => l.id !== padrao)?.id, quantidade: null })
  const acao = useAcao()
  const atual = dados.est.find((e) => e.produto_id === Number(f.produto_id) && e.local_id === Number(f.local_id))?.quantidade || 0

  async function ajustar(e) {
    e.preventDefault()
    await acao.executar(async () => {
      if (!f.produto_id) throw new Error('Escolha a peça.')
      if (f.quantidade === null) throw new Error('Informe a quantidade.')
      const novo = ok(await supabase.rpc('ajustar_estoque', {
        p_produto_id: Number(f.produto_id), p_local_id: Number(f.local_id), p_operacao: f.operacao,
        p_quantidade: f.quantidade, p_motivo: f.motivo, p_observacao: f.observacao || null,
      }))
      setF((x) => ({ ...x, quantidade: null, observacao: '' }))
      recarregar()
      return novo
    }, (novo) => `Ajuste feito. Novo saldo neste local: ${numero(novo)}.`)
  }

  async function transferir(e) {
    e.preventDefault()
    await acao.executar(async () => {
      if (!t.produto_id || !t.quantidade) throw new Error('Escolha a peça e a quantidade.')
      ok(await supabase.rpc('transferir_estoque', { p_produto_id: Number(t.produto_id), p_de: Number(t.de), p_para: Number(t.para), p_quantidade: t.quantidade }))
      setT((x) => ({ ...x, quantidade: null }))
      recarregar()
    }, 'Transferência feita.')
  }

  const selPeca = (val, on) => (
    <select value={val} onChange={(e) => on(e.target.value)}>
      <option value="">Escolha a peça…</option>
      {pecas.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome}</option>)}
    </select>
  )
  const selLocal = (val, on) => (
    <select value={val} onChange={(e) => on(Number(e.target.value))}>{locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
  )

  return (
    <div className="grade-2">
      <Cartao titulo="Ajuste manual">
        <form className="form" onSubmit={ajustar}>
          <Campo rotulo="Peça">{selPeca(f.produto_id, (v) => setF({ ...f, produto_id: v }))}</Campo>
          <div className="linha">
            <Campo rotulo="Local">{selLocal(f.local_id, (v) => setF({ ...f, local_id: v }))}</Campo>
            <Campo rotulo="Operação">
              <select value={f.operacao} onChange={(e) => setF({ ...f, operacao: e.target.value, motivo: e.target.value === 'definir' ? 'inventario' : f.motivo })}>
                <option value="saida">Saída (perda, vencimento…)</option>
                <option value="entrada">Entrada</option>
                <option value="definir">Inventário: informar contagem</option>
              </select>
            </Campo>
          </div>
          <div className="linha">
            <Campo rotulo={f.operacao === 'definir' ? 'Quantidade contada' : 'Quantidade'} dica={f.produto_id ? `Saldo atual neste local: ${numero(atual)}` : null}>
              <Num casas={0} value={f.quantidade} onChange={(v) => setF({ ...f, quantidade: v })} />
            </Campo>
            <Campo rotulo="Motivo">
              <select value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })}>
                {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                {ehDono && <option value="inicial">Estoque inicial</option>}
              </select>
            </Campo>
          </div>
          <Campo rotulo="Observação"><input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Ex.: caiu e quebrou" /></Campo>
          <button className="botao primario" disabled={acao.ocupado}>Registrar ajuste</button>
        </form>
      </Cartao>
      <Cartao titulo="Transferir entre locais">
        {locais.length < 2 ? <Vazio>Cadastre mais de um local em Configurações para transferir.</Vazio> : (
          <form className="form" onSubmit={transferir}>
            <Campo rotulo="Peça">{selPeca(t.produto_id, (v) => setT({ ...t, produto_id: v }))}</Campo>
            <div className="linha">
              <Campo rotulo="De">{selLocal(t.de, (v) => setT({ ...t, de: v }))}</Campo>
              <Campo rotulo="Para">{selLocal(t.para, (v) => setT({ ...t, para: v }))}</Campo>
              <Campo rotulo="Quantidade"><Num casas={0} value={t.quantidade} onChange={(v) => setT({ ...t, quantidade: v })} /></Campo>
            </div>
            <button className="botao primario" disabled={acao.ocupado}>Transferir</button>
          </form>
        )}
      </Cartao>
      <div style={{ gridColumn: '1 / -1' }}><Mensagens acao={acao} /></div>
    </div>
  )
}

function Movimentos({ dados }) {
  const [produto, setProduto] = useState('')
  const [tipo, setTipo] = useState('')
  const { dados: movs, erro, carregando } = useDados(async () => {
    let q = supabase.from('movimentos_estoque').select('*').order('criado_em', { ascending: false }).limit(300)
    if (produto) q = q.eq('produto_id', Number(produto))
    if (tipo) q = q.eq('tipo', tipo)
    return ok(await q)
  }, [produto, tipo])
  const nomes = useMemo(() => Object.fromEntries(dados.produtos.map((p) => [p.id, p.sku])), [dados])
  const locais = Object.fromEntries(dados.locais.map((l) => [l.id, l.nome]))
  return (
    <>
      <div className="filtros">
        <select value={produto} onChange={(e) => setProduto(e.target.value)}>
          <option value="">Todas as peças</option>
          {dados.produtos.filter((p) => p.tipo === 'peca').map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome}</option>)}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {movs && (movs.length === 0 ? <Vazio>Nenhuma movimentação.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela compacta">
            <thead><tr><th>Quando</th><th>SKU</th><th>Tipo</th><th>Local</th><th className="num">Qtd</th><th className="num">Saldo total</th><th>Motivo / obs.</th></tr></thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td>{dataHoraBR(m.criado_em)}</td><td>{nomes[m.produto_id]}</td>
                  <td><Selo tipo={m.quantidade < 0 ? 'neg' : m.quantidade > 0 ? 'ok' : 'neutro'}>{TIPOS_MOV[m.tipo] || m.tipo}</Selo></td>
                  <td>{locais[m.local_id] || ''}</td>
                  <td className={`num ${m.quantidade < 0 ? 'neg' : ''}`}>{m.quantidade > 0 ? '+' : ''}{numero(m.quantidade)}</td>
                  <td className="num">{m.saldo_apos !== null ? numero(m.saldo_apos) : ''}</td>
                  <td>{[MOTIVOS[m.motivo], m.observacao, m.venda_id && `venda #${m.venda_id}`, m.pedido_compra_id && `compra #${m.pedido_compra_id}`].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
