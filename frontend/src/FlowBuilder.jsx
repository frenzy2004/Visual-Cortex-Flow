import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Download,
  Eye,
  FileText,
  Flame,
  Image as ImageIcon,
  Layers3,
  Loader2,
  MousePointerClick,
  Plus,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react'

const BLOCKS = {
  headline: { label: 'Headline', Icon: Type, seed: 'Your compelling headline here' },
  cta: { label: 'CTA', Icon: MousePointerClick, seed: 'Get Started Free' },
  body: { label: 'Body', Icon: FileText, seed: 'Add body copy that explains the value proposition clearly.' },
  testimonial: { label: 'Quote', Icon: Quote, seed: '"This changed how our team works." - Customer' },
  image: { label: 'Image', Icon: ImageIcon, seed: '[Image placeholder]' },
}

const TYPE_TONE = {
  headline: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
  cta: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-200',
  body: 'border-slate-700 bg-slate-800/60 text-slate-300',
  testimonial: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
  image: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

function scoreTone(value = 0.5) {
  if (value >= 0.7) return 'bg-emerald-400'
  if (value >= 0.4) return 'bg-amber-400'
  return 'bg-red-400'
}

function assignRanks(blocks, regions) {
  if (!blocks.length || !regions?.length) return {}
  const ranks = {}
  regions.slice(0, blocks.length).forEach((region, index) => {
    ranks[blocks[index]?.id] = region.rank
  })
  return ranks
}

function BlockTypeButton({ type, active, onClick }) {
  const meta = BLOCKS[type]
  const Icon = meta.Icon
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
        active ? 'border-violet-400/35 bg-violet-500/15 text-violet-100' : 'border-slate-800 bg-slate-900 text-slate-500 hover:text-slate-200'
      }`}
    >
      <Icon size={14} />
      {meta.label}
    </button>
  )
}

function ScoreBadge({ totalScore, neuralActive, gazeActive }) {
  if (!totalScore) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/75 px-4 py-3 text-xs">
      <span className="text-slate-500">Cortex score</span>
      <span className="font-mono text-lg font-bold text-violet-300">{(totalScore.overall_score * 100).toFixed(1)}</span>
      <span className="font-mono text-cyan-300">L {(totalScore.language_roi * 100).toFixed(1)}</span>
      <span className="font-mono text-amber-300">A {(totalScore.attention_roi * 100).toFixed(1)}</span>
      <span className="font-mono text-emerald-300">V {(totalScore.visual_roi * 100).toFixed(1)}</span>
      {neuralActive && <span className="ml-auto rounded-full bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">Neural overlay on</span>}
      {gazeActive && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">Gaze overlay on</span>}
    </div>
  )
}

function GazeStrip({ screenshot, overlay, regions, live }) {
  const src = overlay ? `data:image/png;base64,${overlay}` : screenshot
  if (!src) return null

  return (
    <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/75 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
          <Eye size={14} className="text-amber-300" />
          Visual Saliency
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950/50 px-2 py-1 text-[10px] text-slate-500">
          {live ? 'remote signal' : 'local signal'} - {regions.length} regions
        </span>
      </div>
      <img src={src} alt="Visual saliency overlay" className="max-h-[420px] w-full rounded-lg border border-slate-800 object-contain bg-black" />
      <div className="mt-3 flex flex-wrap gap-2">
        {regions.map(region => (
          <span key={region.rank} className="rounded-lg bg-slate-950/70 px-2 py-1 text-[11px] text-slate-400">
            #{region.rank} saliency {(region.saliency_score * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </section>
  )
}

function WorkspaceEmpty() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/75 text-cyan-300">
          <Layers3 size={26} />
        </div>
        <p className="text-sm font-semibold text-slate-300">Start from a URL or compose blocks</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Parse a page to extract editable sections, or add content blocks from the rail.
        </p>
      </div>
    </div>
  )
}

function BlockCard({ block, selected, neuralActive, gazeRank, onSelect, onRemove, onMoveUp, onMoveDown, canUp, canDown }) {
  const meta = BLOCKS[block.type] || BLOCKS.body
  const Icon = meta.Icon
  const contribution = Number(block.neural_contribution ?? 0.5)

  return (
    <article
      onClick={() => onSelect(block.id)}
      className={`group rounded-xl border bg-slate-900/65 p-4 transition ${
        selected ? 'border-violet-400/60 shadow-[0_0_0_2px_rgba(139,92,246,0.16)]' : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${TYPE_TONE[block.type] || TYPE_TONE.body}`}>
          <Icon size={12} />
          {meta.label}
        </span>
        {neuralActive && (
          <span className="rounded bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-300">
            {(contribution * 100).toFixed(0)}
          </span>
        )}
        {gazeRank != null && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-1 text-[10px] font-semibold text-amber-200">
            <Eye size={11} /> #{gazeRank}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-slate-600">{block.word_count ?? wordCount(block.content)}w</span>
      </div>
      <p className={`line-clamp-3 leading-relaxed ${block.type === 'headline' ? 'text-base font-semibold text-white' : 'text-sm text-slate-300'}`}>
        {block.content}
      </p>
      <div className="mt-3 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
        <button onClick={event => { event.stopPropagation(); onMoveUp(block.id) }} disabled={!canUp} className="rounded border border-slate-800 p-1.5 text-slate-500 disabled:opacity-30 hover:text-slate-200">
          <ArrowUp size={14} />
        </button>
        <button onClick={event => { event.stopPropagation(); onMoveDown(block.id) }} disabled={!canDown} className="rounded border border-slate-800 p-1.5 text-slate-500 disabled:opacity-30 hover:text-slate-200">
          <ArrowDown size={14} />
        </button>
        <button onClick={event => { event.stopPropagation(); onRemove(block.id) }} className="ml-auto rounded border border-red-400/20 p-1.5 text-red-300/70 hover:text-red-200">
          <Trash2 size={14} />
        </button>
      </div>
      {neuralActive && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full ${scoreTone(contribution)}`} style={{ width: `${Math.round(contribution * 100)}%` }} />
        </div>
      )}
    </article>
  )
}

function SuggestionCard({ suggestion, onAccept, onDismiss }) {
  if (!suggestion) return null
  return (
    <section className="rounded-xl border border-violet-400/25 bg-violet-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-violet-200">
        <Sparkles size={14} />
        Suggested Revision
      </div>
      {suggestion.original && <p className="line-through text-xs leading-relaxed text-red-300/70">{suggestion.original.slice(0, 130)}</p>}
      {suggestion.replacement && <p className="mt-2 text-xs leading-relaxed text-emerald-200">{suggestion.replacement.slice(0, 260)}</p>}
      {suggestion.reasoning && <p className="mt-2 text-[11px] italic leading-relaxed text-slate-500">{suggestion.reasoning.slice(0, 180)}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={onAccept} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">
          <Check size={14} /> Accept
        </button>
        <button onClick={onDismiss} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">
          <X size={14} /> Dismiss
        </button>
      </div>
    </section>
  )
}

export default function FlowBuilder() {
  const [url, setUrl] = useState('')
  const [blocks, setBlocks] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState('body')
  const [status, setStatus] = useState('idle')
  const [busyOptimize, setBusyOptimize] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [totalScore, setTotalScore] = useState(null)
  const [error, setError] = useState(null)
  const [screenshot, setScreenshot] = useState(null)
  const [gazeActive, setGazeActive] = useState(false)
  const [gazeLoading, setGazeLoading] = useState(false)
  const [gazeRegions, setGazeRegions] = useState([])
  const [gazeOverlay, setGazeOverlay] = useState('')
  const [gazeLive, setGazeLive] = useState(false)
  const [neuralActive, setNeuralActive] = useState(false)

  const selectedBlock = blocks.find(block => block.id === selectedId) || null
  const gazeRanks = useMemo(() => assignRanks(blocks, gazeRegions), [blocks, gazeRegions])

  useEffect(() => {
    if (!selectedBlock) return
    setEditText(selectedBlock.content)
    setEditType(selectedBlock.type)
  }, [selectedBlock?.id])

  async function parsePage() {
    if (!url.trim()) return
    setStatus('parsing')
    setError(null)
    setSuggestion(null)
    setGazeActive(false)
    try {
      const response = await fetch('/parse-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setBlocks(data.components || [])
      setTotalScore(data.page_score || null)
      setSelectedId(null)
      setScreenshot(data.screenshot_base64 ? `data:image/png;base64,${data.screenshot_base64}` : null)
    } catch (err) {
      setError(err.message)
    } finally {
      setStatus('idle')
    }
  }

  async function scoreLayout() {
    if (!blocks.length) return
    setStatus('scoring')
    setError(null)
    try {
      const response = await fetch('/score-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: blocks, url }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const scores = Object.fromEntries((data.per_component || []).map(item => [item.id, item.neural_contribution]))
      setTotalScore(data.total_score || null)
      setBlocks(current => current.map(block => ({ ...block, neural_contribution: scores[block.id] ?? block.neural_contribution })))
      setNeuralActive(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setStatus('idle')
    }
  }

  async function runGaze() {
    if (!url.trim()) return
    setGazeLoading(true)
    setError(null)
    try {
      const response = await fetch('/gaze-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setGazeRegions(data.salient_regions || [])
      setGazeOverlay(data.heatmap_overlay_base64 || '')
      setGazeLive(Boolean(data.gaze_live))
      setGazeActive(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setGazeLoading(false)
    }
  }

  async function optimizeSelected() {
    if (!selectedBlock) return
    setBusyOptimize(true)
    setSuggestion(null)
    setError(null)
    try {
      const response = await fetch('/optimize-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block: selectedBlock, url, context: blocks }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setSuggestion(data.edit)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyOptimize(false)
    }
  }

  function addBlock(type) {
    const content = BLOCKS[type]?.seed || ''
    const block = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10),
      type,
      content,
      word_count: wordCount(content),
      neural_contribution: 0.5,
    }
    setBlocks(current => [...current, block])
    setSelectedId(block.id)
  }

  function updateSelected(content = editText, type = editType) {
    if (!selectedBlock) return
    setBlocks(current => current.map(block => block.id === selectedBlock.id
      ? { ...block, content, type, word_count: wordCount(content) }
      : block
    ))
  }

  function acceptSuggestion() {
    if (!suggestion || !selectedBlock) return
    const nextText = suggestion.replacement || editText
    setEditText(nextText)
    updateSelected(nextText, editType)
    setSuggestion(null)
  }

  function removeBlock(id) {
    setBlocks(current => current.filter(block => block.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function moveBlock(id, direction) {
    setBlocks(current => {
      const index = current.findIndex(block => block.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const copy = [...current]
      const [item] = copy.splice(index, 1)
      copy.splice(nextIndex, 0, item)
      return copy
    })
  }

  async function exportHTML() {
    setError(null)
    try {
      const response = await fetch('/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: blocks, url }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const html = await response.text()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      link.download = 'visual_cortex_flow_export.html'
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-slate-800 bg-slate-950/70 px-5 py-4">
        <input
          type="url"
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && parsePage()}
          placeholder="https://example.com"
          className="min-w-[320px] flex-1 rounded-lg border border-slate-700/80 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/10"
        />
        <button onClick={parsePage} disabled={!url.trim() || status === 'parsing'} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/15 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-35">
          {status === 'parsing' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Parse Page
        </button>
        <button onClick={scoreLayout} disabled={!blocks.length || status === 'scoring'} className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-35">
          {status === 'scoring' ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
          Score Layout
        </button>
        <button onClick={() => setNeuralActive(value => !value)} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition ${neuralActive ? 'border-violet-300/40 bg-violet-600 text-white' : 'border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'}`}>
          <Flame size={16} />
          Neural View
        </button>
        <button onClick={gazeActive ? () => setGazeActive(false) : runGaze} disabled={!url.trim() || gazeLoading} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition disabled:opacity-35 ${gazeActive ? 'border-amber-300/40 bg-amber-500/20 text-amber-100' : 'border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'}`}>
          {gazeLoading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
          {gazeActive ? 'Gaze On' : 'Gaze View'}
        </button>
        <button onClick={exportHTML} disabled={!blocks.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-35">
          <Download size={16} />
          Export HTML
        </button>
      </header>

      {error && (
        <div className="mx-5 mt-3 flex items-center justify-between rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-200/70 hover:text-red-100">dismiss</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[150px] flex-shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950/35 p-4">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Blocks
            <Plus size={12} />
          </div>
          <div className="space-y-2">
            {Object.entries(BLOCKS).map(([type, meta]) => {
              const Icon = meta.Icon
              return (
                <button key={type} onClick={() => addBlock(type)} className="group flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/65 px-3 py-3 text-left transition hover:border-slate-600 hover:bg-slate-800">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-300 transition group-hover:bg-cyan-500/15 group-hover:text-cyan-100">
                    <Icon size={16} />
                  </span>
                  <span className="text-xs font-semibold text-slate-300">{meta.label}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {blocks.length === 0 ? (
            <WorkspaceEmpty />
          ) : (
            <>
              <ScoreBadge totalScore={totalScore} neuralActive={neuralActive} gazeActive={gazeActive} />
              {gazeActive && <GazeStrip screenshot={screenshot} overlay={gazeOverlay} regions={gazeRegions} live={gazeLive} />}
              <div className="space-y-3">
                {blocks.map((block, index) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    selected={selectedId === block.id}
                    neuralActive={neuralActive}
                    gazeRank={gazeRanks[block.id]}
                    canUp={index > 0}
                    canDown={index < blocks.length - 1}
                    onSelect={setSelectedId}
                    onRemove={removeBlock}
                    onMoveUp={id => moveBlock(id, -1)}
                    onMoveDown={id => moveBlock(id, 1)}
                  />
                ))}
              </div>
            </>
          )}
        </main>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-950/45 p-5">
          {selectedBlock ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Block Inspector</h2>
                {gazeRanks[selectedBlock.id] != null && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-200">Gaze #{gazeRanks[selectedBlock.id]}</span>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {Object.keys(BLOCKS).map(type => (
                  <BlockTypeButton key={type} type={type} active={editType === type} onClick={() => setEditType(type)} />
                ))}
              </div>

              <textarea
                value={editText}
                onChange={event => setEditText(event.target.value)}
                rows={7}
                className="w-full resize-none rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400/80 focus:ring-2 focus:ring-violet-500/10"
              />

              {selectedBlock.neural_contribution !== undefined && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>Contribution</span>
                    <span className="font-mono">{(selectedBlock.neural_contribution * 100).toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${scoreTone(selectedBlock.neural_contribution)}`} style={{ width: `${Math.round(selectedBlock.neural_contribution * 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => updateSelected()} disabled={editText === selectedBlock.content && editType === selectedBlock.type} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-35">
                  <Check size={14} />
                  Apply
                </button>
                <button onClick={optimizeSelected} disabled={busyOptimize} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-violet-500 disabled:opacity-35">
                  {busyOptimize ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Optimize
                </button>
              </div>

              <SuggestionCard suggestion={suggestion} onAccept={acceptSuggestion} onDismiss={() => setSuggestion(null)} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-600">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70 text-slate-400">
                <FileText size={22} />
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Select a block to edit copy, change type, or request a focused optimization.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
