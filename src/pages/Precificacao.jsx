import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { Aviso, Carregando, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { moeda, normalizar, numero, pct } from '../lib/formato'
import { analisar, calcular, parametros, precoParaMargem, tarifaVigente } from '../lib/precificacao'

export default function Precificacao() {
  const { dados, erro, carregando, recarregar } = useDados(() => carregarBase({ tarifas: true, config: true, produtoConta: true }))
  const [contaId, setContaId] = useState(1)
  const [busca, setBusca] = useState('')
  const [precos, setPrecos] = useState({})
  const [detalhe, setDetalhe] = useState(null)
  const [soAlertas, setSoAlertas] = useState(false)
  const acao = useAcao()

  const linhas = useMemo(() => {
    if (!dados) return []
    const conta = dados.contas.find((c) => c.id === contaId)
    const tarifa = tarifaVigente(dados.tarifas, contaId)
    return dados.produtos.filter((p) => p.ativo && (!busca || normalizar(`${p.sku} ${p.nome}`).includes(normalizar(busca)))).map((p) => {
      const pc = dados.produtoConta.find((x) => x.produto_id === p.id && x.conta_id === contaId)
      const par = parametros({ produto: p, conta, tarifa, config: dados.config, pc })
      const precoAtual = precos[p.id] !== undefined ? precos[p.id] : (pc?.preco ?? null)
      return { p, pc, par, precoAtual, a: analisar(precoAtual, par), alterado: precos[p.id] !== undefined }
    }).filter((l) => !soAlertas || l.a.alerta)
  }, [dados, contaId, busca, precos, soAlertas])

  if (carregando) return <Pagina titulo="Precificação"><Carregando /></Pagina>
  if (erro) return <Pagina titulo="Precificação"><Aviso tipo="erro">{erro}</Aviso></Pagina>

  const tarifa = tarifaVigente(dados.tarifas, contaId)
  const alterados = linhas.filter((l) => l.alterado)

  async function salvar() {
    await acao.executar(async () => {
      const linhasPc = alterados.map((l) => ({ produto_id: l.p.id, conta_id: contaId, preco: l.precoAtual, atualizado_em: new Date().toISOString() }))
      ok(await supabase.from('produto_conta').upsert(linhasPc, { onConflict: 'produto_id,conta_id' }))
      setPrecos({})
      await recarregar()
      return linhasPc.length
    }, (n) => `${n} preço(s) salvo(s). Para mandar ao marketplace, use “Exportar planilhas” (ou “Anúncios”, no Mercado Livre conectado).`)
  }

  const aplicarSugeridos = () => setPrecos((x) => ({ ...x, ...Object.fromEntries(linhas.filter((l) => l.a.sugerido).map((l) => [l.p.id, l.a.sugerido])) }))

  return (
    <Pagina titulo="Precificação"
      subtitulo="Preço atual, mínimo (lucro zero), sugerido (margem-alvo), lucro, margem e ROI de cada produto em cada conta."
      acoes={<>
        <button className="botao" onClick={aplicarSugeridos}>Usar todos os sugeridos</button>
        <button className="botao primario" disabled={!alterados.length || acao.ocupado} onClick={salvar}>Salvar {alterados.length || ''} preço(s)</button>
      </>}>
      <div className="abas">
        {dados.contas.map((c) => (
          <button key={c.id} className={c.id === contaId ? 'ativa' : ''} onClick={() => { setContaId(c.id); setPrecos({}) }}>
            <span className="bolinha" style={{ background: c.cor }} />{c.nome}
          </button>
        ))}
      </div>
      <Aviso tipo="info">
        Tarifa em vigor: <b>{numero(tarifa?.comissao_pct, 1)}%</b> de comissão
        {Number(tarifa?.tarifa_fixa) > 0 && <> + <b>{moeda(tarifa.tarifa_fixa)}</b> por unidade</>}
        {tarifa?.faixas?.length > 0 && <> + custo por faixa de preço ({tarifa.faixas.map((f) => `${f.ate ? 'até ' + moeda(f.ate) : 'acima'}: ${moeda(f.valor)}`).join(' · ')})</>}
        . ADS {numero(dados.config.ads_pct, 1)}% · imposto {numero(dados.config.imposto_pct, 1)}% · embalagem {moeda(dados.config.embalagem)} · indiretos {moeda(dados.config.custos_indiretos)} · margem-alvo {numero(dados.config.margem_alvo_pct, 1)}%.{' '}
        <Link to="/configuracoes">Alterar</Link>
      </Aviso>
      <Mensagens acao={acao} />
      <div className="filtros">
        <input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="check"><input type="checkbox" checked={soAlertas} onChange={(e) => setSoAlertas(e.target.checked)} /> Só com alerta</label>
      </div>
      {!linhas.length ? <Vazio>Nenhum produto.</Vazio> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>SKU</th><th>Produto</th><th className="num">Custo</th><th className="num">Preço atual</th><th className="num">Mínimo</th><th className="num">Sugerido</th><th className="num">Lucro</th><th className="num">Margem</th><th className="num">ROI</th><th /></tr></thead>
            <tbody>
              {linhas.map(({ p, a, precoAtual, alterado, par }) => (
                <tr key={p.id} className={alterado ? 'alterado' : ''}>
                  <td><b>{p.sku}</b></td>
                  <td>{p.nome}{par.custo === 0 && <div className="neg dica">sem custo cadastrado</div>}</td>
                  <td className="num">{moeda(par.custo)}</td>
                  <td className="num"><Num className="mini num" value={precoAtual} onChange={(v) => setPrecos({ ...precos, [p.id]: v })} placeholder="—" /></td>
                  <td className="num">{a.minimo ? moeda(a.minimo) : '—'}</td>
                  <td className="num">
                    {a.sugerido ? <button className="link" title="Usar este preço" onClick={() => setPrecos({ ...precos, [p.id]: a.sugerido })}>{moeda(a.sugerido)}</button> : <span className="neg">impossível</span>}
                  </td>
                  <td className={`num ${a.atual?.lucro < 0 ? 'neg' : ''}`}>{a.atual ? moeda(a.atual.lucro) : '—'}</td>
                  <td className="num">{a.atual ? pct(a.atual.margem) : '—'}</td>
                  <td className="num">{a.atual ? pct(a.atual.roi) : '—'}</td>
                  <td>
                    {a.alerta === 'abaixo_minimo' && <Selo tipo="neg">prejuízo</Selo>}
                    {a.alerta === 'abaixo_alvo' && <Selo tipo="aviso">abaixo da meta</Selo>}
                    {' '}<button className="link" onClick={() => setDetalhe({ p, par, precoAtual })}>detalhar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detalhe && <Detalhe {...detalhe} onFechar={() => setDetalhe(null)} />}
    </Pagina>
  )
}

function Detalhe({ p, par, precoAtual, onFechar }) {
  const [margem, setMargem] = useState(par.margemPct)
  const [preco, setPreco] = useState(precoAtual || precoParaMargem(par, margem))
  const c = calcular(preco || 0, par)
  const pv = precoParaMargem(par, margem)
  const linha = (rotulo, v, neg = true) => <tr><td>{rotulo}</td><td className={`num ${neg && v ? 'neg' : ''}`}>{neg && v ? '−' : ''}{moeda(v)}</td></tr>
  return (
    <Modal titulo={`${p.sku} — ${par.conta.nome}`} onFechar={onFechar}>
      <div className="linha">
        <label className="campo"><span className="rotulo">Simular preço (R$)</span><Num value={preco} onChange={setPreco} /></label>
        <label className="campo"><span className="rotulo">Margem desejada (%)</span><Num value={margem} onChange={(v) => setMargem(v || 0)} /></label>
      </div>
      <p>Para {numero(margem, 1)}% de margem: <b>{pv ? moeda(pv) : 'impossível com esses percentuais'}</b> {pv && <button className="link" onClick={() => setPreco(pv)}>usar</button>}</p>
      <table className="tabela compacta">
        <tbody>
          <tr><td>Preço de venda</td><td className="num"><b>{moeda(c.preco)}</b></td></tr>
          {linha(`Comissão (${numero(par.comissaoPct, 1)}%)`, c.comissao)}
          {linha('Tarifa fixa por unidade', c.tarifaFixa)}
          {linha('Custo da faixa (frete / tarifa fixa ML)', c.faixa)}
          {linha(`ADS (${numero(par.adsPct, 1)}%)`, c.ads)}
          {linha(`Imposto (${numero(par.impostoPct, 1)}%)`, c.imposto)}
          {linha('Embalagem + custos indiretos', par.fixos)}
          {linha('Custo do produto', par.custo)}
          <tr className="total"><td>Lucro</td><td className={`num ${c.lucro < 0 ? 'neg' : ''}`}>{moeda(c.lucro)}</td></tr>
          <tr><td>Margem</td><td className="num">{pct(c.margem)}</td></tr>
          <tr><td>ROI (lucro ÷ custo)</td><td className="num">{pct(c.roi)}</td></tr>
          <tr><td>Líquido que o marketplace repassa</td><td className="num">{moeda(c.liquido)}</td></tr>
        </tbody>
      </table>
    </Modal>
  )
}
