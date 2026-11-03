import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Aviso, Carregando, Mensagens, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { chamarConexoes } from '../lib/funcoes'
import { dataHoraBR, moeda, normalizar, numero } from '../lib/formato'

export default function Anuncios() {
  const { ehDono } = useAuth()
  const [contaId, setContaId] = useState(1)
  const [busca, setBusca] = useState('')
  const [soSemVinculo, setSoSemVinculo] = useState(false)
  const [envio, setEnvio] = useState({})
  const acao = useAcao()
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const base = await carregarBase()
    const [anuncios, pendentes, conexoes] = await Promise.all([
      supabase.from('anuncios').select('*').eq('conta_id', contaId).order('titulo').then(ok),
      supabase.from('pedidos_externos').select('*').eq('conta_id', contaId).in('situacao', ['pendente_vinculo', 'erro']).then(ok),
      ehDono ? supabase.from('conexoes').select('*').eq('conta_id', contaId).maybeSingle().then(ok) : null,
    ])
    return { ...base, anuncios, pendentes, conexao: conexoes }
  }, [contaId, ehDono])

  const lista = useMemo(() => (dados?.anuncios || []).filter((a) =>
    (!soSemVinculo || !a.produto_id) && (!busca || normalizar(`${a.codigo} ${a.titulo} ${a.variacao_descricao} ${a.sku_marketplace}`).includes(normalizar(busca)))),
  [dados, busca, soSemVinculo])

  const conectado = dados?.conexao?.status === 'conectada'

  async function vincular(a, campos) {
    await acao.executar(async () => {
      ok(await supabase.from('anuncios').update(campos).eq('id', a.id))
      await recarregar()
    })
  }

  async function atualizarLista() {
    await acao.executar(async () => {
      const r = await chamarConexoes({ acao: 'listar_anuncios', conta_id: contaId })
      await recarregar()
      return r
    }, (r) => `${r.total} anúncio(s)/variação(ões) carregados. ${r.vinculados_automaticamente} vinculados sozinhos pelo SKU.`)
  }

  async function enviar(a) {
    const e = envio[a.id] || {}
    await acao.executar(async () => {
      await chamarConexoes({ acao: 'atualizar_anuncio', conta_id: contaId, anuncio_id: a.id, quantidade: e.quantidade ?? null, preco: e.preco ?? null })
      setEnvio((x) => ({ ...x, [a.id]: undefined }))
      await recarregar()
    }, `“${a.titulo}” atualizado no Mercado Livre.`)
  }

  async function reprocessar() {
    await acao.executar(async () => {
      const r = await chamarConexoes({ acao: 'reprocessar', conta_id: contaId })
      await recarregar()
      return r
    }, (r) => `Reprocessado: ${Object.entries(r).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || 'nada pendente'}.`)
  }

  return (
    <Pagina titulo="Anúncios" subtitulo="Cada anúncio (ou variação) de cada conta ligado a um SKU do app. É assim que vendas importadas baixam o estoque certo."
      acoes={ehDono && conectado && <button className="botao primario" disabled={acao.ocupado} onClick={atualizarLista}>{acao.ocupado ? 'Buscando…' : '↻ Buscar anúncios no Mercado Livre'}</button>}>
      <div className="abas">
        {dados?.contas.map((c) => (
          <button key={c.id} className={c.id === contaId ? 'ativa' : ''} onClick={() => setContaId(c.id)}><span className="bolinha" style={{ background: c.cor }} />{c.nome}</button>
        ))}
      </div>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      <Mensagens acao={acao} />
      {dados && (
        <>
          {ehDono && dados.contas.find((c) => c.id === contaId)?.marketplace === 'mercadolivre' && !conectado && (
            <Aviso tipo="info">Esta conta não está conectada pela API. Os anúncios aparecem aqui quando você importa planilhas de vendas. Para buscar todos e editar estoque/preço direto daqui, <Link to="/conexoes">conecte o Mercado Livre</Link>.</Aviso>
          )}
          {dados.pendentes.length > 0 && (
            <Aviso tipo="aviso">
              {dados.pendentes.length} pedido(s) recebidos pela API estão esperando vínculo ou deram erro:
              <ul>{dados.pendentes.slice(0, 5).map((p) => <li key={p.id}>{p.codigo}: {p.mensagem}</li>)}</ul>
              {ehDono && <button className="botao" onClick={reprocessar} disabled={acao.ocupado}>Reprocessar pendentes</button>}
            </Aviso>
          )}
          <div className="filtros">
            <input placeholder="Buscar anúncio…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="check"><input type="checkbox" checked={soSemVinculo} onChange={(e) => setSoSemVinculo(e.target.checked)} /> Só sem vínculo</label>
          </div>
          {!lista.length ? <Vazio>Nenhum anúncio ainda. Importe uma planilha de vendas desta conta{ehDono && conectado ? ' ou busque no Mercado Livre' : ''}.</Vazio> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr><th>Anúncio</th><th>Produto do app</th><th className="num">Unid./venda</th><th className="num">Qtd no anúncio</th><th className="num">Preço</th>{ehDono && conectado && <th>Enviar ao ML</th>}</tr>
                </thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.link ? <a href={a.link} target="_blank" rel="noreferrer">{a.titulo || a.codigo}</a> : (a.titulo || a.codigo)}
                        <div className="dica">{a.codigo}{a.variacao_descricao ? ` · ${a.variacao_descricao}` : ''}{a.sku_marketplace ? ` · SKU ${a.sku_marketplace}` : ''}{a.status_anuncio && a.status_anuncio !== 'active' ? ` · ${a.status_anuncio}` : ''}</div>
                      </td>
                      <td>
                        <select value={a.produto_id || ''} onChange={(e) => vincular(a, { produto_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">— não vinculado —</option>
                          {dados.produtos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome}</option>)}
                        </select>
                      </td>
                      <td className="num"><input className="mini num" type="number" min="1" defaultValue={a.unidades_por_venda}
                        onBlur={(e) => Number(e.target.value) !== Number(a.unidades_por_venda) && vincular(a, { unidades_por_venda: Number(e.target.value) || 1 })} /></td>
                      <td className="num">{a.quantidade_anuncio !== null ? numero(a.quantidade_anuncio) : '—'}</td>
                      <td className="num">{a.preco !== null ? moeda(a.preco) : '—'}</td>
                      {ehDono && conectado && (
                        <td>
                          <div className="linha-inline">
                            <Num casas={0} className="mini num" placeholder="qtd" value={envio[a.id]?.quantidade ?? null} onChange={(v) => setEnvio({ ...envio, [a.id]: { ...envio[a.id], quantidade: v } })} />
                            <Num className="mini num" placeholder="preço" value={envio[a.id]?.preco ?? null} onChange={(v) => setEnvio({ ...envio, [a.id]: { ...envio[a.id], preco: v } })} />
                            <button className="botao" disabled={acao.ocupado || !(envio[a.id]?.quantidade != null || envio[a.id]?.preco != null)} onClick={() => enviar(a)}>Enviar</button>
                          </div>
                          {a.sincronizado_em && <div className="dica">sincronizado {dataHoraBR(a.sincronizado_em)}</div>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lista.some((a) => !a.produto_id) && <Selo tipo="aviso">Anúncios sem vínculo não baixam estoque quando vendem.</Selo>}
        </>
      )}
    </Pagina>
  )
}
