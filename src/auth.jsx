import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [sessao, setSessao] = useState(undefined)
  const [perfil, setPerfil] = useState(null)
  const [erroPerfil, setErroPerfil] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) { setPerfil(null); return }
    supabase.from('perfis').select('*').eq('id', sessao.user.id).maybeSingle().then(({ data, error }) => {
      if (error) setErroPerfil(error)
      else if (!data) setErroPerfil({ message: 'Could not find the table perfis' })
      setPerfil(data)
    })
  }, [sessao])

  const valor = {
    sessao,
    perfil,
    erroPerfil,
    ehDono: perfil?.papel === 'dono',
    sair: () => supabase.auth.signOut(),
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
