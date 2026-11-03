import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aguardar, atualizarConexao, Conta, erroTexto, getConta, log } from "../db.ts";
import type { Conector, Contexto } from "./tipos.ts";
import { mercadoLivre } from "./mercadolivre.ts";
import { integradorBling } from "./integrador-bling.ts";

// Conectores ATIVOS. Shopee e Amazon funcionam por planilha; no futuro podem
// entrar aqui via integrador (ex.: Bling) — veja integrador-bling.ts.
export const conectores: Partial<Record<Conta["marketplace"], Conector>> = {
  mercadolivre: mercadoLivre,
};

export function conectorDa(conta: Conta): Conector {
  const c = conectores[conta.marketplace];
  if (!c) {
    throw new Error(`${conta.nome}: conexão direta ainda não disponível. Use a importação por planilha.`);
  }
  return c;
}

export { integradorBling };

/**
 * Devolve um access token válido para a conta, renovando com o refresh token
 * quando faltar menos de 5 minutos para expirar. Usa uma trava (renovando_em)
 * porque o Mercado Livre invalida o refresh token após o uso.
 */
export async function obterToken(db: SupabaseClient, conta: Conta): Promise<string> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const { data: t } = await db.from("conexoes_tokens").select("*").eq("conta_id", conta.id).maybeSingle();
    if (!t?.access_token) throw new Error("Conta não conectada. Conecte na tela Conexões.");
    const valido = t.expira_em && new Date(t.expira_em).getTime() - Date.now() > 5 * 60 * 1000;
    if (valido) return t.access_token;
    if (!t.refresh_token) {
      await atualizarConexao(db, conta.id, { status: "expirada", ultimo_erro: "Token expirado e sem refresh token" });
      throw new Error("Token expirado. Reconecte a conta.");
    }

    // tenta pegar a trava de renovação
    const limite = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: travou } = await db.from("conexoes_tokens")
      .update({ renovando_em: new Date().toISOString() })
      .eq("conta_id", conta.id)
      .or(`renovando_em.is.null,renovando_em.lt.${limite}`)
      .select("conta_id");
    if (!travou?.length) { await aguardar(1500); continue; } // outro processo está renovando

    try {
      const { data: c } = await db.from("conexoes").select("seller_id").eq("conta_id", conta.id).single();
      const novo = await conectorDa(conta).renovarToken(t.refresh_token, c?.seller_id ?? "");
      await db.from("conexoes_tokens").update({
        access_token: novo.access_token,
        refresh_token: novo.refresh_token ?? t.refresh_token,
        expira_em: novo.expira_em,
        extra: { ...(t.extra ?? {}), ...(novo.extra ?? {}) },
        renovando_em: null,
        atualizado_em: new Date().toISOString(),
      }).eq("conta_id", conta.id);
      await atualizarConexao(db, conta.id, { status: "conectada", token_expira_em: novo.expira_em, ultimo_erro: null });
      await log(db, conta.id, "token", "ok", "Token renovado");
      return novo.access_token;
    } catch (e) {
      await db.from("conexoes_tokens").update({ renovando_em: null }).eq("conta_id", conta.id);
      await atualizarConexao(db, conta.id, { status: "expirada", ultimo_erro: erroTexto(e) });
      await log(db, conta.id, "token", "erro", `Falha ao renovar token: ${erroTexto(e)}`);
      throw new Error(`Falha ao renovar token: ${erroTexto(e)}. Reconecte a conta.`);
    }
  }
  throw new Error("Não foi possível obter o token (renovação em andamento).");
}

export async function contexto(db: SupabaseClient, contaOuId: Conta | number, tipoLog = "sync"): Promise<Contexto> {
  const conta = typeof contaOuId === "number" ? await getConta(db, contaOuId) : contaOuId;
  const { data: c } = await db.from("conexoes").select("seller_id,status").eq("conta_id", conta.id).single();
  if (!c?.seller_id) throw new Error(`${conta.nome}: conta não conectada.`);
  return {
    conta,
    sellerId: c.seller_id,
    token: () => obterToken(db, conta),
    aviso: (msg, det) => log(db, conta.id, tipoLog, "aviso", msg, det),
  };
}
