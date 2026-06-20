import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, CheckCircle2, Eye, Flame, MonitorDot, TerminalSquare, XCircle } from 'lucide-react'

function clock(value) {
  return new Date(value || Date.now()).toLocaleTimeString('en-US', { hour12: false })
}

function formatScore(value, digits = 4) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(digits) : '--'
}

function eventLines(event) {
  const data = event.data || {}
  const stamp = clock(event.ts)

  if (event.type === 'error') {
    return [{ stamp, tone: 'text-red-300', label: 'error', text: data.message || 'Unexpected optimization error' }]
  }

  if (event.type === 'gaze') {
    const top = data.gaze_regions?.[0]
    return [{
      stamp,
      tone: 'text-amber-300',
      label: 'gaze',
      text: `Mapped ${data.gaze_regions?.length || 0} visual regions; top saliency ${formatScore(top?.saliency_score, 2)}`,
    }]
  }

  if (event.type === 'complete') {
    const improvement = Number(data.improvement_pct || 0)
    return [
      {
        stamp,
        tone: improvement >= 0 ? 'text-emerald-300' : 'text-red-300',
        label: 'done',
        text: `Finished ${improvement >= 0 ? '+' : ''}${formatScore(improvement, 2)}% after ${data.iterations ?? data.history?.length ?? 0} passes`,
      },
      {
        stamp,
        tone: 'text-violet-300',
        label: 'memory',
        text: `${data.discovered_patterns ?? data.memory_count ?? 0} learned patterns available`,
      },
    ]
  }

  if (event.type !== 'progress') return []

  const status = data.status || 'progress'
  const iteration = data.iteration_count != null ? `[${data.iteration_count}/${data.max_iterations}] ` : ''
  const score = data.score?.overall_score != null ? ` overall ${formatScore(data.score.overall_score)}` : ''
  const delta = data.score_delta != null ? ` delta ${Number(data.score_delta) >= 0 ? '+' : ''}${formatScore(data.score_delta)}` : ''

  const toneByStatus = {
    scraping: 'text-cyan-300',
    gaze_analysis: 'text-amber-300',
    scoring: 'text-blue-300',
    scoring_wait: 'text-yellow-300',
    baseline: 'text-violet-300',
    proposing: 'text-yellow-300',
    approval_needed: 'text-violet-200',
    iteration_complete: data.accepted ? 'text-emerald-300' : 'text-red-300',
    rendering: 'text-sky-300',
  }

  const labelByStatus = {
    scraping: 'browse',
    gaze_analysis: 'gaze',
    scoring: 'score',
    scoring_wait: 'wait',
    baseline: 'base',
    proposing: 'edit',
    approval_needed: 'pause',
    iteration_complete: data.accepted ? 'accept' : 'reject',
    rendering: 'render',
  }

  const textByStatus = {
    scraping: data.message || 'Rendering page and collecting visual evidence',
    gaze_analysis: 'Estimating visual scan path',
    scoring: data.message || 'Scoring page state',
    scoring_wait: data.message || 'Waiting for scoring response',
    baseline: `Baseline ready${score}`,
    proposing: `${iteration}${data.action_type || 'proposal'} using ${data.strategy || 'local scoring'}`,
    approval_needed: `Awaiting decision${delta}`,
    iteration_complete: `${iteration}${data.accepted ? 'Accepted' : 'Rejected'} reward ${formatScore(data.reward)}${score}`,
    rendering: 'Rendering accepted edits',
  }

  const lines = [{
    stamp,
    tone: toneByStatus[status] || 'text-slate-300',
    label: labelByStatus[status] || status,
    text: textByStatus[status] || data.message || status,
  }]

  if (status === 'iteration_complete' && data.agent_thought?.reasoning) {
    lines.push({
      stamp,
      tone: 'text-slate-500',
      label: 'why',
      text: data.agent_thought.reasoning.slice(0, 120),
    })
  }

  return lines
}

function deriveViewModel(events) {
  const lines = []
  let heatmap = ''
  let latestFrame = ''
  let fallbackFrame = ''
  let gazeRegions = []
  let scanpathIsBaked = false
  let latestThought = null
  let memoryCount = 0

  for (const event of events || []) {
    const data = event.data || {}
    lines.push(...eventLines(event))

    if (data.annotated_screenshot_base64) {
      const image = `data:image/png;base64,${data.annotated_screenshot_base64}`
      if (event.type === 'gaze') heatmap = image
      latestFrame = image
    }

    if (data.gaze_regions?.length) gazeRegions = data.gaze_regions
    if (data.scanpath_embedded) scanpathIsBaked = true
    if (data.agent_thought) latestThought = data.agent_thought
    if (data.memory_count != null) memoryCount = data.memory_count

    if (event.type === 'complete') {
      memoryCount = data.discovered_patterns ?? data.memory_count ?? memoryCount
      if (data.before_screenshot && data.job_id) fallbackFrame = `/job/${data.job_id}/before-screenshot`
    }
  }

  return { lines, heatmap, latestFrame, fallbackFrame, gazeRegions, scanpathIsBaked, latestThought, memoryCount }
}

function LogStream({ lines }) {
  const tail = useRef(null)
  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed">
      {lines.length === 0 ? (
        <div className="mt-8 text-center text-slate-700">Waiting for optimization telemetry...</div>
      ) : (
        lines.map((line, index) => (
          <div key={`${line.stamp}-${line.label}-${index}`} className="grid grid-cols-[64px_58px_1fr] gap-2 rounded px-1 py-0.5 hover:bg-slate-900/70">
            <span className="text-slate-600">{line.stamp}</span>
            <span className="uppercase tracking-wide text-slate-500">{line.label}</span>
            <span className={line.tone}>{line.text}</span>
          </div>
        ))
      )}
      <div ref={tail} />
    </div>
  )
}

function ScoreTrace({ chartData }) {
  if (!chartData?.length) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/50 text-xs text-slate-700">
        Score history appears after the first pass
      </div>
    )
  }

  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -26 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="2 3" />
          <XAxis dataKey="iteration" tick={{ fill: '#475569', fontSize: 9 }} />
          <YAxis domain={[0, 1]} tick={{ fill: '#475569', fontSize: 9 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            formatter={value => formatScore(value)}
          />
          <Area type="monotone" dataKey="overall" stroke="#8b5cf6" fill="#8b5cf633" strokeWidth={2} name="Overall" />
          <Area type="monotone" dataKey="attention" stroke="#f59e0b" fill="#f59e0b18" strokeWidth={1.2} name="Attention" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ScanPathOverlay({ regions, dimensions }) {
  if (!regions?.length) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {regions.length > 1 && (
        <polyline
          points={regions.map(region => `${region.peak_coords?.[0] || 0},${region.peak_coords?.[1] || 0}`).join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.78)"
          strokeWidth="2.5"
          strokeDasharray="10 7"
        />
      )}
      {regions.map(region => {
        const [x = 0, y = 0] = region.peak_coords || []
        return (
          <g key={region.rank}>
            <circle cx={x} cy={y} r="19" fill="rgba(124,58,237,0.84)" stroke="white" strokeWidth="2" />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="system-ui" fontSize="13" fontWeight="800">
              {region.rank}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function PerceptionTheater({
  events,
  chartData,
  status,
  currentIter,
  maxIterations,
  baselineScore,
  finalScore,
  url,
}) {
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [naturalSize, setNaturalSize] = useState({ w: 1280, h: 800 })
  const imageRef = useRef(null)

  const model = useMemo(() => deriveViewModel(events), [events])
  const imageSource = showHeatmap && model.heatmap ? model.heatmap : (model.latestFrame || model.fallbackFrame)
  const progress = maxIterations > 0 ? Math.round((currentIter / maxIterations) * 100) : 0
  const gain = baselineScore && finalScore
    ? ((finalScore.overall_score - baselineScore.overall_score) / Math.max(baselineScore.overall_score, 1e-6)) * 100
    : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
          <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/55 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <MonitorDot size={15} className="text-cyan-300" />
              Perception Canvas
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowHeatmap(value => !value)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                  showHeatmap
                    ? 'border-amber-300/30 bg-amber-500/15 text-amber-100'
                    : 'border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-200'
                }`}
              >
                <Flame size={12} />
                Heatmap
              </button>
              {model.latestThought?.step && (
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                  model.latestThought.step === 'accepted'
                    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                    : model.latestThought.step === 'rejected'
                    ? 'border-red-400/25 bg-red-500/10 text-red-300'
                    : 'border-violet-400/25 bg-violet-500/10 text-violet-300'
                }`}>
                  {model.latestThought.step === 'accepted' ? <CheckCircle2 size={12} /> : model.latestThought.step === 'rejected' ? <XCircle size={12} /> : <Activity size={12} />}
                  {model.latestThought.step}
                </span>
              )}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-auto bg-black">
            {imageSource ? (
              <div className="relative inline-block w-full">
                <img
                  ref={imageRef}
                  src={imageSource}
                  alt="Perception canvas"
                  className="block w-full"
                  onLoad={() => {
                    if (imageRef.current) {
                      setNaturalSize({ w: imageRef.current.naturalWidth, h: imageRef.current.naturalHeight })
                    }
                  }}
                />
                {!model.scanpathIsBaked && <ScanPathOverlay regions={model.gazeRegions} dimensions={naturalSize} />}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-600">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 text-cyan-300">
                  <Eye size={26} />
                </div>
                <span className="text-sm">{status === 'running' || status === 'starting' ? 'Rendering the first page frame...' : 'Start an optimization to view perception output'}</span>
              </div>
            )}
          </div>
        </main>

        <aside className="flex w-[390px] flex-shrink-0 flex-col bg-slate-950">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/55 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <TerminalSquare size={15} className="text-violet-300" />
              Optimization Stream
            </div>
            {url && <span className="max-w-[180px] truncate text-[10px] text-slate-600">{url}</span>}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <LogStream lines={model.lines} />

            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Score Trace</div>
              <ScoreTrace chartData={chartData} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900/75 px-3 py-2">
                <div className="text-[10px] text-slate-500">Experiences</div>
                <div className="font-mono text-lg font-bold text-violet-300">{model.memoryCount}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/75 px-3 py-2">
                <div className="text-[10px] text-slate-500">Gain</div>
                <div className={`font-mono text-lg font-bold ${gain == null ? 'text-slate-600' : gain >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {gain == null ? '--' : `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%`}
                </div>
              </div>
            </div>

            {model.latestThought?.reasoning && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/75 p-3 text-xs">
                <div className="mb-1 font-semibold text-slate-400">Latest Reasoning</div>
                <p className="leading-relaxed text-slate-300">{model.latestThought.reasoning.slice(0, 220)}</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="flex items-center gap-4 border-t border-slate-800 bg-slate-900/75 px-4 py-2">
        <span className="whitespace-nowrap text-xs text-slate-500">Iteration {currentIter} / {maxIterations}</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 text-right font-mono text-xs text-slate-500">{progress}%</span>
        {baselineScore && <span className="hidden text-xs text-slate-600 sm:block">Base <span className="font-mono text-violet-300">{formatScore(baselineScore.overall_score, 3)}</span></span>}
        {finalScore && <span className="hidden text-xs text-slate-600 sm:block">Now <span className="font-mono text-emerald-300">{formatScore(finalScore.overall_score, 3)}</span></span>}
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${status === 'running' ? 'text-cyan-300' : status === 'complete' ? 'text-emerald-300' : 'text-slate-500'}`}>
          {status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />}
          {status}
        </span>
      </footer>
    </div>
  )
}
