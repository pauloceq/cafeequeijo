import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { salvarConfig } from '../supabase'
import { Aviso, Campo, Cartao, Passos } from '../components/ui'
import { mensagemErro } from '../lib/erros'

// Primeira tela: aparece só quando o app ainda não sabe qual Supabase usar.
export default function Configurar() {
  const [url, setUrl] = useState('')
  const [chave, setChave] = useState('')
  const [erro, setErro] = useState(null)
  const [testando, setTestando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    const u = url.trim().replace(/\/+$/, '')
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u)) {
      setErro('A URL deve ser parecida com https://abcdefghijk.supabase.co (copie em Project Settings → API / Data API).')
      return
    }
    if (chave.trim().length < 30) { setErro('A chave parece incompleta. Copie a chave "anon public" (ou "publishable") inteira.'); return }
    if (chave.includes('service_role') || chave.trim().startsWith('sb_secret_')) {
      setErro('Essa é a chave SECRETA (service_role/secret). Nunca use ela no app! Copie a chave "anon public" ou "publishable".')
      return
    }
    setTestando(true)
    try {
      const sb = createClient(u, chave.trim())
      const { error } = await sb.from('contas').select('id').limit(1)
      if (error && !/permission|row-level|JWT/i.test(error.message)) throw error
      salvarConfig(u, chave)
      window.location.reload()
    } catch (e2) {
      setErro(mensagemErro(e2))
    } finally {
      setTestando(false)
    }
  }

  return (
    <div className="tela-centro">
      <Cartao titulo="☕ Bem-vindo! Vamos ligar o app ao seu banco de dados">
        <p>Você só precisa fazer isso uma vez neste navegador. O passo a passo completo está no arquivo
          <b> README</b> do projeto no GitHub (seção “Criar o Supabase”).</p>
        <Passos>
          <li>Entre em <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com/dashboard</a> e abra seu projeto.</li>
          <li>Clique em <b>Project Settings</b> (engrenagem) → <b>API</b> (ou <b>Data API</b>).</li>
          <li>Copie a <b>Project URL</b> e a chave <b>anon public</b> (ou <b>publishable</b>) e cole abaixo.</li>
        </Passos>
        <form onSubmit={salvar} className="form">
          <Campo rotulo="Project URL"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></Campo>
          <Campo rotulo="Chave anon / publishable"><textarea rows={3} value={chave} onChange={(e) => setChave(e.target.value)} /></Campo>
          <Aviso tipo="erro">{erro}</Aviso>
          <button className="botao primario" disabled={testando}>{testando ? 'Testando conexão…' : 'Salvar e continuar'}</button>
        </form>
        <p className="dica">Dica: para não precisar colar em cada computador, cadastre essas chaves nas “Variables” do GitHub (README, passo 4).</p>
      </Cartao>
    </div>
  )
}
