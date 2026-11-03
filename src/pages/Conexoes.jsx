import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { Aviso, Campo, Carregando, Cartao, Mensagens, Pagina, Passos, Selo, useAcao, useDados, Vazio } from '../components/ui'
import { mensagemErro, ok } from '../lib/erros'
import { chamarConexoes } from '../lib/funcoes'
import { dataHoraBR } from '../lib/formato'

const STATUS = { conectada: ['ok', 'conectada'], desconectada: ['neutro', 'desconectada'], expirada: ['aviso', 'reconectar'], erro: ['neg', 'erro'] }

function Copiar({ texto }) {
  const [ok2, setOk] = useState(false)
  return (
    <div className="copiar">
      <code>{texto}</code>
      <button className="botao" onClick={() => { navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500) }}>{ok2 ? 'Copiado!' : 'Copiar'}</button>
    </div>
  )
}

export default function Conexoes() {
  const [params] = useSearchParams()
  const [cred, setCred] = useState({ client_id: '', client_secret: '' })
  const [sql, setSql] = useState(null)
  const [filtroLog, setFiltroLog] = useState('')
  const acao = useAcao()
  const { dados, erro, carregando, recarregar } = useDados(async () => {
    const [contas, conexoes, logs] = await Promise.all([
      supabase.from('contas').select('*').order('id').then(ok),
      supabase.from('conexoes').select('*').then(ok),
      supabase.from('sync_logs').select('*').order('criado_em', { ascending: false }).limit(150).then(ok),
    ])
    let status = null, erroFuncoes = null
    try { status = await chamarConexoes({ acao: 'status' }) } catch (e) { erroFuncoes = mensagemErro(e) }
    return { contas, conexoes, logs, status, erroFuncoes }
  })

  if (carregando) return <Pagina titulo="Conexão com o Mercado Livre"><Carregando /></Pagina>
  if (erro) return <Pagina titulo="Conexão com o Mercado Livre"><Aviso tipo="erro">{erro}</Aviso></Pagina>

  const { contas, conexoes, logs, status, erroFuncoes } = dados
  const credOk = status && !status.faltando?.mercadolivre?.length
  const contasML = contas.filter((c) => c.marketplace === 'mercadolivre')

  async function conectar(conta) {
    await acao.executar(async () => {
      const retorno = window.location.href.split('#')[0]
      const r = await chamarConexoes({ acao: 'iniciar_oauth', conta_id: conta.id, retorno })
      window.location.href = r.url
    })
  }

  return (
    <Pagina titulo="Conexão com o Mercado Livre" subtitulo="Opcional: com a conexão, as vendas das 2 contas do Mercado Livre entram sozinhas e você edita estoque/preço dos anúncios pelo app.">
      {params.get('resultado') && (
        <Aviso tipo={params.get('resultado') === 'ok' ? 'ok' : 'erro'}>{params.get('mensagem')}</Aviso>
      )}
      <Mensagens acao={acao} />

      <Cartao titulo="Passo 1 — Publicar as funções do servidor">
        {erroFuncoes ? (
          <>
            <Aviso tipo="aviso">{erroFuncoes}</Aviso>
            <Passos>
              <li>No Supabase, clique no seu avatar (canto superior direito) → <b>Account preferences</b> → <b>Access Tokens</b> → <b>Generate new token</b>. Copie o token.</li>
              <li>No GitHub, abra o repositório → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>New repository secret</b>:
                <ul><li>Nome <code>SUPABASE_ACCESS_TOKEN</code> → cole o token.</li><li>Nome <code>SUPABASE_PROJECT_REF</code> → o código do projeto (o pedaço <code>xxxx</code> de https://xxxx.supabase.co).</li></ul>
              </li>
              <li>No GitHub, vá em <b>Actions</b> → <b>Publicar funções do Supabase</b> → <b>Run workflow</b>. Espere ficar verde (1–2 min) e recarregue esta página.</li>
            </Passos>
          </>
        ) : <Aviso tipo="ok">Funções publicadas e funcionando. ✔</Aviso>}
      </Cartao>

      {status && (
        <>
          <Cartao titulo="Passo 2 — Criar o app no Mercado Livre (uma vez só, serve para as 2 contas)">
            <Passos>
              <li>Entre em <a href="https://developers.mercadolivre.com.br/devcenter" target="_blank" rel="noreferrer">developers.mercadolivre.com.br/devcenter</a> com a sua conta principal do Mercado Livre e clique em <b>Criar aplicação</b>.</li>
              <li>Preencha nome (ex.: “Café e Queijo Gestão”), nome curto e descrição. Em <b>URIs de redirect</b> cole:<Copiar texto={status.redirect_uri} /></li>
              <li>Em <b>Escopos</b>, marque <b>Leitura</b>, <b>Escrita</b> e <b>offline_access</b> (acesso offline, para o app renovar o acesso sozinho).</li>
              <li>Em <b>Tópicos</b>, marque <b>Orders</b> (orders_v2) e <b>Items</b>. Em <b>URL de retornos de chamada de notificação</b> cole:<Copiar texto={status.webhook_url} /></li>
              <li>Salve. O Mercado Livre mostra o <b>Client ID</b> (ou “App ID”) e o <b>Client Secret</b> (ou “Secret Key”). Copie os dois para o passo 3.</li>
            </Passos>
          </Cartao>

          <Cartao titulo="Passo 3 — Colar Client ID e Client Secret">
            {credOk && <Aviso tipo="ok">Credenciais salvas no servidor. ✔ (Para trocar, cole de novo.)</Aviso>}
            <div className="linha">
              <Campo rotulo="Client ID"><input value={cred.client_id} onChange={(e) => setCred({ ...cred, client_id: e.target.value })} placeholder="1234567890123456" /></Campo>
              <Campo rotulo="Client Secret"><input type="password" value={cred.client_secret} onChange={(e) => setCred({ ...cred, client_secret: e.target.value })} /></Campo>
            </div>
            <button className="botao primario" disabled={acao.ocupado || !cred.client_id || !cred.client_secret}
              onClick={() => acao.executar(async () => { await chamarConexoes({ acao: 'salvar_credenciais_ml', ...cred }); setCred({ client_id: '', client_secret: '' }); await recarregar() }, 'Credenciais salvas com segurança no servidor.')}>
              Salvar credenciais
            </button>
            <p className="dica">O segredo fica guardado só no servidor (Supabase) — nunca no navegador nem no GitHub.</p>
          </Cartao>

          <Cartao titulo="Passo 4 — Conectar cada conta">
            <Aviso tipo="info">Para conectar a <b>segunda</b> conta: antes, saia do Mercado Livre no navegador (ou use uma janela anônima) e entre com a outra conta. O app recusa ligar a mesma conta duas vezes.</Aviso>
            <div className="grade-2">
              {contasML.map((c) => {
                const cx = conexoes.find((x) => x.conta_id === c.id) || { status: 'desconectada' }
                return (
                  <div key={c.id} className="cartao-conta">
                    <h3><span className="bolinha" style={{ background: c.cor }} />{c.nome} <Selo tipo={STATUS[cx.status][0]}>{STATUS[cx.status][1]}</Selo></h3>
                    {cx.apelido && <p>Conta ML: <b>{cx.apelido}</b></p>}
                    {cx.ultimo_sync && <p className="dica">Última sincronização: {dataHoraBR(cx.ultimo_sync)}</p>}
                    {cx.ultimo_erro && <Aviso tipo="erro">{cx.ultimo_erro}</Aviso>}
                    <div className="acoes">
                      <button className="botao primario" disabled={!credOk || acao.ocupado} onClick={() => conectar(c)}>{cx.status === 'desconectada' ? 'Conectar' : 'Reconectar'}</button>
                      {cx.status !== 'desconectada' && (
                        <>
                          <button className="botao" disabled={acao.ocupado} onClick={() => acao.executar(async () => { const r = await chamarConexoes({ acao: 'sincronizar', conta_id: c.id }); await recarregar(); return r },
                            (r) => `${c.nome}: ${r.verificados} pedido(s) verificados.`)}>Sincronizar agora</button>
                          <button className="link" onClick={() => confirm(`Desconectar ${c.nome}?`) && acao.executar(async () => { await chamarConexoes({ acao: 'desconectar', conta_id: c.id }); await recarregar() })}>desconectar</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Cartao>

          <Cartao titulo="Passo 5 — Sincronização automática de segurança (a cada 15 min)">
            <p>As vendas chegam na hora pelas notificações. Esta sincronização é uma garantia caso alguma notificação se perca.</p>
            <button className="botao" onClick={() => acao.executar(async () => setSql((await chamarConexoes({ acao: 'preparar_sync' })).sql))}>Gerar comando</button>
            {sql && (
              <Passos>
                <li>Copie o comando abaixo.<Copiar texto={sql} /></li>
                <li>No Supabase, abra <b>SQL Editor</b> → <b>New query</b>, cole e clique em <b>Run</b>. Pronto.</li>
              </Passos>
            )}
            {status.sync_configurado && !sql && <p className="dica">Já foi gerado antes. Se ainda não colou no SQL Editor, gere de novo e cole.</p>}
          </Cartao>
        </>
      )}

      <Cartao titulo="Shopee e Amazon">
        <p>Funcionam por <b>planilha</b> (Importar vendas / Exportar planilhas). A estrutura do app já está pronta para, no futuro, ligar essas contas por um integrador (ex.: Bling) sem refazer nada.</p>
      </Cartao>

      <Cartao titulo="Histórico de sincronizações e erros" acoes={
        <select value={filtroLog} onChange={(e) => setFiltroLog(e.target.value)}>
          <option value="">Tudo</option><option value="erro">Só erros</option><option value="aviso">Só avisos</option>
        </select>}>
        {!logs.length ? <Vazio>Nada registrado ainda.</Vazio> : (
          <div className="tabela-rolagem" style={{ maxHeight: 400 }}>
            <table className="tabela compacta">
              <thead><tr><th>Quando</th><th>Conta</th><th>Tipo</th><th>Mensagem</th></tr></thead>
              <tbody>
                {logs.filter((l) => !filtroLog || l.status === filtroLog).map((l) => (
                  <tr key={l.id}>
                    <td>{dataHoraBR(l.criado_em)}</td>
                    <td>{contas.find((c) => c.id === l.conta_id)?.nome || '—'}</td>
                    <td><Selo tipo={l.status === 'erro' ? 'neg' : l.status === 'aviso' ? 'aviso' : 'ok'}>{l.tipo}</Selo></td>
                    <td>{l.mensagem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </Pagina>
  )
}
