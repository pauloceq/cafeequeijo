import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemErro } from '../lib/erros'
import { lerNumero } from '../lib/formato'

export function Pagina({ titulo, subtitulo, acoes, children }) {
  return (
    <div className="pagina">
      <div className="pagina-topo">
        <div>
          <h1>{titulo}</h1>
          {subtitulo && <p className="sub">{subtitulo}</p>}
        </div>
        {acoes && <div className="acoes">{acoes}</div>}
      </div>
      {children}
    </div>
  )
}

export function Cartao({ titulo, acoes, children, className = '' }) {
  return (
    <section className={`cartao ${className}`}>
      {(titulo || acoes) && (
        <div className="cartao-topo">
          {titulo && <h2>{titulo}</h2>}
          {acoes && <div className="acoes">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Aviso({ tipo = 'info', children, onFechar }) {
  if (!children) return null
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onFechar && <button className="link" onClick={onFechar} aria-label="Fechar">✕</button>}
    </div>
  )
}

export function Carregando({ texto = 'Carregando…' }) {
  return <div className="carregando"><span className="spinner" /> {texto}</div>
}

export function Vazio({ children }) {
  return <div className="vazio">{children}</div>
}

export function Modal({ titulo, onFechar, children, largura = 640 }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar?.()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar?.()}>
      <div className="modal" style={{ maxWidth: largura }} role="dialog" aria-modal="true">
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="link" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-corpo">{children}</div>
      </div>
    </div>
  )
}

export function Campo({ rotulo, dica, children, largura }) {
  return (
    <label className="campo" style={largura ? { flex: `0 1 ${largura}` } : undefined}>
      <span className="rotulo">{rotulo}</span>
      {children}
      {dica && <small className="dica">{dica}</small>}
    </label>
  )
}

/** Campo numérico que aceita vírgula (12,50) e devolve número. */
export function Num({ value, onChange, placeholder, casas = 2, ...resto }) {
  const [texto, setTexto] = useState(fmt(value, casas))
  const foco = useRef(false)
  useEffect(() => { if (!foco.current) setTexto(fmt(value, casas)) }, [value, casas])
  return (
    <input
      inputMode="decimal"
      value={texto}
      placeholder={placeholder}
      onFocus={() => (foco.current = true)}
      onBlur={() => { foco.current = false; setTexto(fmt(value, casas)) }}
      onChange={(e) => {
        setTexto(e.target.value)
        onChange(e.target.value.trim() === '' ? null : lerNumero(e.target.value))
      }}
      {...resto}
    />
  )
}
function fmt(v, casas) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (isNaN(n)) return ''
  return casas === 0 ? String(n).replace('.', ',') : n.toFixed(casas).replace('.', ',')
}

export function Abas({ abas, ativa, onTrocar }) {
  return (
    <div className="abas" role="tablist">
      {abas.map(([id, nome]) => (
        <button key={id} role="tab" aria-selected={ativa === id} className={ativa === id ? 'ativa' : ''} onClick={() => onTrocar(id)}>
          {nome}
        </button>
      ))}
    </div>
  )
}

export function Selo({ tipo = 'neutro', children }) {
  return <span className={`selo selo-${tipo}`}>{children}</span>
}

export function Passos({ children }) {
  return <ol className="passos">{children}</ol>
}

/** Carrega dados de forma assíncrona com estado de erro/carregando. */
export function useDados(carregar, deps = []) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true })
  const recarregar = useCallback(async () => {
    setEstado((s) => ({ ...s, carregando: true, erro: null }))
    try {
      const dados = await carregar()
      setEstado({ dados, erro: null, carregando: false })
    } catch (e) {
      setEstado({ dados: null, erro: mensagemErro(e), carregando: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { recarregar() }, [recarregar])
  return { ...estado, recarregar }
}

/** Executa uma ação mostrando "salvando…" e erros em português. */
export function useAcao() {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState(null)
  const [msg, setMsg] = useState(null)
  const executar = useCallback(async (fn, sucesso) => {
    setOcupado(true); setErro(null); setMsg(null)
    try {
      const r = await fn()
      if (sucesso) setMsg(typeof sucesso === 'function' ? sucesso(r) : sucesso)
      return r
    } catch (e) {
      setErro(mensagemErro(e))
      return undefined
    } finally {
      setOcupado(false)
    }
  }, [])
  return { ocupado, erro, msg, setErro, setMsg, executar }
}

export function Mensagens({ acao }) {
  return (
    <>
      <Aviso tipo="erro" onFechar={() => acao.setErro(null)}>{acao.erro}</Aviso>
      <Aviso tipo="ok" onFechar={() => acao.setMsg(null)}>{acao.msg}</Aviso>
    </>
  )
}

export function Barra({ valor, max, cor }) {
  const p = max > 0 ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0
  return <div className="barra"><div style={{ width: `${p}%`, background: cor || 'var(--acento)' }} /></div>
}
