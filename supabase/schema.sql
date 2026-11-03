-- =====================================================================
-- Café & Queijo — banco de dados (Supabase / PostgreSQL)
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em "Run".
-- Pode rodar de novo sem perder dados (ele só cria o que falta e atualiza as funções).
-- =====================================================================
set client_min_messages = warning;
create extension if not exists pgcrypto;

-- =====================================================================
-- 1. USUÁRIOS E PAPÉIS (dono vê tudo; ajudante lança e consulta)
-- =====================================================================
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  email text,
  papel text not null default 'ajudante' check (papel in ('dono', 'ajudante')),
  criado_em timestamptz not null default now()
);

create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome, papel)
  values (new.id, new.email, split_part(new.email, '@', 1),
          case when exists (select 1 from public.perfis where papel = 'dono') then 'ajudante' else 'dono' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

insert into public.perfis (id, email, nome)
select id, email, split_part(email, '@', 1) from auth.users on conflict (id) do nothing;
update public.perfis set papel = 'dono'
where id = (select id from public.perfis order by criado_em limit 1)
  and not exists (select 1 from public.perfis where papel = 'dono');

create or replace function public.eh_dono()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'dono');
$$;

create or replace function public.eh_servico()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

-- =====================================================================
-- 2. CONTAS DE MARKETPLACE, TARIFAS E CUSTOS DE VENDA
-- =====================================================================
create table if not exists public.contas (
  id serial primary key,
  nome text not null unique,
  marketplace text not null check (marketplace in ('mercadolivre', 'shopee', 'amazon')),
  cor text,
  dias_liberacao int not null default 15,     -- dias até o dinheiro ser liberado (contas a receber)
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into public.contas (nome, marketplace, cor, dias_liberacao) values
  ('Mercado Livre 1', 'mercadolivre', '#e0b100', 15),
  ('Mercado Livre 2', 'mercadolivre', '#9c7c00', 15),
  ('Shopee',          'shopee',       '#ee4d2d', 15),
  ('Amazon 1',        'amazon',       '#232f3e', 14),
  ('Amazon 2',        'amazon',       '#ff9900', 14)
on conflict (nome) do nothing;

-- Tarifas por conta com data de vigência. faixas = custo fixo/frete por faixa de preço:
-- [{"de":0,"ate":79.89,"valor":6.75}, ...]  ("ate": null = sem limite)
create table if not exists public.tarifas (
  id serial primary key,
  conta_id int not null references public.contas (id) on delete cascade,
  vigente_desde date not null default current_date,
  comissao_pct numeric(6,3) not null default 0,
  tarifa_fixa numeric(10,2) not null default 0,     -- por unidade vendida (ex.: Shopee R$ 4)
  faixas jsonb not null default '[]'::jsonb,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (conta_id, vigente_desde)
);

insert into public.tarifas (conta_id, vigente_desde, comissao_pct, tarifa_fixa, faixas, observacao)
select c.id, date '2025-01-01',
  case c.marketplace when 'mercadolivre' then 14 when 'shopee' then 20 else 15 end,
  case c.marketplace when 'shopee' then 4 else 0 end,
  case c.marketplace when 'mercadolivre' then
    '[{"de":0,"ate":79.89,"valor":6.75},{"de":79.9,"ate":99.99,"valor":11.79},{"de":100,"ate":119.99,"valor":13.97},
      {"de":120,"ate":149.99,"valor":15.96},{"de":150,"ate":199.99,"valor":17.96},{"de":200,"ate":null,"valor":19.95}]'::jsonb
  else '[]'::jsonb end,
  case c.marketplace when 'mercadolivre' then 'Clássico 14% / Premium 19%: ajuste a comissão por produto na Precificação'
                     when 'amazon' then 'Valores de exemplo: revise conforme sua categoria' else null end
from public.contas c
where not exists (select 1 from public.tarifas t where t.conta_id = c.id);

-- Custos por venda e parâmetros gerais (linha única, id = 1)
create table if not exists public.config_geral (
  id int primary key default 1 check (id = 1),
  embalagem numeric(10,2) not null default 1,         -- R$ por venda (embalagem, etiqueta, fita)
  custos_indiretos numeric(10,2) not null default 1,  -- R$ por venda (transporte, contador...)
  ads_pct numeric(6,3) not null default 5,            -- % do preço
  imposto_pct numeric(6,3) not null default 0,        -- % sobre faturamento (Simples Nacional...)
  margem_alvo_pct numeric(6,3) not null default 25,
  dias_media_vendas int not null default 30,          -- 30, 60 ou 90
  dias_seguranca int not null default 7,              -- estoque de segurança (dias)
  dias_cobertura_alvo int not null default 45,        -- quanto comprar (dias de venda)
  dias_produto_parado int not null default 60,
  saldo_caixa numeric(12,2) not null default 0,       -- saldo inicial para o fluxo de caixa
  atualizado_em timestamptz not null default now()
);
insert into public.config_geral (id) values (1) on conflict do nothing;

-- =====================================================================
-- 3. CONEXÕES COM APIs (Mercado Livre agora; outras no futuro)
-- =====================================================================
create table if not exists public.conexoes (
  conta_id int primary key references public.contas (id) on delete cascade,
  status text not null default 'desconectada' check (status in ('desconectada', 'conectada', 'expirada', 'erro')),
  seller_id text,
  apelido text,
  token_expira_em timestamptz,
  ultimo_sync timestamptz,
  ultimo_erro text,
  conectado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
insert into public.conexoes (conta_id) select id from public.contas on conflict do nothing;

-- Tokens: RLS ligado e SEM políticas = só o servidor (Edge Functions) acessa
create table if not exists public.conexoes_tokens (
  conta_id int primary key references public.contas (id) on delete cascade,
  access_token text,
  refresh_token text,
  expira_em timestamptz,
  extra jsonb not null default '{}'::jsonb,
  renovando_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.config_segura (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.oauth_states (
  state text primary key,
  conta_id int not null references public.contas (id) on delete cascade,
  retorno text,
  criado_por uuid,
  criado_em timestamptz not null default now()
);

create table if not exists public.sync_logs (
  id bigserial primary key,
  conta_id int references public.contas (id) on delete cascade,
  tipo text not null,
  status text not null default 'ok' check (status in ('ok', 'erro', 'aviso')),
  mensagem text,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_sync_logs on public.sync_logs (criado_em desc);

-- =====================================================================
-- 4. FORNECEDORES, LOCAIS, PRODUTOS (PEÇAS E KITS)
-- =====================================================================
create table if not exists public.fornecedores (
  id serial primary key,
  nome text not null,
  documento text,
  contato text,
  telefone text,
  email text,
  tipo text not null default 'comum' check (tipo in ('comum', 'aliexpress')),
  prazo_entrega_dias int not null default 30,
  observacao text,
  criado_em timestamptz not null default now()
);
insert into public.fornecedores (nome, tipo, prazo_entrega_dias, observacao)
select 'AliExpress', 'aliexpress', 30, 'Pedidos importados pelo botão "Importar AliExpress"'
where not exists (select 1 from public.fornecedores where tipo = 'aliexpress');

create table if not exists public.locais (
  id serial primary key,
  nome text not null unique,
  padrao boolean not null default false,   -- local de onde as vendas baixam
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
insert into public.locais (nome, padrao)
select 'Principal', true where not exists (select 1 from public.locais);

create table if not exists public.produtos (
  id serial primary key,
  sku text not null unique,
  nome text not null,
  tipo text not null default 'peca' check (tipo in ('peca', 'kit')),
  categoria text,
  unidade text not null default 'un',
  estoque_real numeric(12,3) not null default 0,    -- soma de todos os locais (só peças)
  estoque_minimo numeric(12,3) not null default 0,
  custo_medio numeric(12,4) not null default 0,     -- só peças; kits calculam pela lista de peças
  preco_venda numeric(12,2) not null default 0,     -- preço padrão (cada conta pode ter o seu)
  margem_alvo_pct numeric(6,3),                     -- vazio = usa a margem geral
  custo_embalagem numeric(10,2),                    -- vazio = usa o custo geral
  fornecedor_id int references public.fornecedores (id) on delete set null,
  prazo_entrega_dias int,                           -- vazio = prazo do fornecedor
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);

-- Lista de peças de cada kit
create table if not exists public.kit_componentes (
  kit_id int not null references public.produtos (id) on delete cascade,
  peca_id int not null references public.produtos (id) on delete restrict,
  quantidade numeric(12,3) not null check (quantidade > 0),
  primary key (kit_id, peca_id)
);

create or replace function public.validar_kit()
returns trigger language plpgsql as $$
begin
  if (select tipo from produtos where id = new.kit_id) <> 'kit' then
    raise exception 'Só produtos do tipo "kit" têm lista de peças.';
  end if;
  if (select tipo from produtos where id = new.peca_id) <> 'peca' then
    raise exception 'A lista de peças só pode conter peças (não outro kit).';
  end if;
  return new;
end $$;
drop trigger if exists trg_validar_kit on public.kit_componentes;
create trigger trg_validar_kit before insert or update on public.kit_componentes
  for each row execute function public.validar_kit();

-- Estoque por local
create table if not exists public.estoque_locais (
  produto_id int not null references public.produtos (id) on delete cascade,
  local_id int not null references public.locais (id) on delete restrict,
  quantidade numeric(12,3) not null default 0,
  localizacao text,                  -- ex.: "Armário do fundo, prateleira 2"
  primary key (produto_id, local_id)
);

-- Estoque e custo só mudam pelas funções oficiais (vendas, compras, ajustes)
create or replace function public.proteger_estoque()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.rpc', true), '') <> 'on' then
    if tg_table_name = 'produtos' then
      if tg_op = 'INSERT' then
        new.estoque_real := 0;
      elsif new.estoque_real is distinct from old.estoque_real or new.custo_medio is distinct from old.custo_medio then
        raise exception 'Estoque e custo médio só mudam por vendas, compras recebidas ou ajustes.';
      elsif new.tipo is distinct from old.tipo and old.estoque_real <> 0 then
        raise exception 'Zere o estoque antes de transformar esta peça em kit.';
      end if;
    else
      if tg_op = 'INSERT' then
        new.quantidade := 0;
      elsif new.quantidade is distinct from old.quantidade then
        raise exception 'A quantidade só muda por vendas, compras, ajustes ou transferências.';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_estoque on public.produtos;
create trigger trg_proteger_estoque before insert or update on public.produtos
  for each row execute function public.proteger_estoque();
drop trigger if exists trg_proteger_estoque_local on public.estoque_locais;
create trigger trg_proteger_estoque_local before insert or update on public.estoque_locais
  for each row execute function public.proteger_estoque();

-- Produto x conta: estoque FICTÍCIO do anúncio, preço na conta e exceções de tarifa
create table if not exists public.produto_conta (
  produto_id int not null references public.produtos (id) on delete cascade,
  conta_id int not null references public.contas (id) on delete cascade,
  quantidade_anuncio numeric(12,3) not null default 0,  -- número exibido no anúncio (só controle)
  preco numeric(12,2),                                  -- preço atual nesta conta
  comissao_pct numeric(6,3),                            -- vazio = tarifa da conta
  ads_pct numeric(6,3),                                 -- vazio = ADS geral
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (produto_id, conta_id)
);

-- Anúncios de cada conta (lista vinda da API ou das planilhas) e o vínculo com o SKU
create table if not exists public.anuncios (
  id serial primary key,
  conta_id int not null references public.contas (id) on delete cascade,
  codigo text not null,                -- MLB123, MLB123:variação, SKU da Amazon, nome+variação...
  item_id text,
  variacao_id text,
  titulo text,
  variacao_descricao text,
  sku_marketplace text,
  produto_id int references public.produtos (id) on delete set null,
  unidades_por_venda numeric(12,3) not null default 1,
  preco numeric(12,2),
  quantidade_anuncio numeric(12,3),
  status_anuncio text,
  link text,
  imagem text,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (conta_id, codigo)
);

create table if not exists public.movimentos_estoque (
  id bigserial primary key,
  produto_id int not null references public.produtos (id) on delete cascade,
  local_id int references public.locais (id),
  tipo text not null check (tipo in ('venda', 'cancelamento_venda', 'devolucao', 'compra', 'ajuste',
                                     'transferencia', 'inicial', 'ajuste_custo')),
  quantidade numeric(12,3) not null,
  saldo_apos numeric(12,3),
  motivo text,
  observacao text,
  venda_id bigint,
  pedido_compra_id bigint,
  custo_unitario numeric(12,4),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists idx_mov_produto on public.movimentos_estoque (produto_id, criado_em desc);
create index if not exists idx_mov_tipo_data on public.movimentos_estoque (tipo, criado_em);

-- =====================================================================
-- 5. VENDAS
-- =====================================================================
create table if not exists public.vendas (
  id bigserial primary key,
  conta_id int not null references public.contas (id),
  data timestamptz not null default now(),
  codigo_externo text,
  comprador text,
  taxa_marketplace numeric(12,2) not null default 0,   -- tarifas reais cobradas
  frete numeric(12,2) not null default 0,              -- frete pago pelo vendedor
  taxa_prevista numeric(12,2) not null default 0,      -- pela tabela de tarifas (lucro planejado)
  frete_previsto numeric(12,2) not null default 0,
  custo_embalagem numeric(10,2) not null default 0,    -- retrato dos custos no dia da venda
  custo_indireto numeric(10,2) not null default 0,
  ads_pct numeric(6,3) not null default 0,
  imposto_pct numeric(6,3) not null default 0,
  status text not null default 'concluida' check (status in ('concluida', 'cancelada', 'devolvida')),
  origem text not null default 'manual' check (origem in ('manual', 'importacao', 'api', 'historico')),
  previsao_recebimento date,
  valor_recebido numeric(12,2),                        -- conciliação
  data_recebimento date,
  observacao text,
  envio jsonb,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create unique index if not exists uq_venda_externa on public.vendas (conta_id, codigo_externo) where codigo_externo is not null;
create index if not exists idx_vendas_data on public.vendas (data);

create table if not exists public.venda_itens (
  id bigserial primary key,
  venda_id bigint not null references public.vendas (id) on delete cascade,
  produto_id int not null references public.produtos (id),
  quantidade numeric(12,3) not null check (quantidade > 0),
  preco_unitario numeric(12,2) not null default 0,
  custo_unitario numeric(12,4) not null default 0
);
create index if not exists idx_venda_itens_venda on public.venda_itens (venda_id);

create table if not exists public.pedidos_externos (
  id bigserial primary key,
  conta_id int not null references public.contas (id) on delete cascade,
  codigo text not null,
  status_externo text,
  situacao text not null default 'recebido'
    check (situacao in ('recebido', 'importado', 'pendente_vinculo', 'ignorado', 'cancelado', 'erro')),
  mensagem text,
  venda_id bigint references public.vendas (id) on delete set null,
  dados jsonb,
  atualizado_em timestamptz not null default now(),
  unique (conta_id, codigo)
);

-- =====================================================================
-- 6. COMPRAS E CONTAS A PAGAR
-- =====================================================================
create table if not exists public.pedidos_compra (
  id bigserial primary key,
  fornecedor_id int not null references public.fornecedores (id),
  status text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'recebido', 'cancelado')),
  data_pedido date not null default current_date,
  previsao_chegada date,
  data_recebimento date,
  local_id int references public.locais (id),
  numero_externo text,
  status_externo text,
  rastreio text,
  moeda text not null default 'BRL',
  cotacao numeric(12,4) not null default 1,
  total_original numeric(12,2),
  -- custos extras em R$ (rateados por valor entre as peças ao receber)
  frete numeric(12,2) not null default 0,
  imposto_importacao numeric(12,2) not null default 0,
  icms numeric(12,2) not null default 0,
  iof numeric(12,2) not null default 0,
  outras_despesas numeric(12,2) not null default 0,
  forma_pagamento text check (forma_pagamento in ('pix', 'boleto', 'cartao', 'dinheiro', 'outro')),
  parcelas int not null default 1,
  primeiro_vencimento date,
  origem text not null default 'manual' check (origem in ('manual', 'aliexpress', 'historico')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create unique index if not exists uq_pedido_externo on public.pedidos_compra (fornecedor_id, numero_externo) where numero_externo is not null;

create table if not exists public.pedido_compra_itens (
  id bigserial primary key,
  pedido_id bigint not null references public.pedidos_compra (id) on delete cascade,
  produto_id int not null references public.produtos (id),
  quantidade numeric(12,3) not null check (quantidade > 0),
  custo_unitario numeric(12,4) not null default 0,     -- R$ sem frete/impostos
  descricao_externa text,
  variacao_externa text,
  preco_original numeric(12,2)
);

create table if not exists public.mapeamento_itens_fornecedor (
  id serial primary key,
  fornecedor_id int not null references public.fornecedores (id) on delete cascade,
  chave text not null,
  descricao text,
  produto_id int references public.produtos (id) on delete cascade,  -- null = ignorar
  unidades_por_item numeric(12,3) not null default 1,
  criado_em timestamptz not null default now(),
  unique (fornecedor_id, chave)
);

create table if not exists public.contas_pagar (
  id bigserial primary key,
  descricao text not null,
  categoria text not null default 'compra',
  valor numeric(12,2) not null,
  vencimento date not null,
  pago_em date,
  pedido_compra_id bigint references public.pedidos_compra (id) on delete cascade,
  parcela text,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_contas_pagar_venc on public.contas_pagar (vencimento);

-- =====================================================================
-- 7. FUNÇÕES DE CÁLCULO
-- =====================================================================
create or replace function public.local_padrao()
returns int language sql stable as $$
  select id from public.locais where ativo order by padrao desc, id limit 1;
$$;

create or replace function public.valor_faixa(p_faixas jsonb, p_preco numeric)
returns numeric language sql immutable as $$
  select coalesce((
    select (f->>'valor')::numeric from jsonb_array_elements(coalesce(p_faixas, '[]')) f
    where p_preco >= coalesce((f->>'de')::numeric, 0)
      and (f->>'ate' is null or p_preco <= (f->>'ate')::numeric + 0.004)
    order by coalesce((f->>'de')::numeric, 0) desc limit 1), 0);
$$;

create or replace function public.tarifa_vigente(p_conta int, p_data date)
returns public.tarifas language sql stable as $$
  select * from public.tarifas where conta_id = p_conta and vigente_desde <= p_data
  order by vigente_desde desc limit 1;
$$;

-- custo de um produto (peça = custo médio; kit = soma das peças)
create or replace function public.custo_produto(p_id int)
returns numeric language sql stable as $$
  select case when p.tipo = 'kit'
    then coalesce((select sum(k.quantidade * pc.custo_medio) from public.kit_componentes k
                   join public.produtos pc on pc.id = k.peca_id where k.kit_id = p.id), 0)
    else p.custo_medio end
  from public.produtos p where p.id = p_id;
$$;

-- =====================================================================
-- 8. FUNÇÕES QUE MEXEM NO ESTOQUE (tudo em transação)
-- =====================================================================
create or replace function public._mover_estoque(
  p_produto int, p_local int, p_qtd numeric, p_tipo text, p_motivo text, p_obs text,
  p_venda bigint, p_pedido bigint, p_custo numeric
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_saldo numeric; v_tipo text; v_local int := coalesce(p_local, local_padrao());
begin
  select tipo into v_tipo from produtos where id = p_produto;
  if v_tipo is null then raise exception 'Produto % não encontrado', p_produto; end if;
  if v_tipo = 'kit' then raise exception 'Kits não têm estoque próprio: o estoque é das peças.'; end if;
  perform set_config('app.rpc', 'on', true);
  insert into estoque_locais (produto_id, local_id, quantidade) values (p_produto, v_local, 0)
    on conflict do nothing;
  update estoque_locais set quantidade = quantidade + p_qtd where produto_id = p_produto and local_id = v_local;
  update produtos set estoque_real = estoque_real + p_qtd where id = p_produto returning estoque_real into v_saldo;
  insert into movimentos_estoque (produto_id, local_id, tipo, quantidade, saldo_apos, motivo, observacao,
                                  venda_id, pedido_compra_id, custo_unitario)
  values (p_produto, v_local, p_tipo, p_qtd, v_saldo, p_motivo, p_obs, p_venda, p_pedido, p_custo);
  return v_saldo;
end $$;
revoke all on function public._mover_estoque from public, anon, authenticated;

-- Registrar venda. Kits baixam as peças. "historico": true = só registra (não mexe no estoque).
-- p = {conta_id, data, codigo_externo, comprador, taxa_marketplace, frete, origem, observacao,
--      local_id, historico, usar_taxa_prevista, itens:[{produto_id, quantidade, preco_unitario}]}
-- Retorna o id, ou NULL se a venda (conta + codigo_externo) já existia.
create or replace function public.registrar_venda(p_venda jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_item jsonb; v_custo numeric; v_tipo text; v_nome text; k record;
  v_conta int := (p_venda->>'conta_id')::int;
  v_data timestamptz := coalesce((p_venda->>'data')::timestamptz, now());
  v_hist boolean := coalesce((p_venda->>'historico')::boolean, false);
  v_cfg config_geral%rowtype; v_tar tarifas%rowtype; v_pc produto_conta%rowtype;
  v_qtd numeric; v_preco numeric; v_tx numeric := 0; v_fr numeric := 0; v_ads_soma numeric := 0; v_rec numeric := 0;
begin
  if auth.uid() is null and not eh_servico() then raise exception 'Faça login.'; end if;
  if jsonb_array_length(coalesce(p_venda->'itens', '[]')) = 0 then raise exception 'A venda precisa de pelo menos um item.'; end if;
  if v_hist and not eh_dono() then raise exception 'Apenas o dono pode importar histórico.'; end if;
  if nullif(p_venda->>'codigo_externo', '') is not null and exists (
     select 1 from vendas where conta_id = v_conta and codigo_externo = p_venda->>'codigo_externo') then
    return null;
  end if;

  select * into v_cfg from config_geral where id = 1;
  select * into v_tar from tarifa_vigente(v_conta, v_data::date);

  insert into vendas (conta_id, data, codigo_externo, comprador, taxa_marketplace, frete, origem, observacao,
                      custo_embalagem, custo_indireto, imposto_pct, previsao_recebimento)
  values (v_conta, v_data, nullif(p_venda->>'codigo_externo', ''), nullif(p_venda->>'comprador', ''),
          coalesce((p_venda->>'taxa_marketplace')::numeric, 0), coalesce((p_venda->>'frete')::numeric, 0),
          case when v_hist then 'historico' else coalesce(p_venda->>'origem', 'manual') end,
          nullif(p_venda->>'observacao', ''),
          coalesce(v_cfg.embalagem, 0), coalesce(v_cfg.custos_indiretos, 0), coalesce(v_cfg.imposto_pct, 0),
          (v_data + make_interval(days => (select dias_liberacao from contas where id = v_conta)))::date)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_venda->'itens') loop
    select tipo, nome into v_tipo, v_nome from produtos where id = (v_item->>'produto_id')::int;
    if v_tipo is null then raise exception 'Produto % não existe.', v_item->>'produto_id'; end if;
    v_qtd := (v_item->>'quantidade')::numeric;
    v_preco := coalesce((v_item->>'preco_unitario')::numeric, 0);
    v_custo := coalesce((v_item->>'custo_unitario')::numeric, custo_produto((v_item->>'produto_id')::int), 0);
    insert into venda_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
    values (v_id, (v_item->>'produto_id')::int, v_qtd, v_preco, v_custo);

    -- tarifas previstas pela tabela (por unidade) -> lucro planejado
    select * into v_pc from produto_conta where produto_id = (v_item->>'produto_id')::int and conta_id = v_conta;
    v_tx := v_tx + v_qtd * (v_preco * coalesce(v_pc.comissao_pct, v_tar.comissao_pct, 0) / 100 + coalesce(v_tar.tarifa_fixa, 0));
    v_fr := v_fr + v_qtd * valor_faixa(v_tar.faixas, v_preco);
    v_ads_soma := v_ads_soma + coalesce(v_pc.ads_pct, v_cfg.ads_pct, 0) * v_qtd * v_preco;
    v_rec := v_rec + v_qtd * v_preco;

    if not v_hist then
      if v_tipo = 'kit' then
        if not exists (select 1 from kit_componentes where kit_id = (v_item->>'produto_id')::int) then
          raise exception 'O kit "%" ainda não tem lista de peças. Cadastre em Produtos.', v_nome;
        end if;
        for k in select kc.peca_id, kc.quantidade, pc.custo_medio from kit_componentes kc
                 join produtos pc on pc.id = kc.peca_id where kc.kit_id = (v_item->>'produto_id')::int loop
          perform _mover_estoque(k.peca_id, (p_venda->>'local_id')::int, -(v_qtd * k.quantidade), 'venda',
                                 null, 'Kit: ' || v_nome, v_id, null, k.custo_medio);
        end loop;
      else
        perform _mover_estoque((v_item->>'produto_id')::int, (p_venda->>'local_id')::int, -v_qtd, 'venda',
                               null, null, v_id, null, v_custo);
      end if;
    end if;
  end loop;

  update vendas set taxa_prevista = round(v_tx, 2), frete_previsto = round(v_fr, 2),
         ads_pct = case when v_rec > 0 then round(v_ads_soma / v_rec, 3) else coalesce(v_cfg.ads_pct, 0) end
  where id = v_id;
  -- planilha sem coluna de taxa: usa a tarifa prevista pela tabela
  if coalesce((p_venda->>'usar_taxa_prevista')::boolean, false) then
    update vendas set taxa_marketplace = taxa_prevista where id = v_id;
  end if;
  return v_id;
end $$;

-- Cancelar (devolve estoque) ou registrar devolução (p_volta_estoque = false se o item voltou estragado)
create or replace function public.cancelar_venda(p_venda_id bigint, p_status text default 'cancelada', p_volta_estoque boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_origem text;
begin
  if not (eh_dono() or eh_servico()) then raise exception 'Apenas o dono pode cancelar vendas.'; end if;
  if p_status not in ('cancelada', 'devolvida') then raise exception 'Status inválido.'; end if;
  select origem into v_origem from vendas where id = p_venda_id and status = 'concluida';
  if not found then raise exception 'Venda não encontrada ou já cancelada.'; end if;
  update vendas set status = p_status where id = p_venda_id;
  if p_volta_estoque and v_origem <> 'historico' then
    for r in select produto_id, -quantidade as qtd, custo_unitario, local_id from movimentos_estoque
             where venda_id = p_venda_id and tipo = 'venda' loop
      perform _mover_estoque(r.produto_id, r.local_id, r.qtd,
        case when p_status = 'devolvida' then 'devolucao' else 'cancelamento_venda' end,
        null, 'Estorno da venda #' || p_venda_id, p_venda_id, null, r.custo_unitario);
    end loop;
  end if;
end $$;

-- Ajuste manual. p_operacao: 'entrada' | 'saida' | 'definir' (contagem de inventário)
create or replace function public.ajustar_estoque(
  p_produto_id int, p_local_id int, p_operacao text, p_quantidade numeric, p_motivo text, p_observacao text default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_atual numeric; v_delta numeric; v_local int := coalesce(p_local_id, local_padrao());
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_motivo not in ('perda', 'vencimento', 'inventario', 'avaria', 'consumo', 'inicial', 'outro') then
    raise exception 'Motivo inválido.';
  end if;
  if p_motivo = 'inicial' and not eh_dono() then raise exception 'Apenas o dono lança estoque inicial.'; end if;
  perform 1 from produtos where id = p_produto_id for update;
  select coalesce((select quantidade from estoque_locais where produto_id = p_produto_id and local_id = v_local), 0) into v_atual;
  v_delta := case p_operacao when 'entrada' then abs(p_quantidade) when 'saida' then -abs(p_quantidade)
                             when 'definir' then p_quantidade - v_atual end;
  if v_delta is null then raise exception 'Operação inválida.'; end if;
  if v_delta = 0 then return v_atual; end if;
  perform _mover_estoque(p_produto_id, v_local, v_delta, case when p_motivo = 'inicial' then 'inicial' else 'ajuste' end,
                         p_motivo, p_observacao, null, null, null);
  return v_atual + v_delta;
end $$;

create or replace function public.transferir_estoque(p_produto_id int, p_de int, p_para int, p_quantidade numeric, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_de = p_para then raise exception 'Escolha locais diferentes.'; end if;
  if p_quantidade <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  perform _mover_estoque(p_produto_id, p_de, -p_quantidade, 'transferencia', null, coalesce(p_obs, 'Transferência'), null, null, null);
  perform _mover_estoque(p_produto_id, p_para, p_quantidade, 'transferencia', null, coalesce(p_obs, 'Transferência'), null, null, null);
end $$;

-- Define o custo médio na mão (importação inicial / correção). Só o dono.
create or replace function public.definir_custo(p_produto_id int, p_custo numeric, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_dono() then raise exception 'Apenas o dono pode alterar o custo.'; end if;
  if (select tipo from produtos where id = p_produto_id) = 'kit' then
    raise exception 'O custo do kit é calculado pelas peças.';
  end if;
  perform set_config('app.rpc', 'on', true);
  update produtos set custo_medio = round(p_custo, 4) where id = p_produto_id;
  insert into movimentos_estoque (produto_id, tipo, quantidade, motivo, observacao, custo_unitario)
  values (p_produto_id, 'ajuste_custo', 0, 'outro', coalesce(p_obs, 'Custo definido manualmente'), p_custo);
end $$;

-- Gera/atualiza as parcelas em "contas a pagar" de um pedido de compra (não mexe nas já pagas)
create or replace function public.gerar_contas_pagar(p_pedido_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v_total numeric; v_pago numeric; v_n int; v_qpagas int; i int; v_forn text;
begin
  if not eh_dono() then raise exception 'Apenas o dono.'; end if;
  select * into v_ped from pedidos_compra where id = p_pedido_id;
  delete from contas_pagar where pedido_compra_id = p_pedido_id and pago_em is null;
  if v_ped.status = 'cancelado' or v_ped.origem = 'historico' or v_ped.forma_pagamento is null then return; end if;
  select nome into v_forn from fornecedores where id = v_ped.fornecedor_id;
  select coalesce(sum(quantidade * custo_unitario), 0) into v_total from pedido_compra_itens where pedido_id = p_pedido_id;
  v_total := v_total + v_ped.frete + v_ped.imposto_importacao + v_ped.icms + v_ped.iof + v_ped.outras_despesas;
  select coalesce(sum(valor), 0), count(*) into v_pago, v_qpagas from contas_pagar where pedido_compra_id = p_pedido_id;
  v_n := greatest(coalesce(v_ped.parcelas, 1), 1);
  if v_total - v_pago <= 0 or v_qpagas >= v_n then return; end if;
  for i in (v_qpagas + 1)..v_n loop
    insert into contas_pagar (descricao, categoria, valor, vencimento, pedido_compra_id, parcela)
    values ('Compra #' || p_pedido_id || ' — ' || coalesce(v_forn, ''), 'compra',
            round((v_total - v_pago) / (v_n - v_qpagas), 2),
            (coalesce(v_ped.primeiro_vencimento, v_ped.data_pedido) + make_interval(months => i - 1))::date,
            p_pedido_id, i || '/' || v_n);
  end loop;
end $$;

-- Cria pedido de compra com itens. Retorna id, ou NULL se o nº externo já existe para o fornecedor.
-- origem 'historico' = pedido antigo: fica "recebido" sem mexer no estoque nem no custo.
create or replace function public.criar_pedido_compra(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_item jsonb; v_hist boolean := coalesce(p->>'origem', '') = 'historico';
begin
  if not eh_dono() then raise exception 'Apenas o dono pode criar pedidos de compra.'; end if;
  if nullif(p->>'numero_externo', '') is not null and exists (
     select 1 from pedidos_compra where fornecedor_id = (p->>'fornecedor_id')::int and numero_externo = p->>'numero_externo') then
    return null;
  end if;
  insert into pedidos_compra (fornecedor_id, status, data_pedido, previsao_chegada, data_recebimento, local_id,
    numero_externo, status_externo, rastreio, moeda, cotacao, total_original, frete, imposto_importacao, icms, iof,
    outras_despesas, forma_pagamento, parcelas, primeiro_vencimento, origem, observacao)
  values ((p->>'fornecedor_id')::int,
          case when v_hist then 'recebido' else coalesce(p->>'status', 'rascunho') end,
          coalesce((p->>'data_pedido')::date, current_date), (p->>'previsao_chegada')::date,
          case when v_hist then coalesce((p->>'data_pedido')::date, current_date) end,
          (p->>'local_id')::int, nullif(p->>'numero_externo', ''), nullif(p->>'status_externo', ''), nullif(p->>'rastreio', ''),
          coalesce(nullif(p->>'moeda', ''), 'BRL'), coalesce((p->>'cotacao')::numeric, 1), (p->>'total_original')::numeric,
          coalesce((p->>'frete')::numeric, 0), coalesce((p->>'imposto_importacao')::numeric, 0),
          coalesce((p->>'icms')::numeric, 0), coalesce((p->>'iof')::numeric, 0), coalesce((p->>'outras_despesas')::numeric, 0),
          nullif(p->>'forma_pagamento', ''), coalesce((p->>'parcelas')::int, 1), (p->>'primeiro_vencimento')::date,
          coalesce(p->>'origem', 'manual'), nullif(p->>'observacao', ''))
  returning id into v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    insert into pedido_compra_itens (pedido_id, produto_id, quantidade, custo_unitario, descricao_externa, variacao_externa, preco_original)
    values (v_id, (v_item->>'produto_id')::int, (v_item->>'quantidade')::numeric, coalesce((v_item->>'custo_unitario')::numeric, 0),
            v_item->>'descricao_externa', v_item->>'variacao_externa', (v_item->>'preco_original')::numeric);
  end loop;
  perform gerar_contas_pagar(v_id);
  return v_id;
end $$;

create or replace function public._receber_peca(p_peca int, p_local int, p_qtd numeric, p_custo_unit numeric, p_pedido bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_est numeric; v_ant numeric; v_novo numeric;
begin
  select greatest(estoque_real, 0), custo_medio into v_est, v_ant from produtos where id = p_peca for update;
  v_novo := case when v_est + p_qtd > 0 then (v_est * v_ant + p_qtd * p_custo_unit) / (v_est + p_qtd) else p_custo_unit end;
  perform set_config('app.rpc', 'on', true);
  update produtos set custo_medio = round(v_novo, 4) where id = p_peca;
  perform _mover_estoque(p_peca, p_local, p_qtd, 'compra', null, 'Pedido de compra #' || p_pedido, null, p_pedido, p_custo_unit);
end $$;
revoke all on function public._receber_peca from public, anon, authenticated;

-- Receber pedido: entra no estoque do local e atualiza o custo médio ponderado.
-- Custo de cada peça = preço + (frete + II + ICMS + IOF + outras) rateados pelo valor.
-- Se um KIT foi comprado, ele entra como as peças dele (custo dividido pelo custo médio das peças).
create or replace function public.receber_pedido_compra(p_pedido_id bigint, p_data date default current_date, p_local_id int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ped pedidos_compra%rowtype; v_total numeric; v_qtd_total numeric; v_extra numeric;
  r record; k record; v_unit numeric; v_base_kit numeric; v_qtd_kit numeric; v_local int;
begin
  if not eh_dono() then raise exception 'Apenas o dono pode receber pedidos.'; end if;
  select * into v_ped from pedidos_compra where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status in ('recebido', 'cancelado') then raise exception 'Pedido já está %.', v_ped.status; end if;
  v_local := coalesce(p_local_id, v_ped.local_id, local_padrao());

  select coalesce(sum(quantidade * custo_unitario), 0), coalesce(sum(quantidade), 0)
    into v_total, v_qtd_total from pedido_compra_itens where pedido_id = p_pedido_id;
  if v_qtd_total = 0 then raise exception 'O pedido não tem itens.'; end if;
  v_extra := v_ped.frete + v_ped.imposto_importacao + v_ped.icms + v_ped.iof + v_ped.outras_despesas;

  for r in select i.*, p.tipo from pedido_compra_itens i join produtos p on p.id = i.produto_id where i.pedido_id = p_pedido_id loop
    v_unit := r.custo_unitario + case when v_total > 0 then v_extra * (r.custo_unitario / v_total) else v_extra / v_qtd_total end;
    if r.tipo = 'kit' then
      select coalesce(sum(kc.quantidade * pc.custo_medio), 0), coalesce(sum(kc.quantidade), 0) into v_base_kit, v_qtd_kit
        from kit_componentes kc join produtos pc on pc.id = kc.peca_id where kc.kit_id = r.produto_id;
      if v_qtd_kit = 0 then raise exception 'Há um kit sem lista de peças neste pedido. Cadastre as peças do kit antes de receber.'; end if;
      for k in select kc.peca_id, kc.quantidade, pc.custo_medio from kit_componentes kc
               join produtos pc on pc.id = kc.peca_id where kc.kit_id = r.produto_id loop
        perform _receber_peca(k.peca_id, v_local, r.quantidade * k.quantidade,
          case when v_base_kit > 0 then v_unit * (k.custo_medio / v_base_kit) else v_unit / v_qtd_kit end, p_pedido_id);
      end loop;
    else
      perform _receber_peca(r.produto_id, v_local, r.quantidade, v_unit, p_pedido_id);
    end if;
  end loop;
  update pedidos_compra set status = 'recebido', data_recebimento = coalesce(p_data, current_date), local_id = v_local
  where id = p_pedido_id;
end $$;

-- =====================================================================
-- 9. VISÕES (relatórios, painel, reposição)
-- =====================================================================
drop view if exists public.vw_vendas;
drop view if exists public.vw_vendas_itens;
drop view if exists public.vw_produtos;
drop view if exists public.vw_consumo_pecas;
drop view if exists public.vw_a_caminho;

create view public.vw_produtos with (security_invoker = true) as
select p.*,
  custo_produto(p.id) as custo,
  case when p.tipo = 'kit' then coalesce((
    select min(floor(greatest(pc.estoque_real, 0) / k.quantidade)) from kit_componentes k
    join produtos pc on pc.id = k.peca_id where k.kit_id = p.id), 0)
  else p.estoque_real end as disponivel,
  (select count(*) from kit_componentes k where k.kit_id = p.id) as qtd_pecas
from produtos p;

-- Cada item vendido com sua parte de taxa, frete e custos da venda (rateio pelo valor do item)
create view public.vw_vendas_itens with (security_invoker = true) as
select
  vi.id as item_id, v.id as venda_id, v.data, v.conta_id, c.nome as conta_nome, v.status, v.origem,
  v.codigo_externo, vi.produto_id, p.sku, p.nome as produto_nome, p.tipo, p.categoria,
  vi.quantidade, vi.preco_unitario, vi.custo_unitario, t.share,
  vi.quantidade * vi.preco_unitario as receita,
  v.taxa_marketplace * t.share as taxa,
  v.frete * t.share as frete,
  (v.custo_embalagem + v.custo_indireto) * t.share as custos_venda,
  vi.quantidade * vi.preco_unitario * (v.ads_pct + v.imposto_pct) / 100 as ads_impostos,
  vi.quantidade * vi.custo_unitario as custo,
  vi.quantidade * vi.preco_unitario - (v.taxa_marketplace + v.frete + v.custo_embalagem + v.custo_indireto) * t.share
    - vi.quantidade * vi.preco_unitario * (v.ads_pct + v.imposto_pct) / 100
    - vi.quantidade * vi.custo_unitario as lucro,
  vi.quantidade * vi.preco_unitario - (v.taxa_prevista + v.frete_previsto + v.custo_embalagem + v.custo_indireto) * t.share
    - vi.quantidade * vi.preco_unitario * (v.ads_pct + v.imposto_pct) / 100
    - vi.quantidade * vi.custo_unitario as lucro_planejado
from venda_itens vi
join vendas v on v.id = vi.venda_id
join contas c on c.id = v.conta_id
join produtos p on p.id = vi.produto_id
join lateral (
  select case when sum(x.quantidade * x.preco_unitario) > 0
              then (vi.quantidade * vi.preco_unitario) / sum(x.quantidade * x.preco_unitario)
              else 1.0 / count(*) end as share
  from venda_itens x where x.venda_id = v.id
) t on true;

-- Uma linha por venda (lista, conciliação, alertas de prejuízo, contas a receber)
create view public.vw_vendas with (security_invoker = true) as
select v.*, c.nome as conta_nome, c.marketplace,
  coalesce(s.receita, 0) as receita, coalesce(s.custo, 0) as custo, coalesce(s.lucro, 0) as lucro,
  coalesce(s.lucro_planejado, 0) as lucro_planejado, coalesce(s.itens, '') as itens_resumo,
  coalesce(s.receita, 0) - v.taxa_marketplace - v.frete as liquido_previsto,
  case when v.valor_recebido is null then null
       else v.valor_recebido - (coalesce(s.receita, 0) - v.taxa_marketplace - v.frete) end as diferenca_recebido
from vendas v
join contas c on c.id = v.conta_id
left join lateral (
  select sum(i.receita) as receita, sum(i.custo) as custo, sum(i.lucro) as lucro, sum(i.lucro_planejado) as lucro_planejado,
         string_agg(trim_scale(i.quantidade) || 'x ' || i.sku, ', ') as itens
  from vw_vendas_itens i where i.venda_id = v.id
) s on true;

-- Saída de cada peça por vendas (líquida de cancelamentos) — kits já explodidos nas peças
create view public.vw_consumo_pecas with (security_invoker = true) as
select p.id as produto_id,
  coalesce(-sum(m.quantidade) filter (where m.criado_em >= now() - interval '30 days'), 0) as saida_30,
  coalesce(-sum(m.quantidade) filter (where m.criado_em >= now() - interval '60 days'), 0) as saida_60,
  coalesce(-sum(m.quantidade) filter (where m.criado_em >= now() - interval '90 days'), 0) as saida_90,
  max(m.criado_em) filter (where m.tipo = 'venda') as ultima_venda
from produtos p
left join movimentos_estoque m on m.produto_id = p.id and m.tipo in ('venda', 'cancelamento_venda', 'devolucao')
where p.tipo = 'peca'
group by p.id;

-- Quantidade a caminho (pedidos "enviado"), já explodindo kits
create view public.vw_a_caminho with (security_invoker = true) as
select produto_id, sum(qtd) as quantidade, min(previsao) as proxima_chegada from (
  select i.produto_id, i.quantidade as qtd, pc.previsao_chegada as previsao
  from pedido_compra_itens i join pedidos_compra pc on pc.id = i.pedido_id join produtos p on p.id = i.produto_id
  where pc.status = 'enviado' and p.tipo = 'peca'
  union all
  select k.peca_id, i.quantidade * k.quantidade, pc.previsao_chegada
  from pedido_compra_itens i join pedidos_compra pc on pc.id = i.pedido_id join kit_componentes k on k.kit_id = i.produto_id
  where pc.status = 'enviado'
) x group by produto_id;

-- =====================================================================
-- 10. SEGURANÇA (Row Level Security)
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['perfis','contas','tarifas','config_geral','conexoes','conexoes_tokens','config_segura',
    'oauth_states','sync_logs','fornecedores','locais','produtos','kit_componentes','estoque_locais','produto_conta',
    'anuncios','movimentos_estoque','vendas','venda_itens','pedidos_externos','pedidos_compra','pedido_compra_itens',
    'mapeamento_itens_fornecedor','contas_pagar']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists leitura on public.%I', t);
    execute format('drop policy if exists dono_escreve on public.%I', t);
    execute format('drop policy if exists todos_inserem on public.%I', t);
    execute format('drop policy if exists todos_atualizam on public.%I', t);
  end loop;

  -- leitura: qualquer usuário logado
  foreach t in array array['perfis','contas','tarifas','config_geral','fornecedores','locais','produtos','kit_componentes',
    'estoque_locais','produto_conta','anuncios','movimentos_estoque','vendas','venda_itens','pedidos_externos',
    'pedidos_compra','pedido_compra_itens','mapeamento_itens_fornecedor']
  loop
    execute format('create policy leitura on public.%I for select to authenticated using (true)', t);
  end loop;

  -- escrita: só o dono
  foreach t in array array['contas','tarifas','config_geral','fornecedores','locais','produtos','kit_componentes',
    'estoque_locais','produto_conta','anuncios','pedidos_compra','pedido_compra_itens','mapeamento_itens_fornecedor','contas_pagar']
  loop
    execute format('create policy dono_escreve on public.%I for all to authenticated using (eh_dono()) with check (eh_dono())', t);
  end loop;
end $$;

-- financeiro e conexões: só o dono enxerga
create policy leitura on public.contas_pagar for select to authenticated using (eh_dono());
create policy leitura on public.conexoes for select to authenticated using (eh_dono());
create policy leitura on public.sync_logs for select to authenticated using (eh_dono());
create policy dono_escreve on public.perfis for update to authenticated using (eh_dono()) with check (eh_dono());
create policy dono_escreve on public.vendas for update to authenticated using (eh_dono()) with check (eh_dono());
-- o ajudante pode vincular anúncios e atualizar o estoque fictício (lançamentos)
create policy todos_inserem on public.anuncios for insert to authenticated with check (true);
create policy todos_atualizam on public.anuncios for update to authenticated using (true) with check (true);
create policy todos_inserem on public.produto_conta for insert to authenticated with check (true);
create policy todos_atualizam on public.produto_conta for update to authenticated using (true) with check (true);
-- conexoes_tokens, config_segura, oauth_states: nenhuma política = inacessíveis pelo app
-- vendas, ajustes, recebimentos de compra: só pelas funções acima

grant execute on function public.registrar_venda(jsonb) to authenticated;
grant execute on function public.cancelar_venda(bigint, text, boolean) to authenticated;
grant execute on function public.ajustar_estoque(int, int, text, numeric, text, text) to authenticated;
grant execute on function public.transferir_estoque(int, int, int, numeric, text) to authenticated;
grant execute on function public.definir_custo(int, numeric, text) to authenticated;
grant execute on function public.criar_pedido_compra(jsonb) to authenticated;
grant execute on function public.receber_pedido_compra(bigint, date, int) to authenticated;
grant execute on function public.gerar_contas_pagar(bigint) to authenticated;
grant execute on function public.eh_dono() to authenticated;
grant select on public.vw_produtos, public.vw_vendas_itens, public.vw_vendas, public.vw_consumo_pecas, public.vw_a_caminho to authenticated;

-- avisa a API do Supabase para recarregar o esquema
notify pgrst, 'reload schema';
