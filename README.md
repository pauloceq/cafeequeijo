# ☕ Café & Queijo — Gestão de estoque, vendas e compras

App web (React + Vite + Supabase) para gerenciar uma loja que vende os mesmos produtos em
**Mercado Livre 1, Mercado Livre 2, Shopee, Amazon 1 e Amazon 2**.

- **Estoque real** só em **peças**, por **local** (Principal, Estoque Escola…), com localização física e valor por local.
- **Kits/pacotes** com lista de peças: custo e disponibilidade calculados; vender um kit baixa as peças.
- **Estoque fictício** por produto × conta (o número do anúncio), só para controle.
- **Vendas**: lançamento manual, **importação por planilha** (formato detectado sozinho, vínculo anúncio → SKU lembrado, sem duplicar) e, opcionalmente, **automática pelo Mercado Livre** (API).
- **Precificação** por conta: preço atual, mínimo, sugerido para a margem-alvo, lucro, margem, ROI; tarifas por conta com vigência e faixas de frete; alertas de prejuízo.
- **Exportação** de estoque/preço preenchendo a própria planilha de edição em massa de cada site.
- **Compras** com custo de importação (frete, II, ICMS, IOF) rateado, custo médio ponderado, parcelas no cartão, **importação do AliExpress** (botão no navegador ou texto colado) e **reposição** por média de vendas, prazo e dias de cobertura.
- **Financeiro**: conciliação (previsto × recebido), contas a pagar e a receber, fluxo de caixa semanal.
- **Relatórios**: faturamento, custos e lucro por período/conta/produto, curva ABC, produtos parados, lucro real × planejado, devoluções.
- **Login**: dono vê tudo; ajudante lança e consulta.
- **Importação inicial** da planilha antiga (abas Precificação, Pedidos, Vendas, Estoque…), com lista de dados inconsistentes para revisar.

> Tudo funciona sem mexer em código. Os passos abaixo são feitos só uma vez.

---

## Passo a passo da instalação (≈ 20 minutos)

### 1. Criar o projeto gratuito no Supabase

1. Acesse **https://supabase.com** → **Start your project** → entre com sua conta do GitHub.
2. Clique em **New project**:
   - **Name**: `cafeequeijo`
   - **Database Password**: clique em *Generate a password* e **guarde essa senha** (não vai ser usada no app, mas é bom ter).
   - **Region**: **South America (São Paulo)**.
   - Plano **Free** → **Create new project**. Espere 1–2 minutos.

### 2. Criar as tabelas (rodar o `schema.sql`)

1. No menu da esquerda do Supabase, clique em **SQL Editor** → **New query**.
2. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) aqui no GitHub, clique no botão **Copy raw file** (ícone de copiar) e cole tudo no editor.
3. Clique em **Run**. Deve aparecer *“Success. No rows returned”*.

> Sempre que o app for atualizado, rode o `schema.sql` de novo do mesmo jeito: ele não apaga dados.

### 3. Configurar o login

1. **Authentication → Sign In / Providers → Email**: desligue **“Allow new users to sign up”** (só você cria usuários) e salve.
2. **Authentication → Users → Add user → Create new user**: seu e-mail e uma senha, marque **Auto Confirm User** → **Create user**.
   **O primeiro usuário criado é o DONO.** Os próximos (ajudantes) entram como *ajudante*; dá para mudar em Configurações → Usuários.

### 4. Pegar as chaves e colar no GitHub

1. No Supabase: **Project Settings** (engrenagem) → **API Keys** (ou **Data API**). Copie:
   - **Project URL** — algo como `https://abcdefghijk.supabase.co`
   - **anon public** (ou **Publishable key**, começa com `sb_publishable_`)
   - ⚠️ **Nunca** use a chave `service_role` / `secret` no app.
2. No GitHub, neste repositório: **Settings → Secrets and variables → Actions → aba _Variables_ → New repository variable**:
   - Nome `VITE_SUPABASE_URL` → valor: a Project URL
   - Nome `VITE_SUPABASE_ANON_KEY` → valor: a chave anon/publishable

> Alternativa: se não cadastrar as variáveis, o app abre uma tela pedindo a URL e a chave, e guarda no navegador.

### 5. Publicar no GitHub Pages

1. No GitHub: **Settings → Pages → Build and deployment → Source: _GitHub Actions_**.
2. Vá em **Actions → “Publicar no GitHub Pages” → Run workflow** (ou faça qualquer alteração no repositório). Espere ficar verde (~1 min).
3. O endereço do app aparece no resumo da execução — normalmente **https://pauloceq.github.io/cafeequeijo/**.
4. Volte ao Supabase: **Authentication → URL Configuration → Site URL** = esse endereço (para os e-mails de redefinição de senha).

> O GitHub Pages gratuito exige repositório **público**: o *código* fica visível, mas os *dados* ficam no Supabase, protegidos por login e regras de acesso. **Nunca suba suas planilhas para o repositório.**

### 6. Primeiro uso

Entre no app com o usuário do passo 3 e siga **Ajuda → Primeiros passos**:
**Importação inicial** (sua planilha antiga) → **Configurações → Tarifas** → **Precificação** → **Importar vendas**.

---

## (Opcional) Conexão direta com o Mercado Livre

Com a conexão, as vendas das 2 contas do ML entram sozinhas (notificações + sincronização a cada 15 min),
cancelamentos devolvem o estoque, taxas/frete/envio são puxados, e você edita quantidade e preço dos anúncios pelo app.
Os tokens ficam **só no servidor** (Supabase Edge Functions), nunca no navegador.

1. **Token do Supabase**: no Supabase, clique no seu avatar → **Account preferences → Access Tokens → Generate new token**. Copie.
2. **Segredos no GitHub**: **Settings → Secrets and variables → Actions → aba _Secrets_ → New repository secret**:
   - `SUPABASE_ACCESS_TOKEN` → o token do item 1
   - `SUPABASE_PROJECT_REF` → o código do projeto (o `abcdefghijk` de `https://abcdefghijk.supabase.co`)
3. **Actions → “Publicar funções do Supabase” → Run workflow**. Espere ficar verde.
4. No app, abra **Conexão Mercado Livre** e siga os passos da tela:
   - **Criar o app no Mercado Livre** em https://developers.mercadolivre.com.br/devcenter → *Criar aplicação*:
     - **URI de redirect**: copie da tela do app (é `https://SEU-PROJETO.supabase.co/functions/v1/oauth-callback`)
     - **Escopos**: leitura, escrita e **offline_access**
     - **Tópicos**: **Orders (orders_v2)** e **Items**
     - **URL de notificações**: copie da tela (é `https://SEU-PROJETO.supabase.co/functions/v1/ml-webhook`)
   - **Cole o Client ID e o Client Secret** na tela do app → *Salvar credenciais* (ficam guardados só no servidor).
   - **Conectar** Mercado Livre 1. Para o Mercado Livre 2, **saia do ML no navegador** (ou use janela anônima), entre com a outra conta e clique em Conectar.
   - **Sincronização automática**: clique em *Gerar comando*, copie e cole no **SQL Editor** do Supabase → Run.

O histórico de sincronizações e erros aparece na mesma tela.

**Shopee e Amazon** funcionam por planilha. A estrutura de “conectores” já está pronta
(`supabase/functions/_shared/conectores/`) para ligar essas contas no futuro por um integrador como o **Bling**.

---

## Bom saber

- **Plano gratuito do Supabase**: projetos sem nenhum acesso por 7 dias são pausados. Se acontecer, entre no painel do Supabase e clique em **Restore**. Usar o app regularmente evita isso.
- **Backup**: no Supabase, *Database → Backups* (o plano gratuito guarda backups diários por pouco tempo). Exporte relatórios em .csv quando quiser guardar.
- **Ajudante**: vê produtos, estoque e vendas, lança vendas, importa planilhas, faz ajustes de estoque e vincula anúncios. Não vê financeiro, precificação, compras, relatórios e conexões.

## Para desenvolvedores

```bash
npm install
cp .env.example .env.local   # preencha URL e chave
npm run dev
```

- `src/` — app React (telas em `src/pages`, regras de cálculo em `src/lib`).
- `supabase/schema.sql` — tabelas, regras de acesso (RLS) e funções transacionais (vendas, compras, ajustes).
- `supabase/functions/` — Edge Functions (OAuth, webhook e sincronização do Mercado Livre).
- `.github/workflows/` — publicação do site e das funções.
