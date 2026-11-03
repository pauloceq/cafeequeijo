import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Aviso, Barra, Campo, Carregando, Cartao, Num, Pagina, Passos, Selo, useDados } from '../components/ui'
import { mensagemErro, ok } from '../lib/erros'
import { carregarBase } from '../lib/base'
import { lerArquivo } from '../lib/planilha'
import { analisarPlanilha } from '../lib/importacaoInicial'
import { moeda, normalizar, numero } from '../lib/formato'

const NIVEL = { erro: ['neg', 'resolver'], aviso: ['aviso', 'conferir'], info: ['info', 'informação'] }

export default function ImportacaoInicial() {
  const base = useDados(() => carregarBase({ locais: true, tarifas: true }))
  const [abas, setAbas] = useState(null)
  const [erro, setErro] = useState(null)
  const [lendo, setLendo] = useState(false)
  const [mapaNomes, setMapaNomes] = useState({})
  const [contaML, setContaML] = useState('Mercado Livre 1')
  const [vendasAntigas, setVendasAntigas] = useState(true)
  const [rejeitarKits, setRejeitarKits] = useState([])
  const [aplicarConfig, setAplicarConfig] = useState(true)
  const [ajEstoque, setAjEstoque] = useState({})  // "sku|local" -> { quantidade, sku }
  const [filtroNivel, setFiltroNivel] = useState('')
  const [execucao, setExecucao] = useState(null)

  const r = useMemo(() => abas ? analisarPlanilha(abas, { mapaNomes, contaML, incluirVendasAntigas: vendasAntigas, rejeitarKits }) : null,
    [abas, mapaNomes, contaML, vendasAntigas, rejeitarKits])

  const estoqueFinal = useMemo(() => (r?.estoque || []).map((e) => {
    const _k = `${e.sku}|${e.local}|${e.origem}`
    return { ...e, ...(ajEstoque[_k] || {}), _k }
  }), [r, ajEstoque])

  async function abrir(file) {
    setErro(null); setLendo(true); setExecucao(null)
    try {
      const a = await lerArquivo(file)
      if (!a.some((x) => normalizar(x.nome) === 'precificacao')) throw new Error('Não encontrei a aba “Precificação”. Envie a planilha antiga completa (.xlsx).')
      setAbas(a)
    } catch (e) { setErro(mensagemErro(e)) } finally { setLendo(false) }
  }

  async function importar() {
    if (!confirm('Importar agora? Produtos que já existem (mesmo SKU) não são alterados. Pode rodar de novo sem duplicar.')) return
    const log = []
    const passo = (msg) => { log.push(msg); setExecucao((x) => ({ ...x, log: [...log] })) }
    setExecucao({ log: [], feito: 0, total: 1 })
    try {
      const contas = base.dados.contas
      const contaPorNome = (n) => contas.find((c) => normalizar(c.nome) === normalizar(n))
      // 1. configuração
      if (aplicarConfig && r.config) {
        const c = Object.fromEntries(Object.entries(r.config).filter(([, v]) => v !== null))
        ok(await supabase.from('config_geral').update(c).eq('id', 1))
        passo(`Custos por venda atualizados: embalagem ${moeda(c.embalagem)}, indiretos ${moeda(c.custos_indiretos)}, ADS ${numero(c.ads_pct, 1)}%.`)
      }
      // 2. locais e fornecedores
      let locais = ok(await supabase.from('locais').select('*'))
      for (const nome of [...new Set(estoqueFinal.map((e) => e.local))]) {
        if (!locais.find((l) => normalizar(l.nome) === normalizar(nome))) {
          ok(await supabase.from('locais').insert({ nome })); passo(`Local “${nome}” criado.`)
        }
      }
      locais = ok(await supabase.from('locais').select('*'))
      let fornecedores = ok(await supabase.from('fornecedores').select('*'))
      const fornecedorDe = async (nome) => {
        if (/ali\s*express/i.test(nome)) return fornecedores.find((f) => f.tipo === 'aliexpress').id
        let f = fornecedores.find((x) => normalizar(x.nome) === normalizar(nome))
        if (!f) { f = ok(await supabase.from('fornecedores').insert({ nome }).select().single()); fornecedores.push(f); passo(`Fornecedor “${nome}” criado.`) }
        return f.id
      }
      // 3. produtos
      const existentes = ok(await supabase.from('produtos').select('id,sku'))
      const idPorSku = Object.fromEntries(existentes.map((p) => [p.sku, p.id]))
      const novos = r.produtos.filter((p) => !idPorSku[p.sku])
      if (novos.length) {
        const ins = ok(await supabase.from('produtos').insert(novos.map((p) => ({
          sku: p.sku, nome: p.nome, tipo: p.tipo, ativo: p.ativo !== false,
          preco_venda: Math.round((p.preco_ml || p.preco_shopee || 0) * 100) / 100,
          observacao: `Importado da planilha (${p.origem})`,
        }))).select('id,sku'))
        ins.forEach((p) => (idPorSku[p.sku] = p.id))
      }
      passo(`${novos.length} produto(s) criado(s); ${r.produtos.length - novos.length} já existiam (não alterados).`)
      const criados = new Set(novos.map((p) => p.sku))
      // 4. kits
      let nk = 0
      for (const k of r.kits) {
        if (!criados.has(k.kit)) continue
        ok(await supabase.from('kit_componentes').insert(k.componentes.map((c) => ({ kit_id: idPorSku[k.kit], peca_id: idPorSku[c.sku], quantidade: c.quantidade }))))
        nk++
      }
      passo(`${nk} kit(s) com lista de peças.`)
      // 5. custos
      for (const p of novos.filter((x) => x.tipo === 'peca' && x.custo > 0)) {
        ok(await supabase.rpc('definir_custo', { p_produto_id: idPorSku[p.sku], p_custo: p.custo, p_obs: 'Custo da planilha antiga' }))
      }
      passo('Custos médios definidos.')
      // 6. preços e comissões por conta
      const tarifaPadrao = (cid) => base.dados.tarifas.find((t) => t.conta_id === cid)?.comissao_pct
      const pcs = []
      for (const p of novos) {
        for (const c of contas) {
          const preco = c.marketplace === 'shopee' ? p.preco_shopee : c.marketplace === 'mercadolivre' ? p.preco_ml : null
          const com = c.marketplace === 'shopee' ? p.comissao_shopee : c.marketplace === 'mercadolivre' ? p.comissao_ml : null
          if (!preco && com === null) continue
          pcs.push({ produto_id: idPorSku[p.sku], conta_id: c.id, preco: preco ? Math.round(preco * 100) / 100 : null,
            comissao_pct: com !== null && com !== undefined && Number(com) !== Number(tarifaPadrao(c.id)) ? com : null })
        }
      }
      if (pcs.length) ok(await supabase.from('produto_conta').upsert(pcs, { onConflict: 'produto_id,conta_id' }))
      passo(`${pcs.length} preço(s)/comissão(ões) por conta gravados.`)
      // 7. estoque inicial (por contagem: rodar de novo não soma)
      let ne = 0
      for (const e of estoqueFinal) {
        const local = locais.find((l) => normalizar(l.nome) === normalizar(e.local))
        const pid = idPorSku[e.sku]
        if (!pid || !local) continue
        if (e.quantidade > 0) {
          ok(await supabase.rpc('ajustar_estoque', { p_produto_id: pid, p_local_id: local.id, p_operacao: 'definir', p_quantidade: e.quantidade, p_motivo: 'inicial', p_observacao: `Importação inicial: ${e.origem}`.slice(0, 300) }))
          ne++
        }
        if (e.localizacao) await supabase.from('estoque_locais').upsert({ produto_id: pid, local_id: local.id, localizacao: e.localizacao }, { onConflict: 'produto_id,local_id' })
      }
      passo(`Estoque inicial lançado em ${ne} posição(ões).`)
      // 8. compras históricas
      const totalLote = r.compras.length + r.vendas.length
      let feitos = 0, nc = 0, nv = 0, pulados = 0
      setExecucao((x) => ({ ...x, feito: 0, total: totalLote }))
      for (const cp of r.compras) {
        const itens = cp.itens.filter((i) => i.sku && idPorSku[i.sku]).map((i) => ({ produto_id: idPorSku[i.sku], quantidade: i.quantidade, custo_unitario: i.custo_unitario, descricao_externa: i.nome }))
        if (itens.length) {
          const id = ok(await supabase.rpc('criar_pedido_compra', { p: { fornecedor_id: await fornecedorDe(cp.fornecedor), origem: 'historico', numero_externo: cp.numero, data_pedido: cp.data.toISOString().slice(0, 10), observacao: 'Histórico da planilha antiga', itens } }))
          id === null ? pulados++ : nc++
        }
        setExecucao((x) => ({ ...x, feito: ++feitos }))
      }
      passo(`${nc} compra(s) histórica(s) importada(s)${pulados ? `, ${pulados} já existiam` : ''}. (Não mexem no estoque nem no custo.)`)
      // 9. vendas históricas
      pulados = 0
      const erros = []
      for (const v of r.vendas) {
        const conta = contaPorNome(v.conta)
        const itens = v.itens.filter((i) => idPorSku[i.sku]).map((i) => ({ produto_id: idPorSku[i.sku], quantidade: i.quantidade, preco_unitario: i.preco_unitario, ...(i.custo_unitario !== null ? { custo_unitario: i.custo_unitario } : {}) }))
        if (conta && itens.length) {
          const { data, error } = await supabase.rpc('registrar_venda', { p_venda: {
            conta_id: conta.id, data: v.data.toISOString(), codigo_externo: v.codigo, historico: true,
            taxa_marketplace: v.taxa ?? 0, usar_taxa_prevista: v.taxa === null, frete: v.frete || 0, itens,
          } })
          if (error) erros.push(`${v.aba} linha ${v.linha}: ${mensagemErro(error)}`)
          else data === null ? pulados++ : nv++
        }
        setExecucao((x) => ({ ...x, feito: ++feitos }))
      }
      passo(`${nv} venda(s) histórica(s) importada(s)${pulados ? `, ${pulados} já existiam` : ''}. (Não mexem no estoque.)`)
      erros.slice(0, 20).forEach((e) => passo('⚠ ' + e))
      passo('✔ Importação concluída. Confira Produtos, Estoque e Precificação.')
      setExecucao((x) => ({ ...x, fim: true }))
    } catch (e) {
      passo('✖ Parou com erro: ' + mensagemErro(e) + ' — corrija e clique em importar de novo (o que já entrou não duplica).')
      setExecucao((x) => ({ ...x, fim: true }))
    }
  }

  if (base.carregando) return <Pagina titulo="Importação inicial"><Carregando /></Pagina>
  if (base.erro) return <Pagina titulo="Importação inicial"><Aviso tipo="erro">{base.erro}</Aviso></Pagina>
  const erros = r?.problemas.filter((p) => p.nivel === 'erro') || []

  return (
    <Pagina titulo="Importação inicial da planilha antiga" subtitulo="Traz produtos, kits, custos, preços, estoque, pedidos de compra e histórico de vendas da sua planilha “Precificação.xlsx”. Nada é gravado antes de você revisar.">
      <Cartao titulo="1. Escolha a planilha">
        <Passos>
          <li>Use o arquivo <b>Precificação.xlsx</b> com as abas Precificação, Pedidos, Vendas, Estoque (e, se tiver, Precificação Antiga, Vendas Antiga e Estoque Escola).</li>
          <li>O app analisa tudo e mostra o que vai importar e o que parece inconsistente.</li>
          <li>Resolva os itens vermelhos, confira os amarelos e clique em <b>Importar</b>.</li>
        </Passos>
        <input type="file" accept=".xlsx" onChange={(e) => e.target.files[0] && abrir(e.target.files[0])} />
        {lendo && <Carregando texto="Lendo planilha…" />}
        <Aviso tipo="erro">{erro}</Aviso>
      </Cartao>

      {r && (
        <>
          <div className="numeros">
            <div className="numero"><span>Produtos</span><b>{r.produtos.length}</b><small>{r.produtos.filter((p) => p.tipo === 'kit').length} kits · {r.novasPecas.length} peças base novas</small></div>
            <div className="numero"><span>Posições de estoque</span><b>{estoqueFinal.length}</b></div>
            <div className="numero"><span>Compras históricas</span><b>{r.compras.length}</b></div>
            <div className="numero"><span>Vendas históricas</span><b>{r.vendas.length}</b></div>
            <div className="numero"><span>Para resolver</span><b className={erros.length ? 'neg' : ''}>{erros.length}</b></div>
          </div>

          <Cartao titulo="2. Opções">
            <div className="linha">
              <Campo rotulo="Vendas “ML” da planilha vão para">
                <select value={contaML} onChange={(e) => setContaML(e.target.value)}>
                  {base.dados.contas.filter((c) => c.marketplace === 'mercadolivre').map((c) => <option key={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              <label className="check"><input type="checkbox" checked={vendasAntigas} onChange={(e) => setVendasAntigas(e.target.checked)} /> Incluir aba “Vendas Antiga”</label>
              {r.config && <label className="check"><input type="checkbox" checked={aplicarConfig} onChange={(e) => setAplicarConfig(e.target.checked)} /> Usar custos da planilha: embalagem {moeda(r.config.embalagem)}, indiretos {moeda(r.config.custos_indiretos)}, ADS {numero(r.config.ads_pct, 1)}%</label>}
            </div>
          </Cartao>

          {r.naoReconhecidos.length > 0 && (
            <Cartao titulo={`3. Nomes que não reconheci (${r.naoReconhecidos.length})`}>
              <p className="dica">Escolha o produto certo para cada nome. Ao escolher, a análise é refeita.</p>
              <table className="tabela compacta">
                <thead><tr><th>Nome na planilha</th><th>Onde aparece</th><th>Produto</th></tr></thead>
                <tbody>{r.naoReconhecidos.map((n) => (
                  <tr key={n.nome}>
                    <td>{n.nome}</td><td className="dica">{n.ocorrencias.slice(0, 3).join(', ')}{n.ocorrencias.length > 3 ? ` e mais ${n.ocorrencias.length - 3}` : ''}</td>
                    <td><select value={mapaNomes[normalizar(n.nome)] || ''} onChange={(e) => setMapaNomes({ ...mapaNomes, [normalizar(n.nome)]: e.target.value })}>
                      <option value="">Escolha…</option><option value="__ignorar">— ignorar —</option>
                      {r.produtos.map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.nome}</option>)}
                    </select></td>
                  </tr>
                ))}</tbody>
              </table>
            </Cartao>
          )}

          <Cartao titulo="4. Kits e peças">
            <p className="dica">Pacotes e kits viram “kit” com lista de peças; o estoque fica só nas peças. Desmarque um kit “Kit …” se a sugestão estiver errada (ele vira peça comum).</p>
            <table className="tabela compacta">
              <thead><tr><th>Kit</th><th>Lista de peças</th><th>Por quê</th><th>Aceitar</th></tr></thead>
              <tbody>
                {r.kits.map((k) => (
                  <tr key={k.kit}>
                    <td><b>{k.kit}</b><div className="dica">{r.produtos.find((p) => p.sku === k.kit)?.nome}</div></td>
                    <td>{k.componentes.map((c) => `${c.quantidade}× ${c.sku}`).join(' + ')}</td><td className="dica">{k.motivo}</td>
                    <td>{/^custo/.test(k.motivo) ? <input type="checkbox" checked onChange={() => setRejeitarKits([...rejeitarKits, k.kit])} /> : '✔'}</td>
                  </tr>
                ))}
                {rejeitarKits.map((s) => <tr key={s} className="inativo"><td>{s}</td><td colSpan={2}>sugestão recusada (fica como peça)</td><td><input type="checkbox" checked={false} onChange={() => setRejeitarKits(rejeitarKits.filter((x) => x !== s))} /></td></tr>)}
              </tbody>
            </table>
          </Cartao>

          <Cartao titulo="5. Estoque inicial (pode corrigir as quantidades)">
            <div className="tabela-rolagem" style={{ maxHeight: 420 }}>
              <table className="tabela compacta">
                <thead><tr><th>Local</th><th>Peça</th><th className="num">Quantidade</th><th>Localização</th><th>De onde veio</th></tr></thead>
                <tbody>{estoqueFinal.map((e) => {
                  const k = e._k
                  return (
                    <tr key={k} className={e.revisar ? 'alterado' : ''}>
                      <td>{e.local}</td>
                      <td>{e.local !== 'Principal' ? (
                        <select value={e.sku} onChange={(ev) => setAjEstoque({ ...ajEstoque, [k]: { ...ajEstoque[k], sku: ev.target.value } })}>
                          {r.produtos.filter((p) => p.tipo === 'peca').map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.nome}</option>)}
                        </select>) : <>{e.sku}<div className="dica">{r.produtos.find((p) => p.sku === e.sku)?.nome}</div></>}</td>
                      <td className="num"><Num casas={0} className="mini num" value={e.quantidade} onChange={(v) => setAjEstoque({ ...ajEstoque, [k]: { ...ajEstoque[k], quantidade: v || 0 } })} /></td>
                      <td>{e.localizacao}</td><td className="dica">{e.origem}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </Cartao>

          <Cartao titulo={`6. Dados para revisar (${r.problemas.length})`} acoes={
            <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value)}>
              <option value="">Todos</option><option value="erro">Só “resolver”</option><option value="aviso">Só “conferir”</option><option value="info">Só informações</option>
            </select>}>
            <div className="tabela-rolagem" style={{ maxHeight: 420 }}>
              <table className="tabela compacta">
                <thead><tr><th /><th>Aba</th><th>Linha</th><th>O que encontrei</th></tr></thead>
                <tbody>{r.problemas.filter((p) => !filtroNivel || p.nivel === filtroNivel)
                  .sort((a, b) => ['erro', 'aviso', 'info'].indexOf(a.nivel) - ['erro', 'aviso', 'info'].indexOf(b.nivel))
                  .map((p, i) => <tr key={i}><td><Selo tipo={NIVEL[p.nivel][0]}>{NIVEL[p.nivel][1]}</Selo></td><td>{p.aba}</td><td>{p.linha ?? ''}</td><td>{p.msg}</td></tr>)}</tbody>
              </table>
            </div>
          </Cartao>

          <Cartao titulo="7. Importar">
            {r.naoReconhecidos.length > 0 && <Aviso tipo="aviso">Ainda há {r.naoReconhecidos.length} nome(s) sem produto: essas linhas ficam de fora (você pode importar mesmo assim e lançar depois).</Aviso>}
            <p className="dica">Compras e vendas antigas entram como <b>histórico</b>: aparecem nos relatórios, mas não mexem no estoque nem no custo médio (o estoque de partida é o da tabela acima). Pode rodar de novo: nada é duplicado.</p>
            <button className="botao primario" disabled={!!execucao && !execucao.fim} onClick={importar}>Importar tudo</button>
            {execucao && (
              <>
                {execucao.total > 1 && <Barra valor={execucao.feito} max={execucao.total} />}
                <ul className="log">{execucao.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </>
            )}
          </Cartao>
        </>
      )}
    </Pagina>
  )
}
