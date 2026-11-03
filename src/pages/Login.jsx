import { useState } from 'react'
import { supabase, apagarConfig, lerConfig } from '../supabase'
import { Aviso, Campo, Cartao } from '../components/ui'
import { mensagemErro } from '../lib/erros'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [entrando, setEntrando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErro(null); setEntrando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEntrando(false)
    if (error) setErro(mensagemErro(error))
  }

  const cfg = lerConfig()
  return (
    <div className="tela-centro">
      <Cartao titulo="☕ Café & Queijo — Entrar">
        <form onSubmit={entrar} className="form">
          <Campo rotulo="E-mail"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
          <Campo rotulo="Senha"><input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Campo>
          <Aviso tipo="erro">{erro}</Aviso>
          <button className="botao primario" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="dica">
          Os usuários são criados pelo dono no Supabase (Authentication → Users → Add user).
          O primeiro usuário criado vira o <b>dono</b>; os demais entram como <b>ajudante</b>.
          Esqueceu a senha? O dono pode trocar em Authentication → Users → “…” → Reset password.
        </p>
        {cfg?.origem === 'navegador' && (
          <button className="link" onClick={() => { apagarConfig(); window.location.reload() }}>
            Trocar o projeto Supabase deste navegador
          </button>
        )}
      </Cartao>
    </div>
  )
}
