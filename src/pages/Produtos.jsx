import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Aviso, Campo, Carregando, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase, proximoSku } from '../lib/base'
import { moeda, normalizar, numero } from '../lib/formato'

const VAZIO = {
  sku: '', nome: '', tipo: 'peca', categoria: '', unidade: 'un', estoque_minimo: 0, preco_venda: 0,
  margem_alvo_pct: null, custo_embalagem: null, fornecedor_id: null, prazo_entrega_dias: null, ativo: true, observacao: '',
}

export default function Produtos() {
  const { ehDono } = useAuth()
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('')
  const [editando, setEditando] = useState(null)
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const base = await carregarBase({ produtoConta: true })
    const [kits, fornecedores] = await Promise.all([
      supabase.from('kit_componentes').select('*').then(ok),
      supabase.from('fornecedores').select('id,nome').order('nome').then(ok),
    ])
    return { ...base, kits, fornecedores }
  })

  const lista = useMemo(() => {
    if (!dados) return []
    const b = normalizar(busca)
    return dados.produtos.filter((p) => (!tipo || p.tipo === tipo) && (!b || normalizar(`${p.sku} ${p.nome} ${p.categoria}`).includes(b)))
  }, [dados, busca, tipo])

  return (
    <Pagina
      titulo="Produtos e kits"
      subtitulo="O estoque é controlado só nas PEÇAS. Kits têm uma lista de peças: custo e disponibilidade são calculados sozinhos."
      acoes={ehDono && <button className="botao primario" onClick={() => setEditando({ ...VAZIO })}>+ Novo produto</button>}
    >
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {dados && (
        <>
          <div className="filtros">
            <input placeholder="Buscar por SKU, nome ou categoria…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Peças e kits</option><option value="peca">Só peças</option><option value="kit">Só kits</option>
            </select>
          </div>
          {lista.length === 0 ? <Vazio>Nenhum produto. {ehDono && 'Clique em “+ Novo produto” ou use a Importação inicial.'}</Vazio> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr><th>SKU</th><th>Produto</th><th>Tipo</th>{ehDono && <th className="num">Custo</th>}<th className="num">Disponível</th><th className="num">Mínimo</th><th className="num">Preço padrão</th><th /></tr>
                </thead>
                <tbody>
                  {lista.map((p) => {
                    const pecas = dados.kits.filter((k) => k.kit_id === p.id)
                    return (
                      <tr key={p.id} className={p.ativo ? '' : 'inativo'}>
                        <td><b>{p.sku}</b></td>
                        <td>
                          {p.nome}
                          {p.tipo === 'kit' && (
                            <div className="dica">
                              {pecas.length ? pecas.map((k) => `${numero(k.quantidade)}× ${dados.produtos.find((x) => x.id === k.peca_id)?.sku}`).join(' + ')
                                : <span className="neg">sem lista de peças!</span>}
                            </div>
                          )}
                        </td>
                        <td>{p.tipo === 'kit' ? <Selo tipo="info">kit</Selo> : <Selo>peça</Selo>}</td>
                        {ehDono && <td className="num">{moeda(p.custo)}</td>}
                        <td className={`num ${p.tipo === 'peca' && Number(p.estoque_real) <= Number(p.estoque_minimo) ? 'neg' : ''}`}>{numero(p.disponivel)}</td>
                        <td className="num">{p.tipo === 'peca' ? numero(p.estoque_minimo) : '—'}</td>
                        <td className="num">{moeda(p.preco_venda)}</td>
                        <td><button className="link" onClick={() => setEditando(p)}>{ehDono ? 'Editar' : 'Ver'}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editando && (
        <FormProduto produto={editando} dados={dados} ehDono={ehDono}
          onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); recarregar() }} />
      )}
    </Pagina>
  )
}

function FormProduto({ produto, dados, ehDono, onFechar, onSalvo }) {
  const [p, setP] = useState({ ...VAZIO, ...produto })
  const [prefixo, setPrefixo] = useState('')
  const [pecas, setPecas] = useState(
    dados.kits.filter((k) => k.kit_id === produto.id).map((k) => ({ peca_id: k.peca_id, quantidade: Number(k.quantidade) })))
  const [porConta, setPorConta] = useState(() => Object.fromEntries(dados.contas.map((c) => {
    const pc = dados.produtoConta.find((x) => x.produto_id === produto.id && x.conta_id === c.id)
    return [c.id, { quantidade_anuncio: pc?.quantidade_anuncio ?? 0, preco: pc?.preco ?? null, comissao_pct: pc?.comissao_pct ?? null, ads_pct: pc?.ads_pct ?? null, ativo: pc?.ativo ?? true }]
  })))
  const [novoCusto, setNovoCusto] = useState(null)
  const [mesclarCom, setMesclarCom] = useState('')
  const acao = useAcao()
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }))
  const pecasDisponiveis = dados.produtos.filter((x) => x.tipo === 'peca' && x.id !== p.id)
  const custoKit = pecas.reduce((s, k) => s + k.quantidade * Number(dados.produtos.find((x) => x.id === Number(k.peca_id))?.custo_medio || 0), 0)

  async function salvar() {
    await acao.executar(async () => {
      if (!p.sku.trim() || !p.nome.trim()) throw new Error('Preencha SKU e nome.')
      if (p.tipo === 'kit' && !pecas.filter((k) => k.peca_id).length) throw new Error('Um kit precisa de pelo menos uma peça na lista.')
      const campos = {
        sku: p.sku.trim().toUpperCase().replace(/\s+/g, ''), nome: p.nome.trim(), tipo: p.tipo, categoria: p.categoria || null,
        unidade: p.unidade || 'un', estoque_minimo: p.estoque_minimo || 0, preco_venda: p.preco_venda || 0,
        margem_alvo_pct: p.margem_alvo_pct, custo_embalagem: p.custo_embalagem, fornecedor_id: p.fornecedor_id || null,
        prazo_entrega_dias: p.prazo_entrega_dias || null, ativo: !!p.ativo, observacao: p.observacao || null,
      }
      let id = p.id
      if (ehDono) {
        if (id) ok(await supabase.from('produtos').update(campos).eq('id', id))
        else id = ok(await supabase.from('produtos').insert(campos).select('id').single()).id
        if (p.tipo === 'kit') {
          ok(await supabase.from('kit_componentes').delete().eq('kit_id', id))
          const linhas = pecas.filter((k) => k.peca_id && k.quantidade > 0).map((k) => ({ kit_id: id, peca_id: Number(k.peca_id), quantidade: k.quantidade }))
          if (linhas.length) ok(await supabase.from('kit_componentes').insert(linhas))
        }
        if (novoCusto !== null && p.tipo === 'peca') ok(await supabase.rpc('definir_custo', { p_produto_id: id, p_custo: novoCusto, p_obs: 'Custo informado no cadastro' }))
      }
      const linhasConta = Object.entries(porConta).map(([conta_id, v]) => ({
        produto_id: id, conta_id: Number(conta_id), quantidade_anuncio: v.quantidade_anuncio || 0, preco: v.preco,
        comissao_pct: v.comissao_pct, ads_pct: v.ads_pct, ativo: v.ativo, atualizado_em: new Date().toISOString(),
      }))
      ok(await supabase.from('produto_conta').upsert(linhasConta))
      onSalvo()
    })
  }

  async function excluir() {
    if (!confirm(`Excluir ${p.sku}? Se ele já tiver vendas/compras, não será possível — desative em vez de excluir.`)) return
    await acao.executar(async () => { ok(await supabase.from('produtos').delete().eq('id', p.id)); onSalvo() })
  }

  const ro = !ehDono
  return (
    <Modal titulo={p.id ? `${p.sku} — ${p.nome}` : 'Novo produto'} onFechar={onFechar} largura={860}>
      <div className="form">
        <div className="linha">
          <Campo rotulo="Tipo" largura="160px">
            <select value={p.tipo} onChange={set('tipo')} disabled={ro || (p.id && Number(p.estoque_real) !== 0)}>
              <option value="peca">Peça (tem estoque)</option><option value="kit">Kit / pacote</option>
            </select>
          </Campo>
          <Campo rotulo="SKU" largura="200px" dica="Padrão: PREFIXO + número (ex.: FILTRO0031)">
            <input value={p.sku} onChange={set('sku')} disabled={ro} />
          </Campo>
          {!p.id && ehDono && (
            <Campo rotulo="Gerar SKU" largura="220px" dica="Digite o prefixo e clique em gerar">
              <div className="linha-inline">
                <input value={prefixo} onChange={(e) => setPrefixo(e.target.value)} placeholder="FILTRO" style={{ width: 100 }} />
                <button type="button" className="botao" onClick={() => prefixo && setP((x) => ({ ...x, sku: proximoSku(prefixo, dados.produtos) }))}>Gerar</button>
              </div>
            </Campo>
          )}
        </div>
        <Campo rotulo="Nome"><input value={p.nome} onChange={set('nome')} disabled={ro} /></Campo>
        <div className="linha">
          <Campo rotulo="Categoria" largura="200px"><input value={p.categoria || ''} onChange={set('categoria')} disabled={ro} placeholder="Cápsulas, Filtros…" /></Campo>
          {p.tipo === 'peca' && <Campo rotulo="Estoque mínimo" largura="140px"><Num casas={0} value={p.estoque_minimo} onChange={set('estoque_minimo')} disabled={ro} /></Campo>}
          <Campo rotulo="Preço padrão (R$)" largura="150px"><Num value={p.preco_venda} onChange={set('preco_venda')} disabled={ro} /></Campo>
          {ehDono && <Campo rotulo="Margem alvo (%)" largura="140px" dica="vazio = geral"><Num value={p.margem_alvo_pct} onChange={set('margem_alvo_pct')} /></Campo>}
          {ehDono && <Campo rotulo="Embalagem (R$)" largura="140px" dica="vazio = geral"><Num value={p.custo_embalagem} onChange={set('custo_embalagem')} /></Campo>}
        </div>
        {ehDono && (
          <div className="linha">
            <Campo rotulo="Fornecedor principal" largura="260px">
              <select value={p.fornecedor_id || ''} onChange={(e) => set('fornecedor_id')(e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {dados.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Prazo de entrega (dias)" largura="170px" dica="vazio = do fornecedor"><Num casas={0} value={p.prazo_entrega_dias} onChange={set('prazo_entrega_dias')} /></Campo>
            {p.tipo === 'peca' && (
              <Campo rotulo={`Custo médio atual: ${moeda(p.custo_medio)}`} largura="220px" dica="Só para corrigir. O normal é atualizar ao receber compras.">
                <Num value={novoCusto} onChange={setNovoCusto} placeholder="novo custo (opcional)" />
              </Campo>
            )}
            <Campo rotulo="Ativo" largura="80px"><input type="checkbox" checked={!!p.ativo} onChange={set('ativo')} /></Campo>
          </div>
        )}

        {p.tipo === 'kit' && (
          <fieldset>
            <legend>Lista de peças do kit {ehDono && <small>— custo calculado: <b>{moeda(custoKit)}</b></small>}</legend>
            {pecas.map((k, i) => (
              <div className="linha" key={i}>
                <select value={k.peca_id || ''} disabled={ro} onChange={(e) => setPecas((l) => l.map((x, j) => (j === i ? { ...x, peca_id: Number(e.target.value) } : x)))} style={{ flex: 1 }}>
                  <option value="">Escolha a peça…</option>
                  {pecasDisponiveis.map((x) => <option key={x.id} value={x.id}>{x.sku} — {x.nome}</option>)}
                </select>
                <Num casas={0} value={k.quantidade} disabled={ro} style={{ width: 80 }}
                  onChange={(v) => setPecas((l) => l.map((x, j) => (j === i ? { ...x, quantidade: v || 0 } : x)))} />
                {!ro && <button className="link" onClick={() => setPecas((l) => l.filter((_, j) => j !== i))}>remover</button>}
              </div>
            ))}
            {!ro && <button className="botao" onClick={() => setPecas((l) => [...l, { peca_id: null, quantidade: 1 }])}>+ Adicionar peça</button>}
            {!pecasDisponiveis.length && <Aviso tipo="aviso">Cadastre primeiro as peças (tipo “Peça”), depois monte o kit.</Aviso>}
          </fieldset>
        )}

        <fieldset>
          <legend>Por conta: estoque fictício do anúncio, preço e exceções de tarifa</legend>
          <div className="tabela-rolagem">
            <table className="tabela compacta">
              <thead><tr><th>Conta</th><th>Estoque no anúncio</th><th>Preço na conta</th>{ehDono && <th>Comissão % (vazio = tabela)</th>}{ehDono && <th>ADS % (vazio = geral)</th>}<th>Ativo</th></tr></thead>
              <tbody>
                {dados.contas.map((c) => {
                  const v = porConta[c.id]
                  const up = (k) => (val) => setPorConta((x) => ({ ...x, [c.id]: { ...x[c.id], [k]: val } }))
                  return (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td><Num casas={0} value={v.quantidade_anuncio} onChange={up('quantidade_anuncio')} /></td>
                      <td><Num value={v.preco} onChange={up('preco')} disabled={ro} /></td>
                      {ehDono && <td><Num value={v.comissao_pct} onChange={up('comissao_pct')} /></td>}
                      {ehDono && <td><Num value={v.ads_pct} onChange={up('ads_pct')} /></td>}
                      <td><input type="checkbox" checked={v.ativo} disabled={ro} onChange={(e) => up('ativo')(e.target.checked)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <small className="dica">O estoque fictício é só para consulta: não gera alerta, mesmo sendo maior que o estoque real.</small>
        </fieldset>

        {ehDono && <Campo rotulo="Observação"><textarea rows={2} value={p.observacao || ''} onChange={set('observacao')} /></Campo>}
        {ehDono && p.id && (
          <fieldset>
            <legend>É o mesmo produto que outro SKU?</legend>
            <p className="dica">Use quando este SKU existe só por causa de outra loja ou outro anúncio. Vendas, compras, anúncios e estoque passam para o produto escolhido; este SKU vira um apelido (continua reconhecido nas importações) e o cadastro duplicado é apagado.</p>
            <div className="linha">
              <select value={mesclarCom} onChange={(e) => setMesclarCom(e.target.value)}>
                <option value="">Escolha o produto principal…</option>
                {dados.produtos.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.sku} — {x.nome}</option>)}
              </select>
              <button className="botao" disabled={!mesclarCom || acao.ocupado} onClick={() => {
                const alvo = dados.produtos.find((x) => x.id === Number(mesclarCom))
                if (!confirm(`Juntar ${p.sku} em ${alvo.sku}? ${p.sku} será apagado e passará a ser apenas um apelido de ${alvo.sku}.`)) return
                acao.executar(async () => { ok(await supabase.rpc('mesclar_produtos', { p_de: p.id, p_para: alvo.id })); onSalvo() })
              }}>Juntar neste produto</button>
            </div>
          </fieldset>
        )}
        <Mensagens acao={acao} />
        <div className="acoes-form">
          {ehDono && p.id && <button className="botao perigo" onClick={excluir} disabled={acao.ocupado}>Excluir</button>}
          <span style={{ flex: 1 }} />
          <button className="botao" onClick={onFechar}>Cancelar</button>
          <button className="botao primario" onClick={salvar} disabled={acao.ocupado}>{acao.ocupado ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </Modal>
  )
}
