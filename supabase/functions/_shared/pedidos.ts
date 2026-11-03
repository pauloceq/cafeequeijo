// Transforma um pedido do marketplace em venda do app (baixa o estoque real).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Conta, erroTexto, log } from "./db.ts";
import type { AnuncioNormalizado, PedidoNormalizado } from "./conectores/tipos.ts";

type Vinculo = { produto_id: number; unidades_por_venda: number };

async function resolverItem(
  db: SupabaseClient, contaId: number, it: { item_id: string; variacao_id?: string | null; sku?: string | null },
): Promise<Vinculo | null> {
  const codigos = it.variacao_id ? [`${it.item_id}:${it.variacao_id}`, it.item_id] : [it.item_id];
  for (const codigo of codigos) {
    const { data } = await db.from("anuncios").select("produto_id,unidades_por_venda")
      .eq("conta_id", contaId).eq("codigo", codigo).not("produto_id", "is", null).maybeSingle();
    if (data) return { produto_id: data.produto_id, unidades_por_venda: Number(data.unidades_por_venda) || 1 };
  }
  if (it.sku) {
    const { data } = await db.from("produtos").select("id").ilike("sku", it.sku.trim()).maybeSingle();
    if (data) return { produto_id: data.id, unidades_por_venda: 1 };
  }
  return null;
}

export async function processarPedido(db: SupabaseClient, conta: Conta, p: PedidoNormalizado, origemLog = "sync") {
  const { data: existente } = await db.from("pedidos_externos").select("id,venda_id,situacao")
    .eq("conta_id", conta.id).eq("codigo", p.codigo).maybeSingle();
  const salvar = (campos: Record<string, unknown>) =>
    db.from("pedidos_externos").upsert({
      conta_id: conta.id, codigo: p.codigo, status_externo: p.status_externo, dados: p,
      atualizado_em: new Date().toISOString(), ...campos,
    }, { onConflict: "conta_id,codigo" });

  try {
    let vendaId: number | null = existente?.venda_id ?? null;
    if (!vendaId) {
      const { data: v } = await db.from("vendas").select("id").eq("conta_id", conta.id).eq("codigo_externo", p.codigo).maybeSingle();
      vendaId = v?.id ?? null;
    }

    // Cancelado: estorna a venda se ela já tinha baixado o estoque
    if (p.status === "cancelado") {
      if (vendaId) {
        const { data: v } = await db.from("vendas").select("status").eq("id", vendaId).single();
        if (v?.status === "concluida") {
          const { error } = await db.rpc("cancelar_venda", { p_venda_id: vendaId });
          if (error) throw new Error(error.message);
          await log(db, conta.id, origemLog, "ok", `Pedido ${p.codigo} cancelado no marketplace: estoque devolvido`);
        }
      }
      await salvar({ situacao: "cancelado", venda_id: vendaId, mensagem: null });
      return "cancelado";
    }

    if (p.status === "pendente") {
      await salvar({ situacao: "ignorado", mensagem: "Aguardando pagamento", venda_id: vendaId });
      return "pendente";
    }

    // Pago e já importado: atualiza taxas, frete e envio (podem chegar depois)
    if (vendaId) {
      await db.from("vendas").update({ taxa_marketplace: p.taxa, frete: p.frete, envio: p.envio ?? null }).eq("id", vendaId);
      await salvar({ situacao: "importado", venda_id: vendaId, mensagem: null });
      return "atualizado";
    }

    // Pago e novo: precisa que todos os anúncios estejam vinculados a um SKU
    const itens = [];
    const faltando: string[] = [];
    for (const it of p.itens) {
      const vinc = await resolverItem(db, conta.id, it);
      if (!vinc) { faltando.push(`${it.titulo ?? ""} (${it.item_id}${it.variacao_id ? ":" + it.variacao_id : ""})`); continue; }
      itens.push({
        produto_id: vinc.produto_id,
        quantidade: it.quantidade * vinc.unidades_por_venda,
        preco_unitario: Math.round((it.preco_unitario / vinc.unidades_por_venda) * 100) / 100,
      });
    }
    if (faltando.length) {
      const msg = `Anúncio sem SKU vinculado: ${faltando.join(", ")}. Vincule na tela Anúncios e clique em "Reprocessar pendentes".`;
      await salvar({ situacao: "pendente_vinculo", mensagem: msg });
      await log(db, conta.id, origemLog, "aviso", `Pedido ${p.codigo}: ${msg}`);
      return "pendente_vinculo";
    }

    const { data: novoId, error } = await db.rpc("registrar_venda", {
      p_venda: {
        conta_id: conta.id, data: p.data, codigo_externo: p.codigo, comprador: p.comprador,
        taxa_marketplace: p.taxa, frete: p.frete, origem: "api", itens,
      },
    });
    if (error) throw new Error(error.message);
    if (novoId) await db.from("vendas").update({ envio: p.envio ?? null }).eq("id", novoId);
    await salvar({ situacao: "importado", venda_id: novoId, mensagem: null });
    await log(db, conta.id, origemLog, "ok", `Venda ${p.codigo} importada e estoque baixado`);
    return "importado";
  } catch (e) {
    await salvar({ situacao: "erro", mensagem: erroTexto(e) });
    await log(db, conta.id, origemLog, "erro", `Pedido ${p.codigo}: ${erroTexto(e)}`);
    return "erro";
  }
}

/** Grava/atualiza a lista de anúncios; vincula sozinho quando o SKU do anúncio = SKU do app. */
export async function salvarAnuncios(db: SupabaseClient, conta: Conta, lista: AnuncioNormalizado[]) {
  const { data: produtos } = await db.from("produtos").select("id,sku");
  const porSku = new Map((produtos ?? []).map((p) => [String(p.sku).trim().toLowerCase(), p.id]));
  const { data: atuais } = await db.from("anuncios").select("codigo,produto_id").eq("conta_id", conta.id);
  const vinculados = new Map((atuais ?? []).map((a) => [a.codigo, a.produto_id]));
  const agora = new Date().toISOString();
  let auto = 0;
  const linhas = lista.map((a) => {
    let produto_id = vinculados.get(a.codigo) ?? null;
    if (!produto_id && a.sku) {
      produto_id = porSku.get(a.sku.trim().toLowerCase()) ?? null;
      if (produto_id) auto++;
    }
    return {
      conta_id: conta.id, codigo: a.codigo, item_id: a.item_id, variacao_id: a.variacao_id ?? null,
      titulo: a.titulo, variacao_descricao: a.variacao_descricao ?? null, sku_marketplace: a.sku ?? null,
      produto_id, preco: a.preco ?? null, quantidade_anuncio: a.quantidade ?? null,
      status_anuncio: a.status ?? null, link: a.link ?? null, imagem: a.imagem ?? null, sincronizado_em: agora,
    };
  });
  for (let i = 0; i < linhas.length; i += 200) {
    const { error } = await db.from("anuncios").upsert(linhas.slice(i, i + 200), { onConflict: "conta_id,codigo" });
    if (error) throw new Error(error.message);
  }
  return { total: linhas.length, vinculados_automaticamente: auto };
}

/** Tenta de novo os pedidos que estavam esperando vínculo de anúncio ou deram erro. */
export async function reprocessarPendentes(db: SupabaseClient, conta: Conta) {
  const { data } = await db.from("pedidos_externos").select("dados")
    .eq("conta_id", conta.id).in("situacao", ["pendente_vinculo", "erro"]).limit(500);
  const r: Record<string, number> = {};
  for (const p of data ?? []) {
    if (!p.dados) continue;
    const s = await processarPedido(db, conta, p.dados as PedidoNormalizado, "reprocessar");
    r[s] = (r[s] ?? 0) + 1;
  }
  return r;
}

/** Busca pedidos alterados desde o último sync (com margem) e processa todos. */
export async function sincronizarConta(db: SupabaseClient, conta: Conta, ctx: import("./conectores/tipos.ts").Contexto,
  conector: import("./conectores/tipos.ts").Conector) {
  const inicio = new Date();
  const { data: c } = await db.from("conexoes").select("ultimo_sync").eq("conta_id", conta.id).single();
  const desde = c?.ultimo_sync
    ? new Date(new Date(c.ultimo_sync).getTime() - 30 * 60 * 1000)   // margem de 30 min
    : new Date(Date.now() - 3 * 24 * 3600 * 1000);                   // primeira vez: últimos 3 dias
  const pedidos = await conector.buscarPedidosAlterados(ctx, desde);
  const resumo: Record<string, number> = {};
  for (const p of pedidos) {
    const s = await processarPedido(db, conta, p, "sync_pedidos");
    resumo[s] = (resumo[s] ?? 0) + 1;
  }
  const pend = await reprocessarPendentes(db, conta);
  await db.from("conexoes").update({ ultimo_sync: inicio.toISOString(), ultimo_erro: null }).eq("conta_id", conta.id);
  await log(db, conta.id, "sync_pedidos", "ok",
    `Sincronização: ${pedidos.length} pedido(s) verificados desde ${desde.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    { resumo, reprocessados: pend });
  return { verificados: pedidos.length, resumo, reprocessados: pend };
}
