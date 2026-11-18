# Rotina semanal — atualizar o painel Café & Queijo

Roda toda segunda cedo. Objetivo: lançar no painel (https://pauloceq.github.io/cafeequeijo/) as **vendas** de todas
as lojas e as **compras** do AliExpress desde a última atualização, sem duplicar nada.

## Onde está cada login (no computador do Paulo)
| Conta no painel (id) | Onde está logada |
|---|---|
| Mercado Livre 1 (1) — user 33854473 | navegador do app Claude (built-in) |
| Amazon 1 (4) — "Paulo Junio Rodrigues Teixeira" | navegador do app Claude |
| Shopee 1 (3) — loja cafeequeijo | navegador do app Claude |
| AliExpress (fornecedor 1) | navegador do app Claude |
| Painel Café & Queijo (dono) | navegador do app Claude |
| Mercado Livre 2 (2) — user 186444958 | Chrome "Browser 1" (deviceId 2568f7ea-6d90-44de-9295-fcb60c561bfb) |
| Amazon 2 (5) — "Cafe e Queijo Utilidades Domésticas" | Chrome "Browser 1" |
| Shopee 2 (6) | Chrome "Browser 1" |

**Atenção (18/11):** os IDs dos Chromes mudam quando o Paulo reabre o navegador. Use `list_connected_browsers` e
confira em cada um qual conta está logada (só leitura da página de vendas). Em 18/11: "Browser 2" tinha ML 1, Shopee 1 e
AliExpress; o navegador do app tinha ML 1 e Amazon 1 (Shopee 1 e AliExpress deslogados lá); as contas 2 (ML 2, Amazon 2, Shopee 2) estavam
no Chrome de deviceId 2568f7ea (ele reconecta com outro nome, ex. "Browser 3"; confirme pela venda mais recente já lançada). Se uma conta estiver deslogada em todos, pule e avise no relatório — nunca tente logar.
Amazon: pedidos ainda não pagos entram com taxa estimada 13,5% e frete 6,75; na semana seguinte, corrigir com os valores reais
(PATCH em `vendas` por `codigo_externo`). SKU de kit novo (ex.: KITFILTRO0002) → criar produto tipo 'kit' com `kit_componentes`.

Downloads caem em `C:\Users\paulo\Downloads` (pasta conectável pelo bridge). O Chrome pode bloquear vários downloads
seguidos: prefira ler os dados direto da página (fetch + JS) e só baixar quando necessário.

## Período
Do dia seguinte à venda/compra mais recente já lançada em cada conta (consulte `vendas` por `conta_id`,
`order=data.desc&limit=1`, e `pedidos_compra` por `data_pedido`) até hoje. Na dúvida, últimos 21 dias — o
painel ignora duplicados (mesmo `codigo_externo` na mesma conta e mesmo `numero_externo` de compra).

## Como gravar no painel
Abrir uma aba **em segundo plano** do painel (o usuário pode estar usando outra) e, por JavaScript na página:
- URL/chave do Supabase: achar no bundle JS (`https://<ref>.supabase.co` e a chave pública `sb_publishable_…`/JWT anon);
  token do usuário em `localStorage['sb-…-auth-token'].access_token`.
- Vendas: `POST /rest/v1/rpc/registrar_venda` com `{p_venda:{conta_id, data (ISO -03:00), codigo_externo, taxa_marketplace,
  frete, origem:'importacao', itens:[{produto_id, quantidade, preco_unitario}]}}` — **sem** `historico:true` para vendas
  novas (assim baixam o estoque e usam o custo médio atual). Retorno `null` = já existia.
- Compras do AliExpress: `POST /rest/v1/rpc/criar_pedido_compra` com `{p:{fornecedor_id:1, numero_externo, data_pedido,
  status_externo, moeda:'BRL', total_original, observacao:'AliExpress — <loja>', itens:[{produto_id, quantidade,
  custo_unitario (preço do item rateado pelo total do pedido, com frete/impostos), descricao_externa, variacao_externa,
  preco_original}]}}`. Pedidos ainda a caminho: mandar `status:'enviado'` e `previsao_chegada` (≈ data + 20 dias) para aparecerem em "a caminho".
  Pedidos já entregues: depois chamar `rpc/receber_pedido_compra` para dar entrada no estoque
  (ver schema.sql). Ignorar itens que não são de café (compras pessoais) e pedidos cancelados.
- Ligar SKU/anúncio a produto: tabela `anuncios` (`conta_id`, `codigo`, `sku_marketplace`, `produto_id`). SKUs que são
  apelidos já estão lá. SKU desconhecido: NÃO inventar produto — registrar a venda só se der para identificar com
  segurança e listar o resto no relatório final.
- Rodar lotes grandes sem esperar o JavaScript (a ferramenta corta em ~45 s): disparar a função e consultar o progresso
  numa variável `window.__prog` em chamadas seguintes.

## Fonte de cada loja
- **Mercado Livre (1 e 2) — jeito mais rápido (usado em 14/11):** abrir `vendedores.mercadolivre.com.br/vendas/omni/lista?limit=50&offset=0&startPeriod=WITH_DATE_CLOSED_6M_OLD&sort=DATE_CLOSED_DESC`,
  ler da lista (innerText de `main`) id, data ("14 nov 09:11 hs"), "N unidade(s) / R$ x / SKU: X"; para cada venda nova
  buscar `/vendas/<id>/detalhe` (fetch na mesma origem) e ler "Preço do produto", "Tarifa de venda total", "Envios".
  SKU novo com o mesmo título de um produto já cadastrado: criar a linha em `anuncios` (apelido) antes de lançar.
- **Mercado Livre (alternativa, Excel):** `vendedores.mercadolivre.com.br/vendas/omni/lista?...&startPeriod=WITH_DATE_CLOSED_...`
  → "Baixar arquivo Excel de vendas" → aparece "Baixar" quando pronto. Planilha: cabeçalho na linha 6; linhas de
  "Pacote de N produtos" (SKU vazio) trazem tarifas/total do pacote e as N linhas seguintes (Total vazio) são os itens.
  Lançar só concluídas (sem "Cancelada", "Devolução", "reembolso para o comprador"; mediação "Te demos o dinheiro" conta).
  taxa = −"Tarifa de venda e impostos"; frete = −"Tarifas de envio" − "Receita por envio" (mín. 0); líquido = "Total (BRL)".
- **Amazon (1 e 2):** pedidos (data, SKU, qtd): `/orders-api/search?limit=100&offset=0&sort=order_date_desc&date-range=last-14&fulfillmentType=all&orderStatus=all`
  (Accept: application/json); taxas: `sellercentral.amazon.com.br/payments/api/events-view?limit=50&offset=<página a partir de 1>&accountType=ALL&
  fiqlFiltersString=(startTimestamp==<ms>);(endTimestamp==<ms>)&sortType=DESC` (JSON). Por pedido: "Pagamento do pedido"
  (PRODUCT_CHARGES, FEES_TOTAL, OTHER_TOTAL = frete cobrado), "Tarifas de serviço/Delivery by Amazon" (frete DBA),
  "Reembolso" (descartar o pedido). Produto pela descrição (Despressurizado→FILTRO0018, Filtro Pressurizado→FILTRO0028,
  Medidor Dosador→DMSCM0034, Distribuidor WDT→WDTDA0033, Porta Filtro→POF510023, Tamper c/ Mola→TAMPE0032,
  Cápsulas Reutilizáveis→CAPRDC0002). Pedidos ainda não pagos: `orders-v3/mfn/unshipped` (taxa estimada 13,5%).
  "Custo de Publicidade" (cobrado dia 2) = publicidade do mês anterior.
- **Shopee (1 e 2):** `GET /api/v3/order/request_order_report?SPC_CDS=<da página>&SPC_CDS_VER=2&list_type=all&start_date=
  YYYY-MM-DD&end_date=YYYY-MM-DD&language=br&screening_condition=order_creation_date&parcel_level_filter=0&entity_type=1`
  (máx. 1 mês) → `GET /api/v3/settings/download_report/?…&report_id=` (xlsx; dá para ler na página descompactando com
  DecompressionStream). Concluídos sem devolução; taxa = comissão líquida + serviço líquida + transação + cupom do vendedor.
- **AliExpress — regra do Paulo:** sempre olhar a FOTO do pedido e cruzar com título/variação antes de ligar a um produto
  (o título engana: ex. "cápsula… de plástico" da Belr era 1 cápsula inox + 1 tamper). Na dúvida, perguntar.
  Pacotes já cadastrados como kit de compra: "3pcs-t" → CAPT3 (3 cápsulas inox + tamper); "4pc -ti" → CAPTI4 (4 + tamper);
  Belr "Chocolate" → CAPT1 (1 cápsula + tamper); RECAFIMIL "As Picture" → CAPDC0022 (café + leite + tamper);
  porta-filtro Nebula/YUAN "with 1 2 4 basket" → POFKIT124 (POF510023 + cestas FILTRO0019/0018/0030).
  Custos: tamper Dolce Gusto (TAMPE0021) sempre R$ 25; porta-filtro POF510023 sempre R$ 50; o resto do pacote é dividido
  igualmente entre as outras peças; cápsula de leite (CAPDC0010) = cápsula de café (CAPDC0009).
- **AliExpress:** `www.aliexpress.com/p/order/index.html`, clicar "Ver mais pedidos" até passar do período; cada pedido:
  status, "Data:", "Número de referência", loja, itens (nome, variação, "R$x xN"), "Total:". Pedido sem itens na lista:
  abrir `p/order/detail.html?orderId=`.
- **Publicidade:** ML em `vendedores.mercadolivre.com.br/billing/detail/<AAAAMM05>` ("Tarifas por campanha de publicidade",
  fatura do mês M = anúncios de M−1) e `pa.mercadolivre.com.br/pa/api/admin-pads/ajax/campaigns/metrics?dateFrom&dateTo`.
  Atualizar `vendas.ads_pct` do mês/conta = gasto ÷ faturamento × 100.

## Depois de lançar
- Conferir contagens e totais por conta contra a fonte.
- Embalagem/etiqueta: R$ 0,50 por venda (já é o padrão em config_geral).
- Relatório final ao Paulo: vendas e compras novas por conta, faturamento e lucro da semana, alertas (SKU sem
  produto, produto sem custo, estoque abaixo do mínimo, login expirado). Se alguma loja estiver deslogada, dizer qual.
