import { useState } from 'react'
import { supabase } from '../supabase'
import { Aviso, Campo, Carregando, Mensagens, Modal, Num, Pagina, useAcao, useDados, Vazio } from '../components/ui'
import { ok } from '../lib/erros'

export default function Fornecedores() {
  const { dados, erro, carregando, recarregar } = useDados(async () => ok(await supabase.from('fornecedores').select('*').order('nome')))
  const [ed, setEd] = useState(null)
  const acao = useAcao()
  const set = (k) => (v) => setEd((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))

  async function salvar() {
    await acao.executar(async () => {
      if (!ed.nome?.trim()) throw new Error('Informe o nome.')
      const campos = { nome: ed.nome.trim(), documento: ed.documento || null, contato: ed.contato || null, telefone: ed.telefone || null, email: ed.email || null, prazo_entrega_dias: ed.prazo_entrega_dias || 30, observacao: ed.observacao || null }
      if (ed.id) ok(await supabase.from('fornecedores').update(campos).eq('id', ed.id))
      else ok(await supabase.from('fornecedores').insert(campos))
      setEd(null); recarregar()
    })
  }

  return (
    <Pagina titulo="Fornecedores" acoes={<button className="botao primario" onClick={() => setEd({ prazo_entrega_dias: 30 })}>+ Novo fornecedor</button>}>
      {carregando && <Carregando />}
      <Aviso tipo="erro">{erro}</Aviso>
      {dados && (dados.length === 0 ? <Vazio>Nenhum fornecedor.</Vazio> : (
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Contato</th><th>Telefone / e-mail</th><th className="num">Prazo de entrega</th><th /></tr></thead>
          <tbody>{dados.map((f) => (
            <tr key={f.id}><td><b>{f.nome}</b>{f.tipo === 'aliexpress' && <div className="dica">usado na importação do AliExpress</div>}</td><td>{f.contato}</td><td>{[f.telefone, f.email].filter(Boolean).join(' · ')}</td><td className="num">{f.prazo_entrega_dias} dias</td>
              <td><button className="link" onClick={() => setEd(f)}>editar</button></td></tr>
          ))}</tbody>
        </table>
      ))}
      {ed && (
        <Modal titulo={ed.id ? ed.nome : 'Novo fornecedor'} onFechar={() => setEd(null)}>
          <div className="form">
            <Campo rotulo="Nome"><input value={ed.nome || ''} onChange={set('nome')} /></Campo>
            <div className="linha">
              <Campo rotulo="CNPJ/CPF"><input value={ed.documento || ''} onChange={set('documento')} /></Campo>
              <Campo rotulo="Prazo médio de entrega (dias)" dica="Usado no ponto de pedido"><Num casas={0} value={ed.prazo_entrega_dias} onChange={set('prazo_entrega_dias')} /></Campo>
            </div>
            <div className="linha">
              <Campo rotulo="Contato"><input value={ed.contato || ''} onChange={set('contato')} /></Campo>
              <Campo rotulo="Telefone"><input value={ed.telefone || ''} onChange={set('telefone')} /></Campo>
              <Campo rotulo="E-mail"><input value={ed.email || ''} onChange={set('email')} /></Campo>
            </div>
            <Campo rotulo="Observação"><textarea rows={2} value={ed.observacao || ''} onChange={set('observacao')} /></Campo>
            <Mensagens acao={acao} />
            <div className="acoes-form"><span style={{ flex: 1 }} /><button className="botao" onClick={() => setEd(null)}>Cancelar</button><button className="botao primario" onClick={salvar} disabled={acao.ocupado}>Salvar</button></div>
          </div>
        </Modal>
      )}
    </Pagina>
  )
}
