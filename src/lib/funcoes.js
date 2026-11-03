import { supabase } from '../supabase'

/** Chama a Edge Function "conexoes" e devolve o JSON (erros já em português). */
export async function chamarConexoes(corpo) {
  const { data, error } = await supabase.functions.invoke('conexoes', { body: corpo })
  if (error) {
    // tenta ler a mensagem que a função devolveu
    let msg = null
    try { msg = (await error.context?.json?.())?.erro } catch { /* ignora */ }
    if (msg) throw new Error(msg)
    if (/Failed to send|FunctionsFetchError|not found|404/i.test(error.message || '')) {
      throw new Error('As funções do servidor ainda não foram publicadas no Supabase. Veja Ajuda → Conexão com o Mercado Livre → passo “Publicar as funções”.')
    }
    throw error
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}
