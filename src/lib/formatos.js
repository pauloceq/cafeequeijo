// Formatos das planilhas de cada marketplace.
// "apelidos" = nomes de coluna aceitos (sem acento/maiúsculas). Os sites mudam os nomes de vez em
// quando: se uma coluna não for reconhecida, a tela deixa você escolher a coluna certa na mão.

export const CAMPOS_VENDA = {
  pedido: 'Nº do pedido',
  data: 'Data',
  anuncio: 'Código do anúncio',
  variacao: 'Variação',
  sku: 'SKU',
  titulo: 'Título / produto',
  quantidade: 'Quantidade',
  preco_unitario: 'Preço unitário',
  total_linha: 'Total do item (se não houver preço unitário)',
  taxa: 'Tarifas do marketplace',
  frete: 'Frete pago pelo vendedor',
  frete_receita: 'Frete pago pelo comprador (desconta do frete)',
  liquido: 'Valor líquido / a receber',
  status: 'Status',
  comprador: 'Comprador',
}

export const FORMATOS_VENDAS = {
  mercadolivre: {
    nome: 'Mercado Livre — relatório de vendas (Excel)',
    assinatura: ['n.º de venda', '# de anuncio', 'tarifa de venda e impostos', 'receita por produtos'],
    campos: {
      pedido: ['n.º de venda', 'nº de venda', 'n.o de venda', 'numero de venda', 'n. de venda'],
      data: ['data da venda'],
      anuncio: ['# de anuncio', 'numero do anuncio', 'codigo do anuncio'],
      variacao: ['variacao'],
      sku: ['sku'],
      titulo: ['titulo do anuncio'],
      quantidade: ['unidades'],
      preco_unitario: ['preco unitario de venda do anuncio'],
      total_linha: ['receita por produtos'],
      taxa: ['tarifa de venda e impostos'],
      frete: ['tarifas de envio'],
      frete_receita: ['receita por envio'],
      liquido: ['total (brl)', 'total'],
      status: ['estado', 'descricao do status'],
      comprador: ['comprador'],
    },
    taxasPorPedido: false,
  },
  shopee: {
    nome: 'Shopee — exportação de pedidos (Order.all)',
    assinatura: ['id do pedido', 'status do pedido', 'nome do produto', 'numero de referencia sku', 'preco acordado'],
    campos: {
      pedido: ['id do pedido'],
      data: ['data de criacao do pedido', 'hora do pagamento do pedido'],
      anuncio: [],
      variacao: ['nome da variacao'],
      sku: ['numero de referencia sku', 'nº de referencia do sku principal', 'sku'],
      titulo: ['nome do produto'],
      quantidade: ['quantidade'],
      preco_unitario: ['preco acordado'],
      total_linha: ['subtotal do produto'],
      taxa: ['taxa de comissao', 'taxa de servico', 'taxa de transacao'],
      frete: ['taxa de envio reversa'],
      frete_receita: [],
      liquido: [],
      status: ['status do pedido'],
      comprador: ['nome de usuario (comprador)'],
    },
    taxaSomaColunas: true,   // várias colunas de taxa somadas
    taxasPorPedido: true,    // as taxas vêm repetidas em cada linha do mesmo pedido
  },
  amazon: {
    nome: 'Amazon — relatório de pedidos (todos os pedidos, .txt)',
    assinatura: ['amazon-order-id', 'purchase-date', 'order-status', 'item-price', 'sku'],
    campos: {
      pedido: ['amazon-order-id', 'order-id', 'id do pedido'],
      data: ['purchase-date', 'data da compra'],
      anuncio: ['sku'],
      variacao: [],
      sku: ['sku'],
      titulo: ['product-name'],
      quantidade: ['quantity', 'quantity-purchased'],
      preco_unitario: [],
      total_linha: ['item-price'],
      taxa: [],
      frete: [],
      frete_receita: [],
      liquido: [],
      status: ['order-status', 'item-status'],
      comprador: ['buyer-name'],
    },
    taxasPorPedido: false,
  },
}

export const STATUS_IGNORAR = /cancel|devolv|reembols|refund|nao pago|não pago|unpaid|pending|pendente|aguardando pagamento/i

export function detectarFormato(cabecalho) {
  const cab = cabecalho.map((c) => String(c ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())
  let melhor = null
  for (const [mk, f] of Object.entries(FORMATOS_VENDAS)) {
    const pontos = f.assinatura.filter((a) => cab.some((c) => c === a || c.startsWith(a))).length
    if (pontos >= 2 && (!melhor || pontos > melhor.pontos)) melhor = { marketplace: mk, pontos }
  }
  return melhor?.marketplace || null
}

export const TODOS_APELIDOS = [...new Set(Object.values(FORMATOS_VENDAS).flatMap((f) => f.assinatura))]

// ---------------------------------------------------------------------------
// Planilhas de atualização em massa (estoque e preço)
// ---------------------------------------------------------------------------
export const FORMATOS_EXPORTACAO = {
  mercadolivre: {
    nome: 'Mercado Livre — planilha de edição em massa de anúncios',
    chave: ['codigo do anuncio', 'id do anuncio', 'numero do anuncio', '# de anuncio', 'item id', 'anuncio'],
    variacao: ['codigo da variacao', 'id da variacao', 'variacao id'],
    sku: ['sku', 'codigo sku', 'sku do vendedor'],
    quantidade: ['estoque', 'quantidade disponivel', 'quantidade', 'unidades disponiveis'],
    preco: ['preco', 'preco de venda', 'preco (brl)'],
  },
  shopee: {
    nome: 'Shopee — planilha de atualização em massa (preço e estoque)',
    chave: ['et_title_product_id', 'id do produto', 'product id'],
    variacao: ['et_title_variation_id', 'id da variacao', 'variation id'],
    sku: ['et_title_variation_sku', 'sku da variacao', 'sku de referencia', 'sku'],
    quantidade: ['et_title_variation_stock', 'estoque', 'stock'],
    preco: ['et_title_variation_price', 'preco', 'price'],
  },
  amazon: {
    nome: 'Amazon — modelo de preço e quantidade',
    chave: ['sku', 'seller-sku', 'sku do vendedor', 'contribution_sku'],
    variacao: [],
    sku: ['sku', 'seller-sku'],
    quantidade: ['quantity', 'quantidade', 'fulfillment_availability#1.quantity'],
    preco: ['price', 'preco', 'standard_price', 'purchasable_offer[marketplace_id=a2q3y263d00kwc]#1.our_price#1.schedule#1.value_with_tax'],
  },
}

export const MARKETPLACES = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' }
