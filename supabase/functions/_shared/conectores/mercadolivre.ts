// Conector Mercado Livre (Brasil) — https://developers.mercadolivre.com.br
// Credenciais: ML_CLIENT_ID e ML_CLIENT_SECRET — coladas pelo dono na tela Conexões do app
// (ficam na tabela config_segura, que só o servidor lê) ou, se preferir, em Edge Function Secrets.
// Um único app do ML serve para as duas contas: cada conta autoriza o app separadamente.
import { fetchJson, segredo } from "../db.ts";
import {
  AnuncioNormalizado, Conector, Contexto, expiraEm, ItemPedido, PedidoNormalizado, Tokens,
} from "./tipos.ts";

const API = "https://api.mercadolibre.com";
const AUTH = "https://auth.mercadolivre.com.br/authorization";

const env = segredo;

async function ml(token: string, caminho: string, init: RequestInit = {}) {
  return fetchJson(`${API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  }, "Mercado Livre");
}

async function oauthToken(params: Record<string, string>) {
  return fetchJson(`${API}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("ML_CLIENT_ID"), client_secret: env("ML_CLIENT_SECRET"), ...params }),
  }, "ML OAuth");
}

// ML espera datas no formato 2026-11-01T00:00:00.000-00:00
const dataML = (d: Date) => d.toISOString().replace("Z", "-00:00");

function statusPedido(s: string): PedidoNormalizado["status"] {
  if (s === "paid" || s === "partially_refunded") return "pago";
  if (s === "cancelled" || s === "invalid") return "cancelado";
  return "pendente";
}

async function normalizarPedido(ctx: Contexto, token: string, o: any): Promise<PedidoNormalizado> {
  const itens: ItemPedido[] = (o.order_items ?? []).map((it: any) => ({
    item_id: String(it.item?.id),
    variacao_id: it.item?.variation_id ? String(it.item.variation_id) : null,
    sku: it.item?.seller_sku ?? it.item?.seller_custom_field ?? null,
    titulo: it.item?.title ?? null,
    quantidade: Number(it.quantity ?? 0),
    preco_unitario: Number(it.unit_price ?? 0),
  }));
  // sale_fee vem por unidade em cada item
  const taxa = (o.order_items ?? []).reduce(
    (s: number, it: any) => s + Number(it.sale_fee ?? 0) * Number(it.quantity ?? 0), 0);

  let frete = 0;
  let envio: Record<string, unknown> | null = null;
  const envioId = o.shipping?.id;
  if (envioId) {
    try {
      const sh = await ml(token, `/shipments/${envioId}`, { headers: { "x-format-new": "true" } });
      envio = {
        id: envioId,
        status: sh.status,
        substatus: sh.substatus,
        tipo_logistico: sh.logistic?.type ?? sh.logistic_type,
        modo: sh.logistic?.mode ?? sh.mode,
        rastreio: sh.tracking_number,
        metodo_rastreio: sh.tracking_method,
        previsao_entrega: sh.lead_time?.estimated_delivery_time?.date ?? null,
      };
    } catch (e) {
      await ctx.aviso(`Pedido ${o.id}: não foi possível ler o envio ${envioId}`, { erro: String(e) });
    }
    try {
      const custos = await ml(token, `/shipments/${envioId}/costs`);
      frete = (custos?.senders ?? []).reduce((s: number, x: any) => s + Number(x.cost ?? 0), 0);
    } catch (e) {
      await ctx.aviso(`Pedido ${o.id}: não foi possível ler o custo do frete`, { erro: String(e) });
    }
  }

  return {
    codigo: String(o.id),
    status: statusPedido(o.status),
    status_externo: o.status,
    data: o.date_closed ?? o.date_created,
    comprador: o.buyer?.nickname ?? null,
    itens,
    taxa: Math.round(taxa * 100) / 100,
    frete: Math.round(frete * 100) / 100,
    envio: envio ? { ...envio, pack_id: o.pack_id ?? null } : (o.pack_id ? { pack_id: o.pack_id } : null),
  };
}

function skuDe(obj: any): string | null {
  const attr = (obj?.attributes ?? []).find((a: any) => a.id === "SELLER_SKU");
  return attr?.value_name ?? obj?.seller_custom_field ?? null;
}

function anunciosDoItem(it: any): AnuncioNormalizado[] {
  const base = {
    item_id: it.id, titulo: it.title, status: it.status, link: it.permalink,
    imagem: it.thumbnail?.replace("http://", "https://") ?? null,
  };
  if (!it.variations?.length) {
    return [{ ...base, codigo: it.id, variacao_id: null, sku: skuDe(it), preco: Number(it.price), quantidade: Number(it.available_quantity ?? 0) }];
  }
  return it.variations.map((v: any) => ({
    ...base,
    codigo: `${it.id}:${v.id}`,
    variacao_id: String(v.id),
    variacao_descricao: (v.attribute_combinations ?? []).map((a: any) => `${a.name}: ${a.value_name}`).join(" · "),
    sku: skuDe(v) ?? skuDe(it),
    preco: Number(v.price ?? it.price),
    quantidade: Number(v.available_quantity ?? 0),
  }));
}

export const mercadoLivre: Conector & {
  listarAnunciosDoItem: (ctx: Contexto, itemId: string) => Promise<AnuncioNormalizado[]>;
} = {
  marketplace: "mercadolivre",
  nome: "Mercado Livre",

  segredosFaltando: () => ["ML_CLIENT_ID", "ML_CLIENT_SECRET"].filter((n) => !segredo(n)),

  async urlAutorizacao(state, redirectUri) {
    const p = new URLSearchParams({ response_type: "code", client_id: env("ML_CLIENT_ID"), redirect_uri: redirectUri, state });
    return `${AUTH}?${p}`;
  },

  async trocarCodigo(params, redirectUri) {
    const code = params.get("code");
    if (!code) throw new Error(params.get("error_description") ?? params.get("error") ?? "Autorização sem código");
    const t = await oauthToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!t.refresh_token) {
      throw new Error("O ML não enviou refresh_token. Ative o escopo 'offline_access' no seu app do Mercado Livre.");
    }
    let apelido: string | null = null;
    try { apelido = (await ml(t.access_token, "/users/me")).nickname; } catch (_) { /* opcional */ }
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expira_em: expiraEm(t.expires_in),
      seller_id: String(t.user_id),
      apelido,
    };
  },

  async renovarToken(refreshToken): Promise<Tokens> {
    const t = await oauthToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    return { access_token: t.access_token, refresh_token: t.refresh_token, expira_em: expiraEm(t.expires_in) };
  },

  async buscarPedidosAlterados(ctx, desde) {
    const token = await ctx.token();
    const pedidos: PedidoNormalizado[] = [];
    const limite = 50;
    for (let offset = 0; offset < 2000; offset += limite) {
      const q = new URLSearchParams({
        seller: ctx.sellerId,
        "order.date_last_updated.from": dataML(desde),
        "order.date_last_updated.to": dataML(new Date()),
        sort: "date_asc",
        limit: String(limite),
        offset: String(offset),
      });
      const r = await ml(token, `/orders/search?${q}`);
      for (const o of r.results ?? []) pedidos.push(await normalizarPedido(ctx, token, o));
      if (!r.results?.length || offset + limite >= (r.paging?.total ?? 0)) break;
    }
    return pedidos;
  },

  async buscarPedido(ctx, codigo) {
    const token = await ctx.token();
    const o = await ml(token, `/orders/${codigo}`);
    return o ? normalizarPedido(ctx, token, o) : null;
  },

  async listarAnuncios(ctx) {
    const token = await ctx.token();
    // 1) ids de todos os anúncios (modo "scan" não tem o limite de 1000 do offset)
    const ids: string[] = [];
    let scroll: string | undefined;
    for (let i = 0; i < 200; i++) {
      const q = new URLSearchParams({ search_type: "scan", limit: "100" });
      if (scroll) q.set("scroll_id", scroll);
      const r = await ml(token, `/users/${ctx.sellerId}/items/search?${q}`);
      if (!r.results?.length) break;
      ids.push(...r.results);
      scroll = r.scroll_id;
      if (!scroll) break;
    }

    // 2) detalhes em lotes de 20 (multiget)
    const anuncios: AnuncioNormalizado[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20).join(",");
      const r = await ml(token, `/items?ids=${lote}&include_attributes=all`);
      for (const { code, body: it } of r) {
        if (code === 200 && it) anuncios.push(...anunciosDoItem(it));
      }
    }
    return anuncios;
  },

  async listarAnunciosDoItem(ctx, itemId) {
    const it = await ml(await ctx.token(), `/items/${itemId}?include_attributes=all`);
    return it ? anunciosDoItem(it) : [];
  },

  async atualizarAnuncio(ctx, a) {
    const token = await ctx.token();
    const temQtd = a.quantidade !== null && a.quantidade !== undefined;
    const temPreco = a.preco !== null && a.preco !== undefined;
    if (!temQtd && !temPreco) return;

    if (a.variacao_id) {
      // Com variações é preciso enviar TODAS (as omitidas seriam apagadas).
      // No ML todas as variações de um anúncio têm o mesmo preço.
      const it = await ml(token, `/items/${a.item_id}?attributes=variations`);
      const variations = (it.variations ?? []).map((v: any) => {
        const out: Record<string, unknown> = { id: v.id };
        if (String(v.id) === String(a.variacao_id) && temQtd) out.available_quantity = Math.max(0, Math.floor(a.quantidade!));
        if (temPreco) out.price = a.preco;
        return out;
      });
      await ml(token, `/items/${a.item_id}`, { method: "PUT", body: JSON.stringify({ variations }) });
    } else {
      const body: Record<string, unknown> = {};
      if (temQtd) body.available_quantity = Math.max(0, Math.floor(a.quantidade!));
      if (temPreco) body.price = a.preco;
      await ml(token, `/items/${a.item_id}`, { method: "PUT", body: JSON.stringify(body) });
    }
  },
};
