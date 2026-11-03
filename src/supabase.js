import { createClient } from '@supabase/supabase-js'

// As chaves vêm (1) do build (Variables do GitHub) ou (2) da tela "Configurar" do app,
// que guarda no navegador. A chave "anon/publishable" é pública por natureza:
// quem protege os dados é o login + as regras (RLS) do banco.
const CHAVE = 'cafeequeijo-config'

export function lerConfig() {
  const env = { url: import.meta.env.VITE_SUPABASE_URL, chave: import.meta.env.VITE_SUPABASE_ANON_KEY }
  if (env.url && env.chave) return { ...env, origem: 'build' }
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null')
    if (salvo?.url && salvo?.chave) return { ...salvo, origem: 'navegador' }
  } catch { /* ignora */ }
  return null
}

export function salvarConfig(url, chave) {
  localStorage.setItem(CHAVE, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), chave: chave.trim() }))
}

export function apagarConfig() {
  localStorage.removeItem(CHAVE)
}

const cfg = lerConfig()
export const supabase = cfg ? createClient(cfg.url, cfg.chave) : null
export const configurado = !!cfg
