import { Link, useParams } from 'react-router-dom'
import { Abas, Aviso, Cartao, Pagina, Passos } from '../components/ui'
import { useNavigate } from 'react-router-dom'
import { PassosSite } from './ExportarPlanilhas'

const TOPICOS = [
  ['comecar', 'Primeiros passos'], ['planilhas', 'Planilhas dos marketplaces'], ['rotina', 'Rotina do dia a dia'],
  ['custos', 'Como o app calcula'], ['mercadolivre', 'Conexão com o Mercado Livre'], ['problemas', 'Problemas comuns'],
]

export default function Ajuda() {
  const { topico = 'comecar' } = useParams()
  const nav = useNavigate()
  return (
    <Pagina titulo="Ajuda e passo a passo">
      <Abas abas={TOPICOS} ativa={topico} onTrocar={(t) => nav(`/ajuda/${t}`)} />
      {topico === 'comecar' && <Comecar />}
      {topico === 'planilhas' && <Planilhas />}
      {topico === 'rotina' && <Rotina />}
      {topico === 'custos' && <Custos />}
      {topico === 'mercadolivre' && <MercadoLivre />}
      {topico === 'problemas' && <Problemas />}
    </Pagina>
  )
}

function Comecar() {
  return (
    <>
      <Cartao titulo="Ordem recomendada para começar">
        <Passos>
          <li><b>Importação inicial</b> (menu Gestão): envie sua planilha antiga. O app cria produtos, kits, custos, preços, estoque e o histórico. Revise os itens marcados.</li>
          <li><b>Configurações → Tarifas por conta</b>: confira comissões e faixas de frete de cada conta.</li>
          <li><b>Configurações → Custos e parâmetros</b>: embalagem, custos indiretos, ADS, imposto e margem-alvo.</li>
          <li><b>Precificação</b>: veja preço mínimo e sugerido de cada produto em cada conta.</li>
          <li><b>Importar vendas</b>: baixe o relatório de vendas de cada conta e importe. Na primeira vez você liga cada anúncio a um SKU.</li>
          <li>(Opcional) <b>Conexão Mercado Livre</b>: as vendas das 2 contas passam a entrar sozinhas.</li>
          <li>Crie o login do seu ajudante (Configurações → Usuários explica como).</li>
        </Passos>
      </Cartao>
      <Cartao titulo="Conceitos importantes">
        <ul className="lista">
          <li><b>Peça</b>: item físico que você conta na prateleira (ex.: 1 cápsula, 1 colher). Só peças têm estoque.</li>
          <li><b>Kit</b>: o que você anuncia montado (ex.: “3 Cápsulas C/ Colher” = 3 cápsulas + 1 colher + 1 escovinha). Vender um kit baixa as peças. O custo e a disponibilidade do kit são calculados pelas peças.</li>
          <li><b>Estoque real</b>: o que existe de verdade, por local (Principal, Estoque Escola…). É a fonte da verdade.</li>
          <li><b>Estoque fictício</b>: o número que você mostra no anúncio de cada conta. Só para controle — nunca gera alerta.</li>
          <li><b>Custo médio</b>: atualizado sozinho quando você marca um pedido de compra como recebido, já com frete, imposto de importação, ICMS e IOF rateados.</li>
        </ul>
      </Cartao>
    </>
  )
}

function Planilhas() {
  return (
    <>
      <Aviso tipo="info">Os sites mudam os nomes dos menus de vez em quando. Se não achar exatamente o botão descrito, procure algo parecido (“Relatórios”, “Exportar”, “Baixar”). O app reconhece a planilha mesmo se as colunas mudarem um pouco — e deixa você escolher as colunas na mão.</Aviso>
      <div className="grade-2">
        <Cartao titulo="Mercado Livre — baixar vendas">
          <Passos>
            <li>Entre no Mercado Livre com a conta (1 ou 2) e vá em <b>Vendas</b>.</li>
            <li>Escolha o período no filtro de datas.</li>
            <li>Clique em <b>Baixar relatório</b> / <b>Exportar</b> → <b>Excel</b> (.xlsx).</li>
            <li>No app: <Link to="/importar-vendas">Importar vendas</Link> → escolha o arquivo → escolha a conta (ML 1 ou ML 2).</li>
          </Passos>
          <p className="dica">O relatório traz tarifas e frete de cada venda: o lucro fica exato.</p>
        </Cartao>
        <Cartao titulo="Shopee — baixar vendas">
          <Passos>
            <li>Central do Vendedor → <b>Meus Pedidos</b>.</li>
            <li>Clique em <b>Exportar</b>, escolha o período e gere o relatório. Quando ficar pronto, clique em <b>Baixar</b> (arquivo “Order.all…xlsx”).</li>
            <li>No app: <Link to="/importar-vendas">Importar vendas</Link> → escolha o arquivo.</li>
          </Passos>
        </Cartao>
        <Cartao titulo="Amazon — baixar vendas">
          <Passos>
            <li>Seller Central → <b>Relatórios</b> → <b>Relatórios de atendimento</b> (ou “Pedidos”) → <b>Todos os pedidos</b>.</li>
            <li>Escolha o período e clique em <b>Solicitar download</b>. Baixe o arquivo .txt quando ficar pronto.</li>
            <li>No app: <Link to="/importar-vendas">Importar vendas</Link> → escolha o arquivo → escolha Amazon 1 ou 2.</li>
          </Passos>
          <p className="dica">Esse relatório não traz as tarifas: o app usa a tabela de tarifas da conta. Para a conciliação, use o relatório de pagamentos (Financeiro → Conciliação).</p>
        </Cartao>
        <Cartao titulo="Liberações / pagamentos (conciliação)">
          <ul className="lista">
            <li><b>Mercado Livre</b>: Mercado Pago → Relatórios → <b>Liberações</b> (ou “Relatório de liberações”) → baixar .csv/.xlsx.</li>
            <li><b>Shopee</b>: Minhas finanças → <b>Minha renda</b> → Exportar.</li>
            <li><b>Amazon</b>: Relatórios → Pagamentos → <b>Visualização da transação</b> → baixar.</li>
            <li>No app: <Link to="/financeiro">Financeiro</Link> → Conciliação → escolha a conta → envie o arquivo.</li>
          </ul>
        </Cartao>
      </div>
      <h3>Subir estoque e preço em massa</h3>
      <div className="grade-2">
        <Cartao titulo="Mercado Livre"><PassosSite marketplace="mercadolivre" /></Cartao>
        <Cartao titulo="Shopee"><PassosSite marketplace="shopee" /></Cartao>
        <Cartao titulo="Amazon"><PassosSite marketplace="amazon" /></Cartao>
      </div>
    </>
  )
}

function Rotina() {
  return (
    <Cartao titulo="Rotina sugerida">
      <h3>Todo dia</h3>
      <ul className="lista">
        <li>Abrir o <Link to="/">Painel</Link>: vendas do dia, peças abaixo do mínimo, compras a caminho, alertas de prejuízo.</li>
        <li>Importar as vendas do dia de cada conta (ou deixar o Mercado Livre conectado fazer isso sozinho).</li>
        <li>Perdas, quebras e brindes: <Link to="/estoque">Estoque</Link> → Ajustar.</li>
      </ul>
      <h3>Toda semana</h3>
      <ul className="lista">
        <li><Link to="/reposicao">Reposição</Link>: ver o que comprar e gerar os pedidos de compra.</li>
        <li><Link to="/exportar">Exportar planilhas</Link>: atualizar estoque/preço nos sites.</li>
        <li>Importar pedidos do AliExpress e marcar como recebido o que chegou.</li>
        <li><Link to="/financeiro">Financeiro</Link>: fluxo de caixa e contas a pagar.</li>
      </ul>
      <h3>Todo mês</h3>
      <ul className="lista">
        <li>Conciliação com os relatórios de liberação de cada marketplace.</li>
        <li><Link to="/relatorios">Relatórios</Link>: lucro por conta e produto, curva ABC, produtos parados, devoluções.</li>
        <li>Inventário: contar as peças e lançar em Estoque → Ajustar → “Inventário: informar contagem”.</li>
      </ul>
    </Cartao>
  )
}

function Custos() {
  return (
    <Cartao titulo="Como o app calcula">
      <h3>Lucro de uma venda</h3>
      <p><code>Lucro = preço − comissão − tarifa fixa − frete/faixa − ADS − imposto − embalagem − custos indiretos − custo do produto</code></p>
      <h3>Preço para uma margem desejada</h3>
      <p><code>Preço = (custo + embalagem + indiretos + tarifa fixa + faixa) ÷ (1 − %comissão − %ADS − %imposto − %margem)</code></p>
      <p>Como no Mercado Livre o custo da faixa muda com o preço (abaixo de R$ 79,90 tarifa fixa de R$ 6,75; acima, frete por faixa), o app testa cada faixa e escolhe o menor preço que atinge a margem. Preço <b>mínimo</b> = margem zero.</p>
      <h3>Custo de compra (landed cost)</h3>
      <p>Ao receber um pedido: <code>custo da peça = preço + (frete + imposto de importação + ICMS + IOF + outras) × (valor da peça ÷ valor total do pedido)</code>.</p>
      <p>Custo médio ponderado: <code>(estoque atual × custo atual + quantidade recebida × custo novo) ÷ (estoque atual + quantidade recebida)</code>.</p>
      <h3>Reposição</h3>
      <p><code>Ponto de pedido = vendas por dia × (prazo do fornecedor + dias de segurança)</code>. Cobertura = estoque ÷ vendas por dia. A sugestão de compra cobre o prazo + segurança + os dias de cobertura desejados, descontando o que já está a caminho.</p>
      <h3>Lucro real × planejado</h3>
      <p>Planejado usa a tabela de tarifas vigente na data da venda; real usa o que o marketplace cobrou (planilha ou API).</p>
    </Cartao>
  )
}

function MercadoLivre() {
  return (
    <Cartao titulo="Conexão direta com o Mercado Livre (opcional)">
      <p>Tudo é feito pela tela <Link to="/conexoes">Conexão Mercado Livre</Link>, que mostra cada passo, os endereços para copiar e o estado de cada conta. Resumo:</p>
      <Passos>
        <li><b>Publicar as funções</b>: no GitHub, cadastre os segredos <code>SUPABASE_ACCESS_TOKEN</code> e <code>SUPABASE_PROJECT_REF</code> e rode a ação “Publicar funções do Supabase” (detalhes no README).</li>
        <li><b>Criar o app no Mercado Livre</b> (developers.mercadolivre.com.br) com o endereço de retorno e o de notificações que a tela mostra.</li>
        <li><b>Colar Client ID e Client Secret</b> na tela.</li>
        <li><b>Conectar</b> ML 1 e ML 2 (para a segunda, saia do Mercado Livre antes ou use janela anônima).</li>
        <li><b>Sincronização automática</b>: clique em “Gerar comando” e cole no SQL Editor do Supabase.</li>
      </Passos>
      <p>Depois disso: vendas entram sozinhas (e baixam o estoque), cancelamentos devolvem o estoque, taxas e frete reais são puxados, e em <Link to="/anuncios">Anúncios</Link> você vincula cada anúncio/variação a um SKU e altera quantidade e preço direto no Mercado Livre.</p>
      <Aviso tipo="info">Shopee e Amazon continuam por planilha. A estrutura já está pronta para ligar essas contas por um integrador (ex.: Bling) no futuro.</Aviso>
    </Cartao>
  )
}

function Problemas() {
  const itens = [
    ['“O banco de dados ainda não foi preparado”', 'No Supabase: SQL Editor → New query → cole o arquivo supabase/schema.sql inteiro → Run. Pode rodar de novo sempre que o app for atualizado.'],
    ['“E-mail ou senha incorretos” / não consigo entrar', 'No Supabase: Authentication → Users. Confira o e-mail; em “…” você pode enviar redefinição de senha. Ao criar usuário, marque “Auto Confirm User”.'],
    ['A planilha não foi reconhecida', 'Confira se é o arquivo original do site (.xlsx, .csv ou .txt). Arquivos .xls antigos: abra no Excel e salve como .xlsx. Você também pode escolher o formato e as colunas na mão.'],
    ['Venda importada não baixou o estoque', 'O anúncio precisa estar vinculado a um SKU (tela Anúncios). Kits precisam ter a lista de peças (tela Produtos).'],
    ['Kit aparece com disponibilidade 0', 'Alguma peça da lista está zerada (ex.: colheres ou escovinhas). Veja Estoque.'],
    ['O botão do AliExpress não encontrou pedidos', 'Role a página até carregar todos os pedidos e clique de novo. Se o site mudou, use “colar texto” (Ctrl+A, Ctrl+C na página).'],
    ['“As funções do servidor ainda não foram publicadas”', 'Só é necessário para a conexão com o Mercado Livre. Veja o passo 1 da tela Conexão Mercado Livre.'],
    ['Token expirado / “reconectar”', 'Na tela Conexão Mercado Livre, clique em Reconectar na conta. Se repetir, confira se o app do ML tem o escopo offline_access.'],
  ]
  return (
    <Cartao titulo="Problemas comuns">
      {itens.map(([p, r]) => <details key={p}><summary><b>{p}</b></summary><p>{r}</p></details>)}
    </Cartao>
  )
}
