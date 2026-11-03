import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { Aviso, Barra, Campo, Carregando, Cartao, Pagina, Passos, Selo, useDados } from '../components/ui'
import { mensagemErro, ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { acharCabecalho, acharColuna, lerArquivo } from '../lib/planilha'
import { CAMPOS_VENDA, detectarFormato, FORMATOS_VENDAS, MARKETPLACES, STATUS_IGNORAR, TODOS_APELIDOS } from '../lib/formatos'
import { dataBR, lerData, lerNumero, moeda, normalizar } from '../lib/formato'

const limparSku = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

export default function ImportarVendas() {
  const base = useDados(() => carregarBase())
  const [arq, setArq] = useState(null)          // { nome, abas }
  const [abaIdx, setAbaIdx] = useState(0)
  const [mk, setMk] = useState(null)
  const [contaId, setContaId] = useState('')
  const [colunas, setColunas] = useState({})
  const [erro, setErro] = useState(null)
  const [lendo, setLendo] = useState(false)
  const [vinculos, setVinculos] = useState({})  // chave -> { produto_id, unidades }
  const [contexto, setContexto] = useState(null) // anuncios + vendas existentes
  const [ignorarStatus, setIgnorarStatus] = useState(true)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)

  async function abrir(file) {
    setErro(null); setResultado(null); setContexto(null); setVinculos({}); setLendo(true)
    try {
      const abas = await lerArquivo(file)
      // escolhe a aba com o cabeçalho mais reconhecível
      let melhor = 0, pontos = -1
      abas.forEach((a, i) => { const c = acharCabecalho(a.linhas, TODOS_APELIDOS); if (c.pontos > pontos) { pontos = c.pontos; melhor = i } })
      setArq({ nome: file.name, abas })
      escolherAba(abas, melhor)
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setLendo(false)
    }
  }

  function escolherAba(abas, i) {
    setAbaIdx(i)
    const { indice } = acharCabecalho(abas[i].linhas, TODOS_APELIDOS)
    const cab = abas[i].linhas[indice] || []
    const det = detectarFormato(cab)
    setMk(det)
    aplicarFormato(det || 'mercadolivre', cab)
    const contasMk = base.dados.contas.filter((c) => !det || c.marketplace === det)
    setContaId(contasMk.length === 1 ? contasMk[0].id : '')
  }

  function aplicarFormato(m, cab) {
    const f = FORMATOS_VENDAS[m]
    const out = {}
    for (const campo of Object.keys(CAMPOS_VENDA)) {
      if (campo === 'taxa' && f.taxaSomaColunas) {
        out.taxa = f.campos.taxa.map((ap) => acharColuna(cab, [ap])).filter((i) => i > -1)
      } else {
        const i = acharColuna(cab, f.campos[campo] || [])
        out[campo] = campo === 'taxa' || campo === 'frete' ? (i > -1 ? [i] : []) : i
      }
    }
    setColunas(out)
  }

  const aba = arq?.abas[abaIdx]
  const cabInfo = aba ? acharCabecalho(aba.linhas, TODOS_APELIDOS) : null
  const cabecalho = aba ? aba.linhas[cabInfo.indice] || [] : []
  const formato = FORMATOS_VENDAS[mk || 'mercadolivre']

  // monta os pedidos a partir das linhas
  const pedidos = useMemo(() => {
    if (!aba || colunas.pedido === undefined) return []
    const val = (l, c) => (c > -1 ? l[c] : '')
    const soma = (l, cs) => (cs || []).reduce((s, c) => s + Math.abs(lerNumero(l[c])), 0)
    const mapa = new Map()
    let ultimo = null
    for (const l of aba.linhas.slice(cabInfo.indice + 1)) {
      if (!l || l.every((x) => x === '' || x === null)) continue
      let ped = String(val(l, colunas.pedido) ?? '').trim()
      const anuncio = String(val(l, colunas.anuncio) ?? '').trim()
      const sku = String(val(l, colunas.sku) ?? '').trim()
      const titulo = String(val(l, colunas.titulo) ?? '').trim()
      const variacao = String(val(l, colunas.variacao) ?? '').trim()
      if (!ped && (anuncio || sku || titulo) && ultimo) ped = ultimo // linha de item de um pacote
      if (!ped) continue
      ultimo = ped
      if (!mapa.has(ped)) {
        mapa.set(ped, {
          codigo: ped, data: lerData(val(l, colunas.data)), status: String(val(l, colunas.status) ?? ''),
          comprador: String(val(l, colunas.comprador) ?? ''), itens: [], taxa: 0, frete: 0, temTaxa: (colunas.taxa || []).length > 0,
        })
      }
      const p = mapa.get(ped)
      const taxaLinha = soma(l, colunas.taxa)
      const freteLinha = Math.max(0, soma(l, colunas.frete) - (colunas.frete_receita > -1 ? Math.abs(lerNumero(l[colunas.frete_receita])) : 0))
      if (formato.taxasPorPedido) { if (p.itens.length === 0) { p.taxa = taxaLinha; p.frete = freteLinha } }
      else { p.taxa += taxaLinha; p.frete += freteLinha }

      if (!anuncio && !sku && !titulo) continue // linha-resumo de pacote
      const qtd = lerNumero(val(l, colunas.quantidade)) || 0
      if (qtd <= 0) continue
      let unit = colunas.preco_unitario > -1 ? lerNumero(l[colunas.preco_unitario]) : 0
      if (!unit && colunas.total_linha > -1) unit = lerNumero(l[colunas.total_linha]) / qtd
      const base = anuncio || sku || titulo
      const chave = (anuncio || !sku) && variacao ? `${base} · ${variacao}` : base
      p.itens.push({ chave, anuncio, sku, titulo, variacao, quantidade: qtd, preco_unitario: Math.round(unit * 100) / 100 })
    }
    return [...mapa.values()]
  }, [aba, cabInfo?.indice, colunas, formato])

  async function verificar() {
    setErro(null)
    try {
      if (!contaId) throw new Error('Escolha a conta desta planilha.')
      const [anuncios, existentes] = await Promise.all([
        supabase.from('anuncios').select('codigo,produto_id,unidades_por_venda,sku_marketplace').eq('conta_id', contaId).then(ok),
        (async () => {
          const cods = pedidos.map((p) => p.codigo)
          const achados = []
          for (let i = 0; i < cods.length; i += 200) {
            achados.push(...ok(await supabase.from('vendas').select('codigo_externo').eq('conta_id', contaId).in('codigo_externo', cods.slice(i, i + 200))))
          }
          return new Set(achados.map((v) => v.codigo_externo))
        })(),
      ])
      setContexto({ anuncios, existentes })
    } catch (e) { setErro(mensagemErro(e)) }
  }

  function resolver(item) {
    if (vinculos[item.chave]?.produto_id) return vinculos[item.chave]
    const a = contexto.anuncios.find((x) => x.produto_id && (x.codigo === item.chave || (item.anuncio && x.codigo === item.anuncio && !item.variacao)))
    if (a) return { produto_id: a.produto_id, unidades: Number(a.unidades_por_venda) || 1 }
    const prods = base.dados.produtos
    const porSku = item.sku && prods.find((p) => limparSku(p.sku) === limparSku(item.sku))
    if (porSku) return { produto_id: porSku.id, unidades: 1, auto: true }
    const a2 = item.sku && contexto.anuncios.find((x) => x.produto_id && limparSku(x.sku_marketplace) === limparSku(item.sku))
    if (a2) return { produto_id: a2.produto_id, unidades: Number(a2.unidades_por_venda) || 1 }
    return null
  }

  const analise = useMemo(() => {
    if (!contexto) return null
    const semVinculo = new Map()
    const linhas = pedidos.map((p) => {
      let situacao = 'nova'
      if (contexto.existentes.has(p.codigo)) situacao = 'duplicada'
      else if (ignorarStatus && STATUS_IGNORAR.test(normalizar(p.status))) situacao = 'ignorada'
      else if (!p.itens.length) situacao = 'sem_itens'
      const itens = p.itens.map((it) => ({ ...it, v: resolver(it) }))
      if (situacao === 'nova' && itens.some((i) => !i.v)) {
        situacao = 'sem_vinculo'
        itens.filter((i) => !i.v).forEach((i) => semVinculo.set(i.chave, i))
      }
      return { ...p, itens, situacao, receita: p.itens.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0) }
    })
    return { linhas, semVinculo: [...semVinculo.values()] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, pedidos, vinculos, ignorarStatus])

  async function importar() {
    setErro(null)
    const conta = base.dados.contas.find((c) => c.id === Number(contaId))
    try {
      // 1) lembra os vínculos novos (anúncio -> SKU)
      const novos = Object.entries(vinculos).filter(([, v]) => v.produto_id).map(([codigo, v]) => {
        const item = analise.semVinculo.find((i) => i.chave === codigo)
        return {
          conta_id: conta.id, codigo, item_id: item?.anuncio || null, titulo: item?.titulo || codigo,
          variacao_descricao: item?.variacao || null, sku_marketplace: item?.sku || null,
          produto_id: Number(v.produto_id), unidades_por_venda: v.unidades || 1,
        }
      })
      if (novos.length) ok(await supabase.from('anuncios').upsert(novos, { onConflict: 'conta_id,codigo' }))

      // 2) importa as vendas novas
      const fila = analise.linhas.filter((l) => l.situacao === 'nova' || (l.situacao === 'sem_vinculo' && l.itens.every((i) => i.v || vinculos[i.chave]?.produto_id)))
      const r = { importadas: 0, duplicadas: 0, erros: [] }
      setProgresso({ feito: 0, total: fila.length })
      for (const [n, p] of fila.entries()) {
        const itens = p.itens.map((i) => {
          const v = i.v || vinculos[i.chave]
          const un = Number(v.unidades) || 1
          return { produto_id: Number(v.produto_id), quantidade: i.quantidade * un, preco_unitario: Math.round((i.preco_unitario / un) * 100) / 100 }
        })
        const { data, error } = await supabase.rpc('registrar_venda', {
          p_venda: {
            conta_id: conta.id, data: (p.data || new Date()).toISOString(), codigo_externo: p.codigo, comprador: p.comprador,
            taxa_marketplace: Math.round(p.taxa * 100) / 100, frete: Math.round(p.frete * 100) / 100,
            usar_taxa_prevista: !p.temTaxa, origem: 'importacao', itens,
          },
        })
        if (error) r.erros.push(`Pedido ${p.codigo}: ${mensagemErro(error)}`)
        else if (data === null) r.duplicadas++
        else r.importadas++
        setProgresso({ feito: n + 1, total: fila.length })
      }
      setResultado(r)
      setContexto(null)
    } catch (e) { setErro(mensagemErro(e)) } finally { setProgresso(null) }
  }

  if (base.carregando) return <Pagina titulo="Importar vendas"><Carregando /></Pagina>
  if (base.erro) return <Pagina titulo="Importar vendas"><Aviso tipo="erro">{base.erro}</Aviso></Pagina>
  const contasMk = base.dados.contas.filter((c) => !mk || c.marketplace === mk)
  const conta = (s) => ({ nova: ['ok', 'nova'], duplicada: ['neutro', 'já importada'], ignorada: ['neutro', 'ignorada (status)'], sem_itens: ['neutro', 'sem itens'], sem_vinculo: ['aviso', 'falta vincular'] }[s])

  return (
    <Pagina titulo="Importar vendas por planilha" subtitulo="Mercado Livre, Shopee ou Amazon: o formato é detectado sozinho. Vendas já importadas são puladas.">
      <Cartao titulo="1. Escolha o arquivo baixado do marketplace">
        <p className="dica">Não sabe onde baixar? Veja <Link to="/ajuda/planilhas">Ajuda → Planilhas dos marketplaces</Link>.</p>
        <input type="file" accept=".xlsx,.csv,.txt,.tsv" onChange={(e) => e.target.files[0] && abrir(e.target.files[0])} />
        {lendo && <Carregando texto="Lendo planilha…" />}
        <Aviso tipo="erro">{erro}</Aviso>
        {resultado && (
          <Aviso tipo={resultado.erros.length ? 'aviso' : 'ok'}>
            <b>{resultado.importadas}</b> venda(s) importada(s) e estoque baixado. {resultado.duplicadas > 0 && `${resultado.duplicadas} já existiam. `}
            {resultado.erros.length > 0 && <><br />Com problema:<ul>{resultado.erros.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
          </Aviso>
        )}
      </Cartao>

      {arq && (
        <Cartao titulo="2. Confira o formato e a conta">
          <div className="linha">
            {arq.abas.length > 1 && (
              <Campo rotulo="Aba da planilha">
                <select value={abaIdx} onChange={(e) => escolherAba(arq.abas, Number(e.target.value))}>{arq.abas.map((a, i) => <option key={i} value={i}>{a.nome}</option>)}</select>
              </Campo>
            )}
            <Campo rotulo="Formato">
              <select value={mk || ''} onChange={(e) => { setMk(e.target.value); aplicarFormato(e.target.value, cabecalho); setContexto(null) }}>
                <option value="" disabled>Não reconhecido — escolha</option>
                {Object.entries(FORMATOS_VENDAS).map(([k, f]) => <option key={k} value={k}>{f.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Conta desta planilha">
              <select value={contaId} onChange={(e) => { setContaId(Number(e.target.value)); setContexto(null) }}>
                <option value="">Escolha…</option>
                {contasMk.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
          </div>
          {mk ? <Aviso tipo="ok">Detectado: <b>{MARKETPLACES[mk]}</b>. {pedidos.length} pedido(s) encontrados na linha {cabInfo.indice + 1} em diante.</Aviso>
            : <Aviso tipo="aviso">Não reconheci o formato automaticamente. Escolha acima e confira as colunas abaixo.</Aviso>}
          {!formato.campos.taxa.length && <Aviso tipo="info">Esta planilha não traz as tarifas: o app usa a tabela de tarifas da conta (Configurações → Tarifas).</Aviso>}
          <details>
            <summary>Conferir quais colunas foram usadas</summary>
            <div className="grade-colunas">
              {Object.entries(CAMPOS_VENDA).map(([campo, nome]) => {
                const multi = campo === 'taxa' || campo === 'frete'
                const v = colunas[campo]
                return (
                  <Campo key={campo} rotulo={nome}>
                    {multi ? (
                      <select multiple size={3} value={(v || []).map(String)} onChange={(e) => setColunas({ ...colunas, [campo]: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
                        {cabecalho.map((c, i) => <option key={i} value={i}>{String(c)}</option>)}
                      </select>
                    ) : (
                      <select value={v ?? -1} onChange={(e) => setColunas({ ...colunas, [campo]: Number(e.target.value) })}>
                        <option value={-1}>— não usar —</option>
                        {cabecalho.map((c, i) => <option key={i} value={i}>{String(c)}</option>)}
                      </select>
                    )}
                  </Campo>
                )
              })}
            </div>
            <small className="dica">Para várias colunas de tarifa, segure Ctrl (ou Cmd) e clique. Os valores são somados.</small>
          </details>
          <label className="check"><input type="checkbox" checked={ignorarStatus} onChange={(e) => setIgnorarStatus(e.target.checked)} /> Ignorar pedidos cancelados, devolvidos ou não pagos</label>
          <div className="acoes-form"><button className="botao primario" disabled={!contaId || !pedidos.length} onClick={verificar}>Verificar pedidos</button></div>
        </Cartao>
      )}

      {analise && (
        <Cartao titulo="3. Revise e importe">
          {analise.semVinculo.length > 0 && (
            <>
              <Aviso tipo="aviso">Estes anúncios ainda não estão ligados a um SKU. Escolha o produto (o app lembra para as próximas vezes). “Unidades” = quantas unidades do SKU saem em cada venda (ex.: anúncio “kit com 2”).</Aviso>
              <table className="tabela compacta">
                <thead><tr><th>Anúncio na planilha</th><th>Produto do app</th><th>Unidades</th></tr></thead>
                <tbody>
                  {analise.semVinculo.map((i) => (
                    <tr key={i.chave}>
                      <td>{i.titulo || i.chave}<div className="dica">{i.chave}{i.sku ? ` · SKU ${i.sku}` : ''}</div></td>
                      <td>
                        <select value={vinculos[i.chave]?.produto_id || ''} onChange={(e) => setVinculos({ ...vinculos, [i.chave]: { unidades: 1, ...vinculos[i.chave], produto_id: e.target.value } })}>
                          <option value="">Escolha…</option>
                          {base.dados.produtos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome}</option>)}
                        </select>
                      </td>
                      <td><input className="mini num" type="number" min="1" value={vinculos[i.chave]?.unidades || 1} onChange={(e) => setVinculos({ ...vinculos, [i.chave]: { ...vinculos[i.chave], unidades: Number(e.target.value) || 1 } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="numeros">
            {['nova', 'sem_vinculo', 'duplicada', 'ignorada'].map((s) => (
              <div className="numero" key={s}><span>{conta(s)[1]}</span><b>{analise.linhas.filter((l) => l.situacao === s).length}</b></div>
            ))}
          </div>
          <div className="tabela-rolagem" style={{ maxHeight: 420 }}>
            <table className="tabela compacta">
              <thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th className="num">Receita</th><th className="num">Tarifas</th><th className="num">Frete</th><th>Situação</th></tr></thead>
              <tbody>
                {analise.linhas.map((l) => (
                  <tr key={l.codigo}>
                    <td>{l.codigo}</td><td>{l.data ? dataBR(l.data) : <span className="neg">sem data</span>}</td>
                    <td>{l.itens.map((i) => `${i.quantidade}× ${i.sku || i.titulo || i.chave}`).join(', ')}</td>
                    <td className="num">{moeda(l.receita)}</td><td className="num">{l.temTaxa ? moeda(l.taxa) : 'tabela'}</td><td className="num">{moeda(l.frete)}</td>
                    <td><Selo tipo={conta(l.situacao)[0]}>{conta(l.situacao)[1]}</Selo></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {progresso && <><Barra valor={progresso.feito} max={progresso.total} /><small>{progresso.feito} de {progresso.total}</small></>}
          <div className="acoes-form">
            <button className="botao primario" disabled={!!progresso} onClick={importar}>
              Importar {analise.linhas.filter((l) => l.situacao === 'nova' || (l.situacao === 'sem_vinculo' && l.itens.every((i) => i.v || vinculos[i.chave]?.produto_id))).length} venda(s) e baixar estoque
            </button>
          </div>
        </Cartao>
      )}
      {!arq && (
        <Cartao titulo="Como funciona">
          <Passos>
            <li>Baixe o relatório de vendas no site do marketplace (veja a Ajuda).</li>
            <li>Escolha o arquivo aqui. O app reconhece se é Mercado Livre, Shopee ou Amazon.</li>
            <li>Escolha a conta (ex.: Mercado Livre 1 ou 2).</li>
            <li>Na primeira vez, ligue cada anúncio a um SKU. Nas próximas, o app já sabe.</li>
            <li>Clique em importar: as vendas entram e o estoque real das peças é baixado.</li>
          </Passos>
        </Cartao>
      )}
    </Pagina>
  )
}
