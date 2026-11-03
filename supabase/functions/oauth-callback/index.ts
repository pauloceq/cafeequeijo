// O marketplace redireciona o navegador para cá depois que você autoriza o app.
// Troca o "code" por tokens, guarda no banco (só o servidor lê) e volta para o app.
import { admin, atualizarConexao, carregarSegredos, erroTexto, getConta, log, REDIRECT_URI } from "../_shared/db.ts";
import { conectorDa } from "../_shared/conectores/index.ts";

function voltar(retorno: string | null, resultado: string, mensagem: string) {
  if (!retorno) {
    return new Response(`<meta charset="utf-8"><h3>${mensagem}</h3><p>Pode fechar esta aba e voltar ao app.</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const url = `${retorno.split("#")[0]}#/conexoes?resultado=${resultado}&mensagem=${encodeURIComponent(mensagem)}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  const db = admin();
  if (!state) return voltar(null, "erro", "Link de retorno inválido (sem state). Tente conectar de novo pelo app.");

  const { data: st } = await db.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st) return voltar(null, "erro", "Este link de autorização expirou ou já foi usado. Clique em Conectar de novo no app.");
  await db.from("oauth_states").delete().eq("state", state);

  try {
    if (Date.now() - new Date(st.criado_em).getTime() > 30 * 60 * 1000) {
      throw new Error("A autorização demorou mais de 30 minutos. Clique em Conectar de novo.");
    }
    if (params.get("error")) throw new Error(`O marketplace recusou: ${params.get("error_description") ?? params.get("error")}`);
    await carregarSegredos(db);
    const conta = await getConta(db, st.conta_id);
    const r = await conectorDa(conta).trocarCodigo(params, REDIRECT_URI);

    // a mesma conta do marketplace não pode estar ligada em duas contas do app
    const { data: outra } = await db.from("conexoes").select("conta_id")
      .eq("seller_id", r.seller_id).neq("conta_id", conta.id).maybeSingle();
    if (outra) {
      throw new Error("Esta conta do marketplace já está conectada em outra conta do app. " +
        "Saia do marketplace no navegador, entre com a OUTRA conta e conecte de novo.");
    }

    await db.from("conexoes_tokens").upsert({
      conta_id: conta.id, access_token: r.access_token, refresh_token: r.refresh_token ?? null,
      expira_em: r.expira_em, extra: r.extra ?? {}, renovando_em: null, atualizado_em: new Date().toISOString(),
    });
    await atualizarConexao(db, conta.id, {
      status: "conectada", seller_id: r.seller_id, apelido: r.apelido ?? null,
      token_expira_em: r.expira_em, ultimo_erro: null, conectado_em: new Date().toISOString(),
    });
    await log(db, conta.id, "oauth", "ok", `Conectada à conta ${r.apelido ?? r.seller_id}`);
    return voltar(st.retorno, "ok", `${conta.nome} conectada com sucesso (${r.apelido ?? r.seller_id}).`);
  } catch (e) {
    await log(db, st.conta_id, "oauth", "erro", erroTexto(e));
    await atualizarConexao(db, st.conta_id, { ultimo_erro: erroTexto(e) });
    return voltar(st.retorno, "erro", erroTexto(e));
  }
});
