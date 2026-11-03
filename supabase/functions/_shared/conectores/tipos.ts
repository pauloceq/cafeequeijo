// Contrato comum dos conectores. Cada marketplace (Mercado Livre, Shopee, Amazon)
// implementa esta interface; o resto do sistema (webhook, sync, telas) não precisa
// saber de detalhes de cada API.
import type { Conta } from "../db.ts";

export type Tokens = {
  access_token: string;
  refresh_token?: string | null;
  expira_em: string; // ISO
  extra?: Record<string, unknown>;
};

export type ResultadoOAuth = Tokens & { seller_id: string; apelido?: string | null };

export type ItemPedido = {
  item_id: string;            // id do anúncio
  variacao_id?: string | null;
  sku?: string | null;        // SKU informado no marketplace
  titulo?: string | null;
  quantidade: number;
  preco_unitario: number;
};

export type PedidoNormalizado = {
  codigo: string;             // nº do pedido no marketplace
  status: "pago" | "cancelado" | "pendente";
  status_externo: string;
  data: string;               // ISO
  comprador?: string | null;
  itens: ItemPedido[];
  taxa: number;               // tarifas do marketplace (R$)
  frete: number;              // frete pago pelo vendedor (R$)
  envio?: Record<string, unknown> | null;
};

export type AnuncioNormalizado = {
  codigo: string;             // item_id ou item_id:variacao_id
  item_id: string;
  variacao_id?: string | null;
  titulo: string;
  variacao_descricao?: string | null;
  sku?: string | null;
  preco?: number | null;
  quantidade?: number | null;
  status?: string | null;
  link?: string | null;
  imagem?: string | null;
};

export type Contexto = {
  conta: Conta;
  sellerId: string;
  token: () => Promise<string>;   // access token válido (renova se precisar)
  aviso: (msg: string, detalhes?: unknown) => Promise<void>;
};

export interface Conector {
  marketplace: Conta["marketplace"];
  nome: string;
  /** Faltando segredos? Retorna a lista (vazia = pronto para usar). */
  segredosFaltando(): string[];
  urlAutorizacao(state: string, redirectUri: string): Promise<string>;
  trocarCodigo(params: URLSearchParams, redirectUri: string): Promise<ResultadoOAuth>;
  renovarToken(refreshToken: string, sellerId: string): Promise<Tokens>;
  buscarPedidosAlterados(ctx: Contexto, desde: Date): Promise<PedidoNormalizado[]>;
  buscarPedido(ctx: Contexto, codigo: string): Promise<PedidoNormalizado | null>;
  listarAnuncios(ctx: Contexto): Promise<AnuncioNormalizado[]>;
  atualizarAnuncio(
    ctx: Contexto,
    a: { item_id: string; variacao_id?: string | null; quantidade?: number | null; preco?: number | null },
  ): Promise<void>;
}

export function expiraEm(segundos: number): string {
  return new Date(Date.now() + (segundos || 3600) * 1000).toISOString();
}
