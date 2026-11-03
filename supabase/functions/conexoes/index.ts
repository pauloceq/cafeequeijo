// Ações da tela "Conexões" (só o dono). Chamada pelo app com o login do usuário.
import {
  admin, atualizarConexao, carregarSegredos, cors, erroTexto, getConta, json, log, REDIRECT_URI, segredo, SUPABASE_URL,
} from "../_shared/db.ts";
import { conectorDa, conectores, contexto } from "../_shared/conectores/index.ts";
import { reprocessarPendentes, salvarAnuncios, sincronizarConta } from "../_shared/pedidos.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    // quem está chamando?
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ erro: "Sessão expirada. Saia e entre de novo no app." }, 401);
    const { data: perfil } = await db.from("perfis").select("papel").eq("id", u.user.id).single();
    if (perfil?.papel !== "dono") return json({ erro: "Apenas o dono pode mexer nas conexões." }, 403);

    await carregarSegredos(db);
    const body = await req.json().catch(() => ({}));
    const acao = body.acao as string;

    if (acao === "status") {
      return json({
        redirect_uri: REDIRECT_URI,
        webhook_url: `${SUPABASE_URL}/functions/v1/ml-webhook`,
        faltando: Object.fromEntries(Object.entries(conectores).map(([k, c]) => [k, c!.segredosFaltando()])),
        sync_configurado: !!segredo("CRON_SECRET"),
      });
    }

    if (acao === "salvar_credenciais_ml") {
      const id = String(body.client_id ?? "").trim();
      const secret = String(body.client_secret ?? "").trim();
      if (!/^\d{6,}$/.test(id)) return json({ erro: "O Client ID do Mercado Livre é um número comprido (ex.: 1234567890123456). Confira e cole de novo." }, 400);
      if (secret.length < 20) return json({ erro: "O Client Secret parece incompleto. Copie o valor inteiro no painel do Mercado Livre." }, 400);
      const agora = new Date().toISOString();
      const { error } = await db.from("config_segura").upsert([
        { chave: "ML_CLIENT_ID", valor: id, atualizado_em: agora },
        { chave: "ML_CLIENT_SECRET", valor: secret, atualizado_em: agora },
      ]);
      if (error) throw new Error(error.message);
      await log(db, null, "configuracao", "ok", "Credenciais do Mercado Livre salvas");
      return json({ ok: true });
    }

    if (acao === "preparar_sync") {
      // gera (uma vez) o segredo da sincronização automática e devolve o SQL pronto para colar
      let cron = segredo("CRON_SECRET");
      if (!cron) {
        cron = crypto.randomUUID().replaceAll("-", "");
        await db.from("config_segura").upsert({ chave: "CRON_SECRET", valor: cron, atualizado_em: new Date().toISOString() });
      }
      const url = `${SUPABASE_URL}/functions/v1/sync-agendado`;
      const sql = `create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('sync-marketplaces') where exists (select 1 from cron.job where jobname = 'sync-marketplaces');
select cron.schedule('sync-marketplaces', '*/15 * * * *', $$
  select net.http_post(
    url := '${url}',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "${cron}"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);
select cron.unschedule('limpeza-logs') where exists (select 1 from cron.job where jobname = 'limpeza-logs');
select cron.schedule('limpeza-logs', '0 3 * * *', $$
  delete from public.sync_logs where criado_em < now() - interval '90 days';
  delete from public.oauth_states where criado_em < now() - interval '1 day';
$$);`;
      return json({ sql });
    }

    const conta = await getConta(db, Number(body.conta_id));

    if (acao === "iniciar_oauth") {
      const conector = conectorDa(conta);
      const falta = conector.segredosFaltando();
      if (falta.length) return json({ erro: `Configure primeiro as credenciais do ${conector.nome} (passo 1 da tela Conexões).` }, 400);
      const state = crypto.randomUUID();
      const retorno = String(body.retorno ?? "");
      const appUrl = Deno.env.get("APP_URL");
      if (appUrl && !retorno.startsWith(appUrl)) return json({ erro: "Endereço de retorno não permitido." }, 400);
      await db.from("oauth_states").insert({ state, conta_id: conta.id, retorno, criado_por: u.user.id });
      return json({ url: await conector.urlAutorizacao(state, REDIRECT_URI) });
    }

    if (acao === "desconectar") {
      await db.from("conexoes_tokens").delete().eq("conta_id", conta.id);
      await atualizarConexao(db, conta.id, { status: "desconectada", seller_id: null, apelido: null, token_expira_em: null });
      await log(db, conta.id, "oauth", "ok", "Conta desconectada pelo dono");
      return json({ ok: true });
    }

    const conector = conectorDa(conta);
    const ctx = await contexto(db, conta, acao);

    if (acao === "sincronizar") {
      return json(await sincronizarConta(db, conta, ctx, conector));
    }

    if (acao === "listar_anuncios") {
      const lista = await conector.listarAnuncios(ctx);
      const r = await salvarAnuncios(db, conta, lista);
      await log(db, conta.id, "anuncios", "ok",
        `${r.total} anúncio(s)/variação(ões) atualizados; ${r.vinculados_automaticamente} vinculados automaticamente pelo SKU`);
      return json(r);
    }

    if (acao === "atualizar_anuncio") {
      const { data: a } = await db.from("anuncios").select("*").eq("id", body.anuncio_id).eq("conta_id", conta.id).single();
      if (!a) return json({ erro: "Anúncio não encontrado. Atualize a lista de anúncios." }, 404);
      const quantidade = body.quantidade === "" || body.quantidade == null ? null : Number(body.quantidade);
      const preco = body.preco === "" || body.preco == null ? null : Number(body.preco);
      try {
        await conector.atualizarAnuncio(ctx, { item_id: a.item_id ?? a.codigo, variacao_id: a.variacao_id, quantidade, preco });
      } catch (e) {
        await log(db, conta.id, "atualizar_anuncio", "erro", `${a.titulo}: ${erroTexto(e)}`);
        throw e;
      }
      const campos: Record<string, unknown> = {};
      if (quantidade !== null) campos.quantidade_anuncio = quantidade;
      if (preco !== null) campos.preco = preco;
      await db.from("anuncios").update(campos).eq("id", a.id);
      // estoque fictício/preço da conta acompanham o que foi enviado
      if (a.produto_id) {
        const ef: Record<string, unknown> = { produto_id: a.produto_id, conta_id: conta.id, atualizado_em: new Date().toISOString() };
        if (quantidade !== null) ef.quantidade_anuncio = quantidade * (Number(a.unidades_por_venda) || 1);
        if (preco !== null && (Number(a.unidades_por_venda) || 1) === 1) ef.preco = preco;
        await db.from("produto_conta").upsert(ef);
      }
      await log(db, conta.id, "atualizar_anuncio", "ok",
        `${a.titulo}${a.variacao_descricao ? " (" + a.variacao_descricao + ")" : ""}: ` +
        [quantidade !== null ? `quantidade ${quantidade}` : "", preco !== null ? `preço R$ ${preco.toFixed(2)}` : ""].filter(Boolean).join(", "));
      return json({ ok: true });
    }

    if (acao === "reprocessar") {
      return json(await reprocessarPendentes(db, conta));
    }

    return json({ erro: `Ação desconhecida: ${acao}` }, 400);
  } catch (e) {
    return json({ erro: erroTexto(e) }, 400);
  }
});
