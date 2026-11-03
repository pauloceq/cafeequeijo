// Converte erros técnicos em mensagens em português com o que fazer.
export function mensagemErro(e) {
  const msg = String(e?.message || e?.error_description || e?.erro || e || 'Erro desconhecido')
  const regras = [
    [/Failed to fetch|NetworkError|Load failed/i, 'Sem conexão com o servidor. Verifique sua internet. Se continuar, confira a URL do Supabase em Ajuda → Configuração.'],
    [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/Email not confirmed/i, 'Este e-mail ainda não foi confirmado. No Supabase, vá em Authentication → Users e confirme o usuário (ou desative "Confirm email").'],
    [/JWT expired|invalid JWT|refresh_token/i, 'Sua sessão expirou. Saia e entre novamente.'],
    [/Invalid API key|No API key/i, 'A chave do Supabase está errada. Confira em Ajuda → Configuração (use a chave "anon" ou "publishable", nunca a "service_role").'],
    [/relation .* does not exist|Could not find the (table|function)|schema cache/i, 'O banco de dados ainda não foi preparado (ou está desatualizado). No Supabase, abra o SQL Editor, cole o arquivo supabase/schema.sql inteiro e clique em Run.'],
    [/duplicate key.*sku/i, 'Já existe um produto com esse SKU.'],
    [/duplicate key/i, 'Esse registro já existe (código repetido).'],
    [/violates foreign key/i, 'Não é possível apagar: este item já foi usado em vendas, compras ou anúncios. Desative-o em vez de apagar.'],
    [/row-level security|permission denied|42501/i, 'Você não tem permissão para isso. Apenas o dono pode fazer esta ação.'],
    [/Function not found|404.*functions|FunctionsFetchError|Failed to send a request to the Edge Function/i, 'As funções do servidor (Edge Functions) ainda não foram publicadas. Veja Ajuda → Conexão com o Mercado Livre, passo "Publicar funções".'],
    [/FunctionsHttpError/i, 'O servidor recusou a ação. Veja o histórico na tela Conexões.'],
    [/invalid input syntax for type (numeric|integer)/i, 'Algum número está em formato inválido. Use apenas números (ex.: 12,50).'],
  ]
  for (const [re, texto] of regras) if (re.test(msg)) return texto
  return msg
}

/** Lança erro do supabase-js em português. */
export function ok({ data, error }) {
  if (error) throw new Error(mensagemErro(error))
  return data
}
