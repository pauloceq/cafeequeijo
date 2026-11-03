// Sincronização de segurança: chamada pelo pg_cron a cada 15 minutos (veja supabase/cron.sql).
// Busca pedidos novos/alterados de todas as contas conectadas, caso alguma notificação tenha se perdido.
import { admin, carregarSegredos, erroTexto, json, log, segredo } from "../_shared/db.ts";
import { conectores, contexto } from "../_shared/conectores/index.ts";
import { sincronizarConta } from "../_shared/pedidos.ts";

Deno.serve(async (req) => {
  const db = admin();
  await carregarSegredos(db);
  const esperado = segredo("CRON_SECRET"); // gerado pela tela Conexões (ou Edge Function Secret)
  if (!esperado || req.headers.get("x-cron-secret") !== esperado) {
    return json({ erro: "não autorizado" }, 401);
  }
  const { data } = await db.from("conexoes").select("conta_id, status, contas!inner(id,nome,marketplace,ativa)")
    .in("status", ["conectada", "erro"]);
  const resultado: Record<string, unknown> = {};
  for (const c of data ?? []) {
    const conta = (c as any).contas;
    const conector = conectores[conta.marketplace as keyof typeof conectores];
    if (!conta.ativa || !conector) continue;
    try {
      const ctx = await contexto(db, conta, "sync_pedidos");
      resultado[conta.nome] = await sincronizarConta(db, conta, ctx, conector);
      await db.from("conexoes").update({ status: "conectada" }).eq("conta_id", conta.id);
    } catch (e) {
      resultado[conta.nome] = { erro: erroTexto(e) };
      await db.from("conexoes").update({ ultimo_erro: erroTexto(e) }).eq("conta_id", conta.id);
      await log(db, conta.id, "sync_pedidos", "erro", erroTexto(e));
    }
  }
  return json(resultado);
});
