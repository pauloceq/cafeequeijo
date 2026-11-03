import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { Abas, Aviso, Campo, Carregando, Cartao, Num, Pagina, Passos, Selo, useDados } from '../components/ui'
import { mensagemErro, ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { BOOKMARKLET_HREF, chaveItem, interpretarJson, interpretarTexto } from '../lib/aliexpress'
import { dataBR, hojeISO, moeda, numero } from '../lib/formato'

export default function ImportarAliExpress() {
  const [aba, setAba] = useState('importar')
  return (
    <Pagina titulo="Importar pedidos do AliExpress" subtitulo="Cada pedido do AliExpress vira um pedido de compra “a caminho”. Ao marcar como recebido, entra no estoque com frete e impostos no custo.">
      <Abas abas={[['importar', 'Importar'], ['instalar', 'Instalar o botão (bookmarklet)']]} ativa={aba} onTrocar={setAba} />
      {aba === 'instalar' ? <Instalar /> : <Importar />}
    </Pagina>
  )
}

function Instalar() {
  const ref = useRef(null)
  // o React bloqueia links "javascript:", então colocamos o endereço direto no elemento
  useEffect(() => { ref.current?.setAttribute('href', BOOKMARKLET_HREF) }, [])
  return (
    <Cartao titulo="Instalar o botão “Café & Queijo: AliExpress” (uma vez só)">
      <Passos>
        <li>Mostre a barra de favoritos do navegador: aperte <b>Ctrl + Shift + B</b> (no Mac, <b>Cmd + Shift + B</b>).</li>
        <li>
          <b>Arraste</b> este botão até a barra de favoritos:{' '}
          <a ref={ref} className="botao primario bookmarklet" onClick={(e) => { e.preventDefault(); alert('Não clique aqui: arraste este botão para a barra de favoritos.') }}>☕ Café &amp; Queijo: AliExpress</a>
        </li>
        <li>Abra o AliExpress, entre na sua conta e vá em <b>Conta → Meus pedidos</b> (aliexpress.com/p/order/index.html). Role a página até aparecerem todos os pedidos que quer importar (clique em “Ver mais”).</li>
        <li>Clique no favorito <b>☕ Café &amp; Queijo: AliExpress</b>. Ele baixa um arquivo <code>aliexpress-pedidos-AAAA-MM-DD.json</code>.</li>
        <li>Volte aqui, aba <b>Importar</b>, e escolha esse arquivo.</li>
      </Passos>
      <Aviso tipo="info">
        Para pegar <b>frete, impostos e código de rastreio</b>, abra o <b>detalhe</b> de um pedido no AliExpress e clique no botão lá também — o app junta as informações.
        O botão só lê a página que está aberta; ele não envia nada para lugar nenhum.
      </Aviso>
      <Aviso tipo="aviso">Se o botão parar de funcionar (o AliExpress muda o site às vezes), use a opção “colar texto”: na página do pedido aperte Ctrl+A, Ctrl+C e cole no app.</Aviso>
    </Cartao>
  )
}

function Importar() {
  const base = useDados(async () => {
    const b = await carregarBase({ locais: true })
    const forn = ok(await supabase.from('fornecedores').select('*').eq('tipo', 'aliexpress').limit(1).maybeSingle())
    if (!forn) throw new Error('Fornecedor AliExpress não encontrado. Rode o schema.sql de novo no Supabase.')
    const mapas = ok(await supabase.from('mapeamento_itens_fornecedor').select('*').eq('fornecedor_id', forn.id))
    return { ...b, forn, mapas }
  })
  const [texto, setTexto] = useState('')
  const [pedidos, setPedidos] = useState(null)
  const [erro, setErro] = useState(null)
  const [cotacao, setCotacao] = useState(null)
  const [iofPct, setIofPct] = useState(0)
  const [maps, setMaps] = useState({})          // chave -> { produto_id | 'ignorar', unidades }
  const [marcados, setMarcados] = useState({})
  const [existentes, setExistentes] = useState(new Set())
  const [ajustes, setAjustes] = useState({})    // numero -> { frete, impostos } em BRL
  const [resultado, setResultado] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    // cotação do dólar sugerida (pode editar)
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL').then((r) => r.json())
      .then((j) => setCotacao((c) => c ?? Math.round(Number(j.USDBRL.bid) * 100) / 100)).catch(() => {})
  }, [])

  async function carregar(lista) {
    setErro(null); setResultado(null)
    if (!lista.length) { setErro('Não encontrei nenhum número de pedido. Confira se copiou a página “Meus pedidos” ou o detalhe do pedido inteiro (Ctrl+A, Ctrl+C).'); return }
    setPedidos(lista)
    setMarcados(Object.fromEntries(lista.map((p) => [p.numero, true])))
    const ex = ok(await supabase.from('pedidos_compra').select('numero_externo').eq('fornecedor_id', base.dados.forn.id).in('numero_externo', lista.map((p) => p.numero)))
    setExistentes(new Set(ex.map((x) => x.numero_externo)))
  }

  async function lerArquivo(file) {
    try { await carregar(interpretarJson(JSON.parse(await file.text()))) } catch (e) { setErro(mensagemErro(e)) }
  }

  const itensUnicos = useMemo(() => {
    const m = new Map()
    for (const p of pedidos || []) for (const it of p.itens) m.set(chaveItem(it.nome, it.variacao), it)
    return [...m.entries()]
  }, [pedidos])

  const mapa = (chave) => maps[chave] ?? (() => {
    const s = base.dados?.mapas.find((x) => x.chave === chave)
    return s ? { produto_id: s.produto_id ?? 'ignorar', unidades: Number(s.unidades_por_item) || 1 } : null
  })()

  const conv = (p) => (p.moeda === 'BRL' ? 1 : cotacao || 0)

  async function importar() {
    setErro(null); setSalvando(true)
    const forn = base.dados.forn
    try {
      if (pedidos.some((p) => p.moeda !== 'BRL') && !cotacao) throw new Error('Informe a cotação do dólar.')
      // 1) lembra os mapeamentos
      const linhas = itensUnicos.filter(([k]) => maps[k]).map(([k, it]) => ({
        fornecedor_id: forn.id, chave: k, descricao: [it.nome, it.variacao].filter(Boolean).join(' — '),
        produto_id: maps[k].produto_id === 'ignorar' ? null : Number(maps[k].produto_id), unidades_por_item: maps[k].unidades || 1,
      }))
      if (linhas.length) ok(await supabase.from('mapeamento_itens_fornecedor').upsert(linhas, { onConflict: 'fornecedor_id,chave' }))

      // 2) cria os pedidos
      const r = { criados: [], pulados: 0, erros: [] }
      for (const p of pedidos.filter((x) => marcados[x.numero] && !existentes.has(x.numero))) {
        const c = conv(p)
        const itens = []
        let falta = false
        for (const it of p.itens) {
          const mp = mapa(chaveItem(it.nome, it.variacao))
          if (!mp) { falta = true; continue }
          if (mp.produto_id === 'ignorar') continue
          const un = Number(mp.unidades) || 1
          itens.push({
            produto_id: Number(mp.produto_id), quantidade: it.quantidade * un,
            custo_unitario: Math.round(((it.preco_unitario || 0) * c / un) * 10000) / 10000,
            descricao_externa: it.nome, variacao_externa: it.variacao || null, preco_original: it.preco_unitario,
          })
        }
        if (falta) { r.erros.push(`Pedido ${p.numero}: há itens sem produto escolhido.`); continue }
        if (!itens.length) { r.erros.push(`Pedido ${p.numero}: nenhum item para importar.`); continue }
        const aj = ajustes[p.numero] || {}
        const frete = aj.frete ?? Math.round((p.frete || 0) * c * 100) / 100
        const impostos = aj.impostos ?? Math.round((p.impostos || 0) * c * 100) / 100
        const totalBRL = itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0) + frete
        const data = p.data ? p.data.toISOString().slice(0, 10) : hojeISO()
        const id = ok(await supabase.rpc('criar_pedido_compra', {
          p: {
            fornecedor_id: forn.id, status: 'enviado', origem: 'aliexpress', numero_externo: p.numero, status_externo: p.status || null,
            rastreio: p.rastreio || null, data_pedido: data,
            previsao_chegada: new Date(new Date(data).getTime() + forn.prazo_entrega_dias * 864e5).toISOString().slice(0, 10),
            moeda: p.moeda, cotacao: c, total_original: p.total, frete, imposto_importacao: impostos,
            iof: Math.round(totalBRL * (iofPct || 0)) / 100, local_id: base.dados.locais.find((l) => l.padrao)?.id, itens,
          },
        }))
        if (id === null) r.pulados++
        else r.criados.push(id)
      }
      setResultado(r)
      setPedidos(null)
      base.recarregar()
    } catch (e) { setErro(mensagemErro(e)) } finally { setSalvando(false) }
  }

  if (base.carregando) return <Carregando />
  if (base.erro) return <Aviso tipo="erro">{base.erro}</Aviso>

  return (
    <>
      <div className="grade-2">
        <Cartao titulo="Opção A — arquivo do botão (bookmarklet)">
          <p className="dica">Ainda não instalou? Veja a aba “Instalar o botão”.</p>
          <input type="file" accept=".json" onChange={(e) => e.target.files[0] && lerArquivo(e.target.files[0])} />
        </Cartao>
        <Cartao titulo="Opção B — colar o texto da página">
          <p className="dica">No AliExpress, abra “Meus pedidos” ou o detalhe do pedido, aperte Ctrl+A e Ctrl+C, e cole aqui.</p>
          <textarea rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui o texto da página do AliExpress…" />
          <button className="botao" disabled={!texto.trim()} onClick={() => carregar(interpretarTexto(texto))}>Interpretar texto</button>
        </Cartao>
      </div>
      <Aviso tipo="erro">{erro}</Aviso>
      {resultado && (
        <Aviso tipo={resultado.erros.length ? 'aviso' : 'ok'}>
          {resultado.criados.length} pedido(s) de compra criado(s) como “a caminho”{resultado.criados.length ? ` (#${resultado.criados.join(', #')})` : ''}. {resultado.pulados > 0 && `${resultado.pulados} já existiam.`}
          {resultado.erros.length > 0 && <ul>{resultado.erros.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </Aviso>
      )}

      {pedidos && (
        <>
          <Cartao titulo="Cotação e custos">
            <div className="linha">
              <Campo rotulo="Cotação USD → BRL" dica="Sugerida automaticamente; use a da fatura do cartão se souber"><Num casas={4} value={cotacao} onChange={setCotacao} /></Campo>
              <Campo rotulo="IOF (%)" dica="Cartão internacional: 3,38%. Compra em reais: 0"><Num value={iofPct} onChange={(v) => setIofPct(v || 0)} /></Campo>
            </div>
          </Cartao>

          <Cartao titulo="Qual produto do app é cada item do AliExpress?">
            <p className="dica">O app lembra a escolha para as próximas importações. “Unidades por item” = quantas peças vêm em cada item (ex.: pacote com 10 → 10). Use “ignorar” para coisas que não são estoque.</p>
            <table className="tabela compacta">
              <thead><tr><th>Item no AliExpress</th><th>Produto do app</th><th>Unid./item</th></tr></thead>
              <tbody>
                {itensUnicos.map(([k, it]) => {
                  const mp = mapa(k)
                  return (
                    <tr key={k}>
                      <td>{it.nome}{it.variacao && <div className="dica">{it.variacao}</div>}</td>
                      <td>
                        <select value={mp?.produto_id ?? ''} onChange={(e) => setMaps({ ...maps, [k]: { unidades: mp?.unidades || 1, produto_id: e.target.value } })}>
                          <option value="">Escolha…</option>
                          <option value="ignorar">— ignorar este item —</option>
                          {base.dados.produtos.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome}{p.tipo === 'kit' ? ' (kit)' : ''}</option>)}
                        </select>
                        {!mp && <Selo tipo="aviso">escolher</Selo>}
                      </td>
                      <td><input className="mini num" type="number" min="1" value={mp?.unidades || 1} onChange={(e) => setMaps({ ...maps, [k]: { produto_id: mp?.produto_id ?? '', unidades: Number(e.target.value) || 1 } })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Cartao>

          <Cartao titulo={`Pedidos encontrados (${pedidos.length})`}>
            <div className="tabela-rolagem">
              <table className="tabela compacta">
                <thead><tr><th /><th>Pedido</th><th>Data</th><th>Status</th><th>Itens</th><th className="num">Total</th><th>Frete (R$)</th><th>Impostos (R$)</th><th>Rastreio</th></tr></thead>
                <tbody>
                  {pedidos.map((p) => {
                    const ja = existentes.has(p.numero)
                    const c = conv(p)
                    const aj = ajustes[p.numero] || {}
                    return (
                      <tr key={p.numero} className={ja ? 'inativo' : ''}>
                        <td><input type="checkbox" disabled={ja} checked={!ja && !!marcados[p.numero]} onChange={(e) => setMarcados({ ...marcados, [p.numero]: e.target.checked })} /></td>
                        <td>{p.numero}{ja && <div><Selo>já importado</Selo></div>}</td>
                        <td>{p.data ? dataBR(p.data) : <span className="neg">?</span>}</td>
                        <td>{p.status}</td>
                        <td>{p.itens.length ? p.itens.map((i) => `${i.quantidade}× ${i.nome.slice(0, 40)}${i.variacao ? ' (' + i.variacao + ')' : ''} ${i.preco_unitario ? '@ ' + numero(i.preco_unitario, 2) : ''}`).join('; ') : <span className="neg">nenhum item reconhecido</span>}</td>
                        <td className="num">{p.total ? `${p.moeda} ${numero(p.total, 2)}` : '—'}{p.moeda !== 'BRL' && p.total && c ? <div className="dica">{moeda(p.total * c)}</div> : null}</td>
                        <td><Num className="mini num" value={aj.frete ?? Math.round((p.frete || 0) * c * 100) / 100} onChange={(v) => setAjustes({ ...ajustes, [p.numero]: { ...aj, frete: v || 0 } })} /></td>
                        <td><Num className="mini num" value={aj.impostos ?? Math.round((p.impostos || 0) * c * 100) / 100} onChange={(v) => setAjustes({ ...ajustes, [p.numero]: { ...aj, impostos: v || 0 } })} /></td>
                        <td>{p.rastreio || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="acoes-form">
              <button className="botao primario" disabled={salvando} onClick={importar}>{salvando ? 'Importando…' : 'Criar pedidos de compra'}</button>
            </div>
          </Cartao>
        </>
      )}
    </>
  )
}
