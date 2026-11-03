// Notificações do Mercado Livre (configure esta URL no app do ML, tópicos "orders_v2" e "items").
// O ML exige resposta rápida: respondemos 200 na hora e processamos em segundo plano.
// Segurança: não confiamos no conteúdo da notificação — sempre buscamos o pedido na API do ML
// usando o token da conta, e só aceitamos user_id de contas conectadas.
import { admin, carregarSegredos, erroTexto, log } from "../_shared/db.ts";
import { contexto } from "../_shared/conectores/index.ts";
import { mercadoLivre } from "../_shared/conectores/mercadolivre.ts";
import { processarPedido, salvarAnuncios } from "../_shared/pedidos.ts";

async function processar(n: any) {
  const db = admin();
  const { data: c } = await db.from("conexoes").select("conta_id, contas!inner(id,nome,marketplace)")
    .eq("seller_id", String(n.user_id)).eq("contas.marketplace", "mercadolivre").maybeSingle();
  if (!c) return; // conta desconhecida: ignora
  const conta = (c as any).contas;
  try {
    await carregarSegredos(db);
    const ctx = await contexto(db, conta, "webhook");
    const id = String(n.resource ?? "").split("/").filter(Boolean).pop();
    if (!id) return;
    if (n.topic === "orders_v2" || n.topic === "orders") {
      const pedido = await mercadoLivre.buscarPedido(ctx, id);
      if (pedido) await processarPedido(db, conta, pedido, "webhook");
    } else if (n.topic === "items") {
      // atualiza preço/quantidade/status do anúncio na lista local
      const todos = await mercadoLivre.listarAnunciosDoItem!(ctx, id);
      if (todos.length) await salvarAnuncios(db, conta, todos);
    }
  } catch (e) {
    await log(db, conta.id, "webhook", "erro", `Notificação ${n.topic} ${n.resource}: ${erroTexto(e)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const n = await req.json().catch(() => null);
  if (n?.user_id && n?.resource) {
    // @ts-ignore EdgeRuntime existe no Supabase
    EdgeRuntime.waitUntil(processar(n));
  }
  return new Response("ok", { status: 200 });
});
