// Utilidades compartilhadas pelas Edge Functions (rodam no servidor do Supabase, em Deno).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Conta = { id: number; nome: string; marketplace: "mercadolivre" | "shopee" | "amazon" };

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/oauth-callback`;

/** Cliente com service_role: ignora RLS. Só existe no servidor. */
export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function erroTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Grava no histórico de sincronizações (tela Conexões). Nunca lança erro. */
export async function log(
  db: SupabaseClient,
  contaId: number | null,
  tipo: string,
  status: "ok" | "erro" | "aviso",
  mensagem: string,
  detalhes?: unknown,
) {
  try {
    await db.from("sync_logs").insert({ conta_id: contaId, tipo, status, mensagem: mensagem.slice(0, 2000), detalhes: detalhes ?? null });
  } catch (_) { /* ignora */ }
  if (status === "erro") console.error(`[${tipo}] conta ${contaId}: ${mensagem}`);
}

export async function getConta(db: SupabaseClient, contaId: number): Promise<Conta> {
  const { data, error } = await db.from("contas").select("id,nome,marketplace").eq("id", contaId).single();
  if (error || !data) throw new Error(`Conta ${contaId} não encontrada`);
  return data as Conta;
}

export async function atualizarConexao(db: SupabaseClient, contaId: number, campos: Record<string, unknown>) {
  await db.from("conexoes").upsert({ conta_id: contaId, ...campos, atualizado_em: new Date().toISOString() });
}

// Segredos: primeiro Edge Function Secrets (Deno.env), depois a tabela config_segura
// (preenchida pela tela Conexões). Chame carregarSegredos() no início de cada função.
const cacheSegredos: Record<string, string> = {};
export async function carregarSegredos(db: SupabaseClient) {
  const { data } = await db.from("config_segura").select("chave,valor");
  for (const r of data ?? []) cacheSegredos[r.chave] = r.valor;
}
export function segredo(nome: string): string {
  return Deno.env.get(nome) || cacheSegredos[nome] || "";
}

export function aguardar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** fetch com nova tentativa para 429/5xx e mensagem de erro legível. */
export async function fetchJson(url: string, init: RequestInit = {}, rotulo = "API"): Promise<any> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(url, init);
    const texto = await r.text();
    let corpo: any = texto;
    try { corpo = texto ? JSON.parse(texto) : null; } catch (_) { /* texto puro */ }
    if (r.ok) return corpo;
    if ((r.status === 429 || r.status >= 500) && tentativa < 3) {
      await aguardar(1000 * tentativa);
      continue;
    }
    const msg = typeof corpo === "object" && corpo
      ? [corpo.message, corpo.error, corpo.error_description, corpo.cause && JSON.stringify(corpo.cause),
         corpo.errors && JSON.stringify(corpo.errors)].filter(Boolean).join(" | ")
      : String(texto).slice(0, 300);
    const err = new Error(`${rotulo} ${r.status}: ${msg || r.statusText}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
}
