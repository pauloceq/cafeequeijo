// =====================================================================
// FUTURO: Shopee e Amazon via integrador (ex.: Bling — https://developer.bling.com.br)
// =====================================================================
// Hoje Shopee e Amazon entram no app por PLANILHA (telas Importar vendas e
// Exportar planilhas). Se um dia você contratar o Bling e ligar suas contas
// Shopee/Amazon nele, basta implementar este conector usando a API v3 do Bling
// (OAuth 2: https://www.bling.com.br/Api/v3/oauth/authorize) e registrá-lo em
// conectores/index.ts para as contas "shopee" e "amazon":
//
//   - buscarPedidosAlterados: GET /Api/v3/pedidos/vendas?dataAlteracaoInicial=...
//       (cada pedido traz a "loja" de origem -> mapear para a conta do app)
//   - listarAnuncios:          GET /Api/v3/produtos/lojas?idLoja=...
//   - atualizarAnuncio:        estoque/preço por loja via /Api/v3/estoques e /produtos/lojas
//
// Todo o resto (webhook, sincronização a cada 15 min, vínculo anúncio -> SKU,
// baixa automática do estoque real, histórico de erros) já funciona igual ao
// Mercado Livre, porque tudo usa a interface "Conector" de tipos.ts.
// =====================================================================
import type { Conector } from "./tipos.ts";

const naoAtivado = () => {
  throw new Error("Integração via Bling ainda não ativada. Use a importação por planilha.");
};

export const integradorBling: Conector = {
  marketplace: "shopee", // será usado para "shopee" e "amazon"
  nome: "Integrador (Bling) — não ativado",
  segredosFaltando: () => ["BLING_CLIENT_ID", "BLING_CLIENT_SECRET"],
  urlAutorizacao: async () => naoAtivado(),
  trocarCodigo: async () => naoAtivado(),
  renovarToken: async () => naoAtivado(),
  buscarPedidosAlterados: async () => naoAtivado(),
  buscarPedido: async () => naoAtivado(),
  listarAnuncios: async () => naoAtivado(),
  atualizarAnuncio: async () => naoAtivado(),
};
