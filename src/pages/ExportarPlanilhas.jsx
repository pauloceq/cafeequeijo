import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Aviso, Campo, Carregando, Cartao, Pagina, Passos, Selo, useDados } from '../components/ui'
import { mensagemErro, ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { abrirModeloXlsx, acharCabecalho, acharColuna, baixar, gerarCSV, gerarTXT, salvarModeloXlsx } from '../lib/planilha'
import { FORMATOS_EXPORTACAO, MARKETPLACES } from '../lib/formatos'
import { moeda, numero } from '../lib/formato'
import { analisar, parametros, tarifaVigente } from '../lib/precificacao'

const limpar = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

export default function ExportarPlanilhas() {
  const { ehDono } = useAuth()
  const { dados, erro, carregando } = useDados(async () => {
    const base = await carregarBase({ tarifas: true, config: true, produtoConta: true })
    const anuncios = await supabase.from('anuncios').select('*').then(ok)
    return { ...base, anuncios }
  })
  const [contaId, setContaId] = useState(1)
  const [fonteQtd, setFonteQtd] = useState('real')
  const [fontePreco, setFontePreco] = useState('atual')
  const [atualizarQtd, setAtualizarQtd] = useState(true)
  const [atualizarPreco, setAtualizarPreco] = useState(false)
  const [modelo, setModelo] = useState(null)
  const [nomeArq, setNomeArq] = useState('')
  const [abaIdx, setAbaIdx] = useState(0)
  const [cols, setCols] = useState(null)
  const [erroArq, setErroArq] = useState(null)
  const [feito, setFeito] = useState(null)

  const conta = dados?.contas.find((c) => c.id === contaId)
  const fmt = conta ? FORMATOS_EXPORTACAO[conta.marketplace] : null

  /** quantidade e preço que vão para um produto nesta conta */
  function valores(produto, unidades = 1) {
    const pc = dados.produtoConta.find((x) => x.produto_id === produto.id && x.conta_id === contaId)
    const qBase = fonteQtd === 'ficticio' ? Number(pc?.quantidade_anuncio || 0) : Math.max(0, Number(produto.disponivel || 0))
    let preco = Number(pc?.preco ?? produto.preco_venda) || null
    if (fontePreco === 'sugerido') {
      const par = parametros({ produto, conta, tarifa: tarifaVigente(dados.tarifas, contaId), config: dados.config, pc })
      preco = analisar(null, par).sugerido
    }
    return { quantidade: Math.floor(qBase / (unidades || 1)), preco: preco ? Math.round(preco * unidades * 100) / 100 : null }
  }

  async function abrirModelo(file) {
    setErroArq(null); setFeito(null)
    try {
      const m = await abrirModeloXlsx(file)
      const todos = [...fmt.chave, ...fmt.sku, ...fmt.quantidade, ...fmt.preco]
      let melhor = 0, pts = -1
      m.abas.forEach((a, i) => { const c = acharCabecalho(a.linhas, todos); if (c.pontos > pts) { pts = c.pontos; melhor = i } })
      setModelo(m); setNomeArq(file.name); escolherAba(m, melhor)
    } catch (e) { setErroArq(mensagemErro(e)) }
  }

  function escolherAba(m, i) {
    setAbaIdx(i)
    const todos = [...fmt.chave, ...fmt.sku, ...fmt.quantidade, ...fmt.preco]
    const { indice } = acharCabecalho(m.abas[i].linhas, todos)
    const cab = m.abas[i].linhas[indice] || []
    setCols({
      cab: indice, chave: acharColuna(cab, fmt.chave), variacao: acharColuna(cab, fmt.variacao),
      sku: acharColuna(cab, fmt.sku), quantidade: acharColuna(cab, fmt.quantidade), preco: acharColuna(cab, fmt.preco),
    })
  }

  const previa = useMemo(() => {
    if (!modelo || !cols || !dados) return []
    const aba = modelo.abas[abaIdx]
    const anuncios = dados.anuncios.filter((a) => a.conta_id === contaId)
    const out = []
    aba.linhas.forEach((l, i) => {
      if (i <= cols.cab || !l) return
      const chave = cols.chave > -1 ? String(l[cols.chave] ?? '').trim() : ''
      const vari = cols.variacao > -1 ? String(l[cols.variacao] ?? '').trim() : ''
      const sku = cols.sku > -1 ? String(l[cols.sku] ?? '').trim() : ''
      if (!chave && !sku) return
      let anuncio = anuncios.find((a) => a.produto_id && (
        (vari && (a.codigo === `${chave}:${vari}` || (a.item_id === chave && a.variacao_id === vari))) ||
        (!vari && (a.codigo === chave || (a.item_id === chave && !a.variacao_id)))))
      let produto = anuncio && dados.produtos.find((p) => p.id === anuncio.produto_id)
      if (!produto && sku) {
        produto = dados.produtos.find((p) => limpar(p.sku) === limpar(sku))
        if (!produto) {
          anuncio = anuncios.find((a) => a.produto_id && limpar(a.sku_marketplace) === limpar(sku))
          produto = anuncio && dados.produtos.find((p) => p.id === anuncio.produto_id)
        }
      }
      const atualQtd = cols.quantidade > -1 ? l[cols.quantidade] : ''
      const atualPreco = cols.preco > -1 ? l[cols.preco] : ''
      out.push({ linha: i, chave: chave || sku, vari, sku, produto, unidades: Number(anuncio?.unidades_por_venda) || 1, atualQtd, atualPreco,
        novo: produto ? valores(produto, Number(anuncio?.unidades_por_venda) || 1) : null })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, cols, abaIdx, dados, contaId, fonteQtd, fontePreco])

  async function gerarModelo() {
    const escritas = []
    for (const r of previa) {
      if (!r.novo) continue
      if (atualizarQtd && cols.quantidade > -1) escritas.push({ linha: r.linha, coluna: cols.quantidade, valor: r.novo.quantidade })
      if (atualizarPreco && cols.preco > -1 && r.novo.preco) escritas.push({ linha: r.linha, coluna: cols.preco, valor: r.novo.preco.toFixed(2) })
    }
    if (!escritas.length) { setErroArq('Nada para atualizar: nenhuma linha foi reconhecida ou nenhuma coluna marcada.'); return }
    await salvarModeloXlsx(modelo, modelo.abas[abaIdx], escritas, nomeArq.replace(/\.xlsx$/i, '') + '-atualizada.xlsx')
    setFeito(`Planilha gerada com ${escritas.length} célula(s) atualizada(s). Agora suba este arquivo no site (veja os passos ao lado).`)
  }

  function planilhaSimples() {
    const linhas = []
    for (const p of dados.produtos.filter((x) => x.ativo)) {
      const anuncios = dados.anuncios.filter((a) => a.conta_id === contaId && a.produto_id === p.id)
      const lista = anuncios.length ? anuncios : [null]
      for (const a of lista) {
        const v = valores(p, Number(a?.unidades_por_venda) || 1)
        linhas.push([p.sku, p.nome, a?.item_id || a?.codigo || '', a?.variacao_id || '', a?.unidades_por_venda || 1, v.quantidade, v.preco ? v.preco.toFixed(2).replace('.', ',') : ''])
      }
    }
    baixar(gerarCSV(['SKU', 'Produto', 'Código do anúncio', 'Variação', 'Unidades por venda', 'Quantidade', 'Preço'], linhas),
      `estoque-preco-${conta.nome.replace(/\s+/g, '-').toLowerCase()}.csv`)
  }

  function amazonTxt() {
    const linhas = []
    for (const a of dados.anuncios.filter((x) => x.conta_id === contaId && x.produto_id)) {
      const p = dados.produtos.find((x) => x.id === a.produto_id)
      const v = valores(p, Number(a.unidades_por_venda) || 1)
      linhas.push([a.sku_marketplace || a.codigo, atualizarPreco && v.preco ? v.preco.toFixed(2) : '', '', '', atualizarQtd ? v.quantidade : '', '', ''])
    }
    if (!linhas.length) { setErroArq('Nenhum anúncio desta conta está vinculado a um SKU. Vincule em “Anúncios” (ou importe uma planilha de vendas antes).'); return }
    baixar(gerarTXT(['sku', 'price', 'minimum-seller-allowed-price', 'maximum-seller-allowed-price', 'quantity', 'handling-time', 'fulfillment-channel'], linhas),
      `amazon-preco-quantidade-${conta.nome.replace(/\s+/g, '-').toLowerCase()}.txt`)
  }

  if (carregando) return <Pagina titulo="Exportar planilhas"><Carregando /></Pagina>
  if (erro) return <Pagina titulo="Exportar planilhas"><Aviso tipo="erro">{erro}</Aviso></Pagina>
  const reconhecidas = previa.filter((r) => r.novo).length

  return (
    <Pagina titulo="Exportar planilhas de estoque e preço" subtitulo="Atualize vários anúncios de uma vez usando a planilha de edição em massa de cada site.">
      <div className="abas">
        {dados.contas.map((c) => (
          <button key={c.id} className={c.id === contaId ? 'ativa' : ''} onClick={() => { setContaId(c.id); setModelo(null); setFeito(null) }}>
            <span className="bolinha" style={{ background: c.cor }} />{c.nome}
          </button>
        ))}
      </div>

      <Cartao titulo="O que enviar">
        <div className="linha">
          <label className="check"><input type="checkbox" checked={atualizarQtd} onChange={(e) => setAtualizarQtd(e.target.checked)} /> Atualizar quantidade</label>
          <Campo rotulo="Quantidade a partir de">
            <select value={fonteQtd} onChange={(e) => setFonteQtd(e.target.value)}>
              <option value="real">Estoque real disponível (kits: calculado pelas peças)</option>
              <option value="ficticio">Estoque fictício cadastrado para esta conta</option>
            </select>
          </Campo>
          <label className="check"><input type="checkbox" checked={atualizarPreco} onChange={(e) => setAtualizarPreco(e.target.checked)} /> Atualizar preço</label>
          {ehDono && (
            <Campo rotulo="Preço a partir de">
              <select value={fontePreco} onChange={(e) => setFontePreco(e.target.value)}>
                <option value="atual">Preço desta conta (Precificação)</option>
                <option value="sugerido">Preço sugerido pela margem-alvo</option>
              </select>
            </Campo>
          )}
        </div>
        <small className="dica">Anúncios de kit/pacote (ex.: “2 unidades”) recebem a quantidade dividida e o preço multiplicado pelas “unidades por venda” cadastradas em Anúncios.</small>
      </Cartao>

      <div className="grade-2">
        <Cartao titulo={`Opção 1 (recomendada): preencher a planilha do ${MARKETPLACES[conta.marketplace]}`}>
          <PassosSite marketplace={conta.marketplace} />
          <input type="file" accept=".xlsx" onChange={(e) => e.target.files[0] && abrirModelo(e.target.files[0])} />
          <Aviso tipo="erro">{erroArq}</Aviso>
          {modelo && cols && (
            <>
              {modelo.abas.length > 1 && (
                <Campo rotulo="Aba"><select value={abaIdx} onChange={(e) => escolherAba(modelo, Number(e.target.value))}>{modelo.abas.map((a, i) => <option key={i} value={i}>{a.nome}</option>)}</select></Campo>
              )}
              <div className="linha">
                {[['chave', 'Código do anúncio'], ['variacao', 'Variação'], ['sku', 'SKU'], ['quantidade', 'Coluna de quantidade'], ['preco', 'Coluna de preço']].map(([k, rot]) => (
                  <Campo key={k} rotulo={rot}>
                    <select value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: Number(e.target.value) })}>
                      <option value={-1}>— nenhuma —</option>
                      {(modelo.abas[abaIdx].linhas[cols.cab] || []).map((c, i) => <option key={i} value={i}>{String(c).slice(0, 40)}</option>)}
                    </select>
                  </Campo>
                ))}
              </div>
              <Aviso tipo={reconhecidas ? 'ok' : 'aviso'}>{reconhecidas} de {previa.length} anúncio(s) reconhecido(s). Os não reconhecidos ficam como estão.</Aviso>
              <div className="tabela-rolagem" style={{ maxHeight: 300 }}>
                <table className="tabela compacta">
                  <thead><tr><th>Anúncio</th><th>SKU do app</th><th className="num">Qtd atual → nova</th><th className="num">Preço atual → novo</th></tr></thead>
                  <tbody>
                    {previa.map((r) => (
                      <tr key={r.linha}>
                        <td>{r.chave}{r.vari && <div className="dica">var. {r.vari}</div>}</td>
                        <td>{r.produto ? <>{r.produto.sku}{r.unidades > 1 && <Selo>×{r.unidades}</Selo>}</> : <span className="dica">não vinculado</span>}</td>
                        <td className="num">{String(r.atualQtd ?? '')} {r.novo && atualizarQtd && <>→ <b>{numero(r.novo.quantidade)}</b></>}</td>
                        <td className="num">{String(r.atualPreco ?? '')} {r.novo?.preco && atualizarPreco && <>→ <b>{moeda(r.novo.preco)}</b></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="botao primario" onClick={gerarModelo}>Baixar planilha preenchida</button>
            </>
          )}
          <Aviso tipo="ok">{feito}</Aviso>
        </Cartao>

        <Cartao titulo="Opção 2: planilha simples">
          <p>Lista com SKU, código do anúncio, quantidade e preço — para conferir ou copiar e colar na planilha do site.</p>
          <button className="botao" onClick={planilhaSimples}>Baixar lista (.csv)</button>
          {conta.marketplace === 'amazon' && (
            <>
              <p style={{ marginTop: 16 }}>Para a Amazon também dá para gerar o arquivo de texto de <b>preço e quantidade</b> (usa o SKU do anúncio):</p>
              <button className="botao" onClick={amazonTxt}>Baixar arquivo Amazon (.txt)</button>
            </>
          )}
          <p className="dica" style={{ marginTop: 16 }}>Os anúncios precisam estar vinculados a um SKU em <Link to="/anuncios">Anúncios</Link>. Ao importar vendas, os vínculos são criados automaticamente.</p>
        </Cartao>
      </div>
    </Pagina>
  )
}

export function PassosSite({ marketplace }) {
  if (marketplace === 'mercadolivre') return (
    <Passos>
      <li>No Mercado Livre, vá em <b>Anúncios</b> → <b>Editar em massa</b> (ou “Modificar anúncios em massa / Excel”).</li>
      <li>Escolha os anúncios, marque as colunas <b>Preço</b> e <b>Estoque</b> e clique em <b>Baixar planilha</b> (.xlsx).</li>
      <li>Envie o arquivo aqui embaixo e clique em “Baixar planilha preenchida”.</li>
      <li>Volte ao Mercado Livre, na mesma tela, clique em <b>Carregar planilha</b> e envie o arquivo “-atualizada”.</li>
    </Passos>
  )
  if (marketplace === 'shopee') return (
    <Passos>
      <li>Na Central do Vendedor Shopee: <b>Meus Produtos</b> → <b>Ferramentas em massa</b> (Atualização em massa).</li>
      <li>Escolha <b>Informações de vendas</b> (preço e estoque) → <b>Gerar</b> e depois <b>Baixar</b> o modelo .xlsx.</li>
      <li>Envie o arquivo aqui e clique em “Baixar planilha preenchida”.</li>
      <li>Na mesma tela da Shopee, clique em <b>Enviar arquivo</b> e escolha o arquivo “-atualizada”.</li>
    </Passos>
  )
  return (
    <Passos>
      <li>No Seller Central: <b>Catálogo</b> → <b>Adicionar produtos via upload</b> → <b>Baixar um modelo de inventário</b> e escolha o modelo de <b>preço e quantidade</b> (.xlsx).</li>
      <li>Envie o arquivo aqui e clique em “Baixar planilha preenchida” (ou use o .txt da opção 2).</li>
      <li>No Seller Central: <b>Adicionar produtos via upload</b> → <b>Enviar seu arquivo de inventário</b>.</li>
      <li>Confira o resultado em <b>Monitorar status do upload</b>.</li>
    </Passos>
  )
}
