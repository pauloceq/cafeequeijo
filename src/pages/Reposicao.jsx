import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { Aviso, Carregando, Mensagens, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { baixar, gerarCSV } from '../lib/planilha'
import { dataBR, moeda, numero } from '../lib/formato'

export default function Reposicao() {
  const nav = useNavigate()
  const { dados, erro, carregando } = useDados(async () => {
    const base = await carregarBase({ config: true })
    const [consumo, caminho, fornecedores] = await Promise.all([
      supabase.from('vw_consumo_pecas').select('*').then(ok),
      supabase.from('vw_a_caminho').select('*').then(ok),
      supabase.from('fornecedores').select('*').then(ok),
    ])
    return { ...base, consumo, caminho, fornecedores }
  })
  const [dias, setDias] = useState(null)
  const [marcados, setMarcados] = useState({})
  const [qtds, setQtds] = useState({})
  const acao = useAcao()

  const linhas = useMemo(() => {
    if (!dados) return []
    const cfg = dados.config
    const janela = dias || cfg.dias_media_vendas || 30
    return dados.produtos.filter((p) => p.tipo === 'peca' && p.ativo).map((p) => {
      const c = dados.consumo.find((x) => x.produto_id === p.id) || {}
      const saida = Number(c[`saida_${janela}`] || 0)
      const media = saida / janela
      const caminho = dados.caminho.find((x) => x.produto_id === p.id)
      const aCaminho = Number(caminho?.quantidade || 0)
      const forn = dados.fornecedores.find((f) => f.id === p.fornecedor_id)
      const prazo = p.prazo_entrega_dias ?? forn?.prazo_entrega_dias ?? 30
      const estoque = Math.max(0, Number(p.estoque_real))
      const cobertura = media > 0 ? estoque / media : null
      const pontoPedido = Math.ceil(media * (prazo + cfg.dias_seguranca))
      const alvo = Math.max(Math.ceil(media * (prazo + cfg.dias_seguranca + cfg.dias_cobertura_alvo)), Number(p.estoque_minimo))
      const sugerido = Math.max(0, alvo - estoque - aCaminho)
      const comprar = estoque + aCaminho <= Math.max(pontoPedido, Number(p.estoque_minimo)) && sugerido > 0
      return { p, media, saida, aCaminho, chegada: caminho?.proxima_chegada, prazo, estoque, cobertura, pontoPedido, sugerido, comprar, forn }
    }).sort((a, b) => (b.comprar - a.comprar) || ((a.cobertura ?? 1e9) - (b.cobertura ?? 1e9)))
  }, [dados, dias])

  if (carregando) return <Pagina titulo="Reposição"><Carregando /></Pagina>
  if (erro) return <Pagina titulo="Reposição"><Aviso tipo="erro">{erro}</Aviso></Pagina>

  const janela = dias || dados.config.dias_media_vendas
  const selecionados = linhas.filter((l) => marcados[l.p.id] ?? l.comprar)
  const qtd = (l) => qtds[l.p.id] ?? l.sugerido

  async function criarPedidos() {
    await acao.executar(async () => {
      const porFornecedor = {}
      for (const l of selecionados) {
        if (!qtd(l)) continue
        const f = l.p.fornecedor_id || dados.fornecedores.find((x) => x.tipo === 'aliexpress')?.id || dados.fornecedores[0]?.id
        if (!f) throw new Error('Cadastre um fornecedor antes.')
        ;(porFornecedor[f] ||= []).push({ produto_id: l.p.id, quantidade: qtd(l), custo_unitario: Number(l.p.custo_medio) || 0 })
      }
      const ids = []
      for (const [fornecedor_id, itens] of Object.entries(porFornecedor)) {
        ids.push(ok(await supabase.rpc('criar_pedido_compra', { p: { fornecedor_id: Number(fornecedor_id), status: 'rascunho', itens, observacao: 'Gerado pela lista de reposição' } })))
      }
      if (!ids.length) throw new Error('Nenhum item com quantidade para comprar.')
      return ids
    }, (ids) => `${ids.length} pedido(s) de compra criado(s) como rascunho: #${ids.join(', #')}. Abra “Pedidos de compra” para revisar.`)
  }

  function exportar() {
    baixar(gerarCSV(['SKU', 'Peça', 'Fornecedor', 'Estoque', 'A caminho', 'Venda média/dia', 'Cobertura (dias)', 'Comprar'],
      selecionados.map((l) => [l.p.sku, l.p.nome, l.forn?.nome || '', l.estoque, l.aCaminho, l.media.toFixed(2).replace('.', ','),
        l.cobertura === null ? '' : Math.floor(l.cobertura), qtd(l)])), `lista-de-compra-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <Pagina titulo="Reposição de estoque"
      subtitulo={`Ponto de pedido = venda média/dia × (prazo do fornecedor + ${dados.config.dias_seguranca} dias de segurança). Sugestão cobre mais ${dados.config.dias_cobertura_alvo} dias. Ajuste em Configurações.`}
      acoes={<>
        <select value={janela} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={30}>Média dos últimos 30 dias</option><option value={60}>Últimos 60 dias</option><option value={90}>Últimos 90 dias</option>
        </select>
        <button className="botao" onClick={exportar}>Baixar lista (.csv)</button>
        <button className="botao primario" onClick={criarPedidos} disabled={acao.ocupado || !selecionados.length}>Criar pedidos de compra</button>
      </>}>
      <Mensagens acao={acao} />
      {acao.msg && <button className="botao" onClick={() => nav('/compras')}>Ir para Pedidos de compra</button>}
      {!linhas.length ? <Vazio>Nenhuma peça cadastrada.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th /><th>SKU</th><th>Peça</th><th className="num">Estoque</th><th className="num">A caminho</th><th className="num">Vendas/dia</th><th className="num">Cobertura</th><th className="num">Prazo</th><th className="num">Ponto de pedido</th><th>Situação</th><th className="num">Comprar</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.p.id}>
                  <td><input type="checkbox" checked={marcados[l.p.id] ?? l.comprar} onChange={(e) => setMarcados({ ...marcados, [l.p.id]: e.target.checked })} /></td>
                  <td><b>{l.p.sku}</b></td><td>{l.p.nome}<div className="dica">{l.forn?.nome || 'sem fornecedor'}</div></td>
                  <td className="num">{numero(l.estoque)}</td>
                  <td className="num">{l.aCaminho ? <>{numero(l.aCaminho)}<div className="dica">{l.chegada ? dataBR(l.chegada + 'T12:00') : 'sem previsão'}</div></> : '—'}</td>
                  <td className="num">{numero(l.media, 2)}<div className="dica">{numero(l.saida)} em {janela}d</div></td>
                  <td className={`num ${l.cobertura !== null && l.cobertura < l.prazo ? 'neg' : ''}`}>{l.cobertura === null ? 'sem vendas' : `${Math.floor(l.cobertura)} dias`}</td>
                  <td className="num">{l.prazo}d</td>
                  <td className="num">{numero(l.pontoPedido)}</td>
                  <td>{l.comprar ? <Selo tipo="neg">comprar</Selo> : l.media === 0 && l.estoque > 0 ? <Selo>parado</Selo> : <Selo tipo="ok">ok</Selo>}</td>
                  <td className="num"><input className="mini num" value={qtd(l)} onChange={(e) => setQtds({ ...qtds, [l.p.id]: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dica">Valor estimado da compra marcada: <b>{moeda(selecionados.reduce((s, l) => s + qtd(l) * Number(l.p.custo_medio || 0), 0))}</b> (pelo custo médio atual).</p>
    </Pagina>
  )
}
