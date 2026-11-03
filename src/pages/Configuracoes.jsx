import { useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { Abas, Aviso, Campo, Carregando, Cartao, Mensagens, Modal, Num, Pagina, Selo, useAcao, useDados } from '../components/ui'
import { ok } from '../lib/erros'
import { dataBR, hojeISO, moeda, numero } from '../lib/formato'
import { tarifaVigente } from '../lib/precificacao'

export default function Configuracoes() {
  const [aba, setAba] = useState('custos')
  return (
    <Pagina titulo="Configurações">
      <Abas abas={[['custos', 'Custos e parâmetros'], ['tarifas', 'Tarifas por conta'], ['contas', 'Contas'], ['locais', 'Locais de estoque'], ['usuarios', 'Usuários']]} ativa={aba} onTrocar={setAba} />
      {aba === 'custos' && <Custos />}
      {aba === 'tarifas' && <Tarifas />}
      {aba === 'contas' && <Contas />}
      {aba === 'locais' && <Locais />}
      {aba === 'usuarios' && <Usuarios />}
    </Pagina>
  )
}

function Custos() {
  const { dados, erro, carregando, recarregar } = useDados(async () => ok(await supabase.from('config_geral').select('*').eq('id', 1).single()))
  const [c, setC] = useState(null)
  const acao = useAcao()
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  const v = c || dados
  const set = (k) => (x) => setC({ ...v, [k]: x ?? 0 })
  return (
    <Cartao>
      <h3>Custos por venda</h3>
      <div className="linha">
        <Campo rotulo="Embalagem / etiqueta / fita (R$ por venda)"><Num value={v.embalagem} onChange={set('embalagem')} /></Campo>
        <Campo rotulo="Custos indiretos (R$ por venda)" dica="Transporte até a agência, contador…"><Num value={v.custos_indiretos} onChange={set('custos_indiretos')} /></Campo>
        <Campo rotulo="ADS (% do preço)" dica="Cada produto/conta pode ter o seu"><Num value={v.ads_pct} onChange={set('ads_pct')} /></Campo>
        <Campo rotulo="Imposto sobre faturamento (%)" dica="Ex.: Simples Nacional"><Num value={v.imposto_pct} onChange={set('imposto_pct')} /></Campo>
        <Campo rotulo="Margem-alvo (%)"><Num value={v.margem_alvo_pct} onChange={set('margem_alvo_pct')} /></Campo>
      </div>
      <h3>Reposição e relatórios</h3>
      <div className="linha">
        <Campo rotulo="Média de vendas de (dias)"><select value={v.dias_media_vendas} onChange={(e) => set('dias_media_vendas')(Number(e.target.value))}><option>30</option><option>60</option><option>90</option></select></Campo>
        <Campo rotulo="Estoque de segurança (dias)"><Num casas={0} value={v.dias_seguranca} onChange={set('dias_seguranca')} /></Campo>
        <Campo rotulo="Comprar para cobrir (dias)"><Num casas={0} value={v.dias_cobertura_alvo} onChange={set('dias_cobertura_alvo')} /></Campo>
        <Campo rotulo="Produto parado após (dias)"><Num casas={0} value={v.dias_produto_parado} onChange={set('dias_produto_parado')} /></Campo>
      </div>
      <Mensagens acao={acao} />
      <button className="botao primario" disabled={!c || acao.ocupado} onClick={() => acao.executar(async () => {
        const { id: _id, atualizado_em: _a, ...campos } = c
        ok(await supabase.from('config_geral').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', 1))
        setC(null); recarregar()
      }, 'Salvo. Vendas novas usam estes valores; vendas antigas mantêm os custos do dia em que foram feitas.')}>Salvar</button>
    </Cartao>
  )
}

function Tarifas() {
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [contas, tarifas] = await Promise.all([
      supabase.from('contas').select('*').order('id').then(ok),
      supabase.from('tarifas').select('*').order('vigente_desde', { ascending: false }).then(ok),
    ])
    return { contas, tarifas }
  })
  const [ed, setEd] = useState(null)
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  return (
    <>
      <Aviso tipo="info">Quando o marketplace mudar as tarifas, crie uma <b>nova vigência</b> (não edite a antiga): vendas passadas continuam com o cálculo da época.</Aviso>
      <div className="grade-2">
        {dados.contas.map((c) => {
          const lista = dados.tarifas.filter((t) => t.conta_id === c.id)
          const atual = tarifaVigente(dados.tarifas, c.id)
          return (
            <Cartao key={c.id} titulo={<><span className="bolinha" style={{ background: c.cor }} />{c.nome}</>}
              acoes={<button className="botao" onClick={() => setEd({ conta_id: c.id, vigente_desde: hojeISO(), comissao_pct: atual?.comissao_pct ?? 0, tarifa_fixa: atual?.tarifa_fixa ?? 0, faixas: atual?.faixas ?? [], observacao: '' })}>+ Nova vigência</button>}>
              {lista.map((t) => (
                <div key={t.id} className={`tarifa ${t === atual ? 'atual' : ''}`}>
                  <div><b>Desde {dataBR(t.vigente_desde + 'T12:00')}</b> {t === atual && <Selo tipo="ok">em vigor</Selo>} <button className="link" onClick={() => setEd(t)}>editar</button></div>
                  <div>Comissão {numero(t.comissao_pct, 1)}%{Number(t.tarifa_fixa) > 0 && ` + ${moeda(t.tarifa_fixa)} por unidade`}</div>
                  {t.faixas?.length > 0 && <div className="dica">{t.faixas.map((f) => `${moeda(f.de)}–${f.ate ? moeda(f.ate) : '∞'}: ${moeda(f.valor)}`).join(' · ')}</div>}
                  {t.observacao && <div className="dica">{t.observacao}</div>}
                </div>
              ))}
            </Cartao>
          )
        })}
      </div>
      {ed && <EditarTarifa t={ed} onFechar={() => setEd(null)} onSalvo={() => { setEd(null); recarregar() }} />}
    </>
  )
}

function EditarTarifa({ t, onFechar, onSalvo }) {
  const [v, setV] = useState({ ...t, faixas: (t.faixas || []).map((f) => ({ ...f })) })
  const acao = useAcao()
  const upF = (i, k, x) => setV({ ...v, faixas: v.faixas.map((f, j) => (j === i ? { ...f, [k]: x } : f)) })
  return (
    <Modal titulo={t.id ? 'Editar tarifa' : 'Nova vigência de tarifa'} onFechar={onFechar}>
      <div className="form">
        <div className="linha">
          <Campo rotulo="Vigente desde"><input type="date" value={v.vigente_desde} onChange={(e) => setV({ ...v, vigente_desde: e.target.value })} /></Campo>
          <Campo rotulo="Comissão (%)"><Num value={v.comissao_pct} onChange={(x) => setV({ ...v, comissao_pct: x || 0 })} /></Campo>
          <Campo rotulo="Tarifa fixa por unidade (R$)"><Num value={v.tarifa_fixa} onChange={(x) => setV({ ...v, tarifa_fixa: x || 0 })} /></Campo>
        </div>
        <fieldset>
          <legend>Faixas por preço (frete ou tarifa fixa que muda com o preço)</legend>
          <table className="tabela compacta">
            <thead><tr><th>De (R$)</th><th>Até (R$) — vazio = sem limite</th><th>Valor cobrado (R$)</th><th /></tr></thead>
            <tbody>
              {v.faixas.map((f, i) => (
                <tr key={i}>
                  <td><Num value={f.de} onChange={(x) => upF(i, 'de', x || 0)} /></td>
                  <td><Num value={f.ate} onChange={(x) => upF(i, 'ate', x)} /></td>
                  <td><Num value={f.valor} onChange={(x) => upF(i, 'valor', x || 0)} /></td>
                  <td><button className="link" onClick={() => setV({ ...v, faixas: v.faixas.filter((_, j) => j !== i) })}>remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="botao" onClick={() => setV({ ...v, faixas: [...v.faixas, { de: 0, ate: null, valor: 0 }] })}>+ Faixa</button>
        </fieldset>
        <Campo rotulo="Observação"><input value={v.observacao || ''} onChange={(e) => setV({ ...v, observacao: e.target.value })} /></Campo>
        <Mensagens acao={acao} />
        <div className="acoes-form">
          {t.id && <button className="botao perigo" onClick={() => confirm('Excluir esta vigência?') && acao.executar(async () => { ok(await supabase.from('tarifas').delete().eq('id', t.id)); onSalvo() })}>Excluir</button>}
          <span style={{ flex: 1 }} />
          <button className="botao primario" disabled={acao.ocupado} onClick={() => acao.executar(async () => {
            const faixas = v.faixas.map((f) => ({ de: Number(f.de) || 0, ate: f.ate === null || f.ate === '' ? null : Number(f.ate), valor: Number(f.valor) || 0 })).sort((a, b) => a.de - b.de)
            const campos = { conta_id: v.conta_id, vigente_desde: v.vigente_desde, comissao_pct: v.comissao_pct, tarifa_fixa: v.tarifa_fixa, faixas, observacao: v.observacao || null }
            if (t.id) ok(await supabase.from('tarifas').update(campos).eq('id', t.id))
            else ok(await supabase.from('tarifas').insert(campos))
            onSalvo()
          })}>Salvar</button>
        </div>
      </div>
    </Modal>
  )
}

function Contas() {
  const { dados, erro, carregando, recarregar } = useDados(async () => ok(await supabase.from('contas').select('*').order('id')))
  const acao = useAcao()
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  const salvar = (c, campos) => acao.executar(async () => { ok(await supabase.from('contas').update(campos).eq('id', c.id)); recarregar() })
  return (
    <Cartao>
      <Mensagens acao={acao} />
      <table className="tabela">
        <thead><tr><th>Nome</th><th>Marketplace</th><th>Cor</th><th>Dias até liberar o dinheiro</th><th>Ativa</th></tr></thead>
        <tbody>{dados.map((c) => (
          <tr key={c.id}>
            <td><input defaultValue={c.nome} onBlur={(e) => e.target.value !== c.nome && salvar(c, { nome: e.target.value })} /></td>
            <td>{c.marketplace}</td>
            <td><input type="color" defaultValue={c.cor || '#888888'} onBlur={(e) => salvar(c, { cor: e.target.value })} /></td>
            <td><input className="mini num" type="number" defaultValue={c.dias_liberacao} onBlur={(e) => Number(e.target.value) !== c.dias_liberacao && salvar(c, { dias_liberacao: Number(e.target.value) || 0 })} /></td>
            <td><input type="checkbox" checked={c.ativa} onChange={(e) => salvar(c, { ativa: e.target.checked })} /></td>
          </tr>
        ))}</tbody>
      </table>
      <p className="dica">“Dias até liberar” alimenta o Contas a receber e o Fluxo de caixa.</p>
    </Cartao>
  )
}

function Locais() {
  const { dados, erro, carregando, recarregar } = useDados(async () => ok(await supabase.from('locais').select('*').order('id')))
  const [novo, setNovo] = useState('')
  const acao = useAcao()
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  const salvar = (l, campos) => acao.executar(async () => {
    if (campos.padrao) ok(await supabase.from('locais').update({ padrao: false }).neq('id', l.id))
    ok(await supabase.from('locais').update(campos).eq('id', l.id)); recarregar()
  })
  return (
    <Cartao>
      <Mensagens acao={acao} />
      <table className="tabela">
        <thead><tr><th>Nome</th><th>Vendas baixam daqui</th><th>Ativo</th></tr></thead>
        <tbody>{dados.map((l) => (
          <tr key={l.id}>
            <td><input defaultValue={l.nome} onBlur={(e) => e.target.value !== l.nome && salvar(l, { nome: e.target.value })} /></td>
            <td><input type="radio" name="padrao" checked={l.padrao} onChange={() => salvar(l, { padrao: true })} /></td>
            <td><input type="checkbox" checked={l.ativo} onChange={(e) => salvar(l, { ativo: e.target.checked })} /></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="linha-inline">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Ex.: Estoque Escola" />
        <button className="botao" disabled={!novo.trim()} onClick={() => acao.executar(async () => { ok(await supabase.from('locais').insert({ nome: novo.trim() })); setNovo(''); recarregar() })}>+ Adicionar local</button>
      </div>
      <p className="dica">A localização física (prateleira, armário) de cada peça é preenchida na tela Estoque.</p>
    </Cartao>
  )
}

function Usuarios() {
  const { perfil } = useAuth()
  const { dados, erro, carregando, recarregar } = useDados(async () => ok(await supabase.from('perfis').select('*').order('criado_em')))
  const acao = useAcao()
  if (carregando) return <Carregando />
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  return (
    <Cartao>
      <Aviso tipo="info">Para criar um usuário: no Supabase, vá em <b>Authentication → Users → Add user → Create new user</b>, informe e-mail e senha e marque <b>Auto Confirm User</b>. Ele aparece aqui como ajudante.</Aviso>
      <Mensagens acao={acao} />
      <table className="tabela">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th></tr></thead>
        <tbody>{dados.map((u) => (
          <tr key={u.id}>
            <td><input defaultValue={u.nome || ''} onBlur={(e) => acao.executar(async () => { ok(await supabase.from('perfis').update({ nome: e.target.value }).eq('id', u.id)) })} /></td>
            <td>{u.email}</td>
            <td>
              <select value={u.papel} disabled={u.id === perfil?.id} onChange={(e) => acao.executar(async () => { ok(await supabase.from('perfis').update({ papel: e.target.value }).eq('id', u.id)); recarregar() })}>
                <option value="dono">Dono (vê tudo)</option><option value="ajudante">Ajudante (lança e consulta)</option>
              </select>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Cartao>
  )
}
