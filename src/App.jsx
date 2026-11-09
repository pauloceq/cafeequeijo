import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { configurado } from './supabase'
import { Aviso, Carregando } from './components/ui'
import { mensagemErro } from './lib/erros'
import Configurar from './pages/Configurar'
import Login from './pages/Login'
import Painel from './pages/Painel'
import Produtos from './pages/Produtos'
import Estoque from './pages/Estoque'
import Reposicao from './pages/Reposicao'
import Precificacao from './pages/Precificacao'
import Vendas from './pages/Vendas'
import ImportarVendas from './pages/ImportarVendas'
import ExportarPlanilhas from './pages/ExportarPlanilhas'
import Anuncios from './pages/Anuncios'
import Conexoes from './pages/Conexoes'
import Compras from './pages/Compras'
import ImportarAliExpress from './pages/ImportarAliExpress'
import Fornecedores from './pages/Fornecedores'
import AnaliseCompras from './pages/AnaliseCompras'
import Financeiro from './pages/Financeiro'
import Relatorios from './pages/Relatorios'
import Configuracoes from './pages/Configuracoes'
import ImportacaoInicial from './pages/ImportacaoInicial'
import Ajuda from './pages/Ajuda'

const MENU = [
  ['Início', [['/', 'Painel', '📊']]],
  ['Vendas', [['/vendas', 'Vendas', '🧾'], ['/importar-vendas', 'Importar vendas', '📥']]],
  ['Produtos', [
    ['/produtos', 'Produtos e kits', '📦'], ['/estoque', 'Estoque', '🏷️'],
    ['/precificacao', 'Precificação', '💲', true], ['/reposicao', 'Reposição', '🔁', true],
  ]],
  ['Marketplaces', [
    ['/anuncios', 'Anúncios', '🔗'], ['/exportar', 'Exportar planilhas', '📤'], ['/conexoes', 'Conexão Mercado Livre', '🔌', true],
  ]],
  ['Compras', [
    ['/compras', 'Pedidos de compra', '🛒', true], ['/analise-compras', 'Análise de compras', '📊', true], ['/aliexpress', 'Importar AliExpress', '🌏', true],
    ['/fornecedores', 'Fornecedores', '🏭', true],
  ]],
  ['Gestão', [
    ['/financeiro', 'Financeiro', '💰', true], ['/relatorios', 'Relatórios', '📈', true],
    ['/configuracoes', 'Configurações', '⚙️', true], ['/importacao-inicial', 'Importação inicial', '🗂️', true],
  ]],
  ['', [['/ajuda', 'Ajuda e passo a passo', '❓']]],
]

function Layout() {
  const { perfil, ehDono, sair, erroPerfil } = useAuth()
  const [menuAberto, setMenuAberto] = useState(false)
  const loc = useLocation()
  return (
    <div className="app">
      <header className="topo-movel">
        <button className="botao-menu" onClick={() => setMenuAberto(!menuAberto)} aria-label="Abrir menu">☰</button>
        <strong>☕ Café &amp; Queijo</strong>
      </header>
      <nav className={`menu ${menuAberto ? 'aberto' : ''}`} onClick={() => setMenuAberto(false)}>
        <div className="marca">☕ Café &amp; Queijo</div>
        {MENU.map(([grupo, itens]) => {
          const visiveis = itens.filter(([, , , soDono]) => !soDono || ehDono)
          if (!visiveis.length) return null
          return (
            <div key={grupo || 'x'} className="menu-grupo">
              {grupo && <div className="menu-titulo">{grupo}</div>}
              {visiveis.map(([para, nome, icone]) => (
                <NavLink key={para} to={para} end={para === '/'}>
                  <span aria-hidden>{icone}</span> {nome}
                </NavLink>
              ))}
            </div>
          )
        })}
        <div className="menu-rodape">
          <div>{perfil?.nome || perfil?.email}</div>
          <small>{ehDono ? 'Dono' : 'Ajudante'}</small>
          <button className="link" onClick={sair}>Sair</button>
        </div>
      </nav>
      <main className="conteudo" key={loc.pathname}>
        {erroPerfil && <Aviso tipo="erro">{mensagemErro(erroPerfil)}</Aviso>}
        <Routes>
          <Route path="/" element={<Painel />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/importar-vendas" element={<ImportarVendas />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/anuncios" element={<Anuncios />} />
          <Route path="/exportar" element={<ExportarPlanilhas />} />
          <Route path="/ajuda" element={<Ajuda />} />
          <Route path="/ajuda/:topico" element={<Ajuda />} />
          {ehDono && (
            <>
              <Route path="/precificacao" element={<Precificacao />} />
              <Route path="/reposicao" element={<Reposicao />} />
              <Route path="/conexoes" element={<Conexoes />} />
              <Route path="/compras" element={<Compras />} />
              <Route path="/analise-compras" element={<AnaliseCompras />} />
              <Route path="/aliexpress" element={<ImportarAliExpress />} />
              <Route path="/fornecedores" element={<Fornecedores />} />
              <Route path="/financeiro" element={<Financeiro />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/importacao-inicial" element={<ImportacaoInicial />} />
            </>
          )}
          <Route path="*" element={perfil ? <Navigate to="/" /> : <Carregando />} />
        </Routes>
      </main>
    </div>
  )
}

function Portao() {
  const { sessao } = useAuth()
  if (sessao === undefined) return <Carregando texto="Abrindo…" />
  if (!sessao) return <Login />
  return <Layout />
}

export default function App() {
  if (!configurado) return <Configurar />
  return (
    <AuthProvider>
      <Portao />
    </AuthProvider>
  )
}
