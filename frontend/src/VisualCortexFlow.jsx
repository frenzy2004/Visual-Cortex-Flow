import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Check,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Layers3,
  Link2,
  Loader2,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import FlowBuilder from './FlowBuilder'
import PerceptionTheater from './PerceptionTheater'
import CortexRegions from './CortexRegions'
import SnapshotDialogue from './SnapshotDialogue'

const NAV_ITEMS = [
  { id: 'optimize', label: 'Optimize', key: 'O', Icon: Zap },
  { id: 'image', label: 'Screenshot Chat', key: 'S', Icon: ImageIcon },
  { id: 'build', label: 'Build', key: 'B', Icon: Layers3 },
  { id: 'patterns', label: 'Patterns', key: 'P', Icon: BrainCircuit },
]

const SOURCE_OPTIONS = [
  { id: 'url', label: 'URL', Icon: Link2 },
  { id: 'file', label: 'HTML File', Icon: FileText },
]

const INITIAL_RUN = {
  status: 'idle',
  current: 0,
  total: 10,
  baseline: null,
  final: null,
  accepted: [],
  feed: [],
  chart: [],
  optimizedHtml: '',
  error: '',
  completedAt: 0,
}

const PATTERN_PALETTE = {
  cognitive_load: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  social_proof: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  lexical: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  attention: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
}

export default function VisualCortexFlow() {
  const [activeTab, setActiveTab] = useState('optimize')
  const [optimizerPinned, setOptimizerPinned] = useState(true)
  const [sourceMode, setSourceMode] = useState('url')
  const [url, setUrl] = useState('')
  const [htmlFile, setHtmlFile] = useState(null)
  const [iterations, setIterations] = useState(10)
  const [intent, setIntent] = useState('engage')
  const [run, setRun] = useState(INITIAL_RUN)
  const [events, setEvents] = useState([])
  const [brainRegions, setBrainRegions] = useState(null)
  const [ethicsFlags, setEthicsFlags] = useState([])
  const [intentReward, setIntentReward] = useState(null)
  const [gaze, setGaze] = useState({ regions: [], overlay: '' })
  const [pendingApproval, setPendingApproval] = useState(null)
  const [currentJobId, setCurrentJobId] = useState('')
  const [previewJobId, setPreviewJobId] = useState('')
  const [backendInfo, setBackendInfo] = useState(null)
  const [uploadState, setUploadState] = useState('idle')
  const [dragging, setDragging] = useState(false)
  const streamRef = useRef(null)
  const feedRef = useRef(null)

  const running = run.status === 'starting' || run.status === 'running'
  const readyToRun = sourceMode === 'url' ? Boolean(url.trim()) : Boolean(htmlFile?.content)

  useEffect(() => {
    fetch('/health')
      .then(res => (res.ok ? res.json() : null))
      .then(data => data && setBackendInfo(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [run.feed])

  useEffect(() => () => streamRef.current?.close(), [])

  const appendFeed = useCallback(item => {
    setRun(prev => ({ ...prev, feed: [...prev.feed, { id: crypto.randomUUID(), at: Date.now(), ...item }] }))
  }, [])

  const resetRun = useCallback(nextTotal => {
    streamRef.current?.close()
    setRun({ ...INITIAL_RUN, total: nextTotal })
    setEvents([])
    setBrainRegions(null)
    setEthicsFlags([])
    setIntentReward(null)
    setGaze({ regions: [], overlay: '' })
    setPendingApproval(null)
    setCurrentJobId('')
    setPreviewJobId('')
  }, [])

  const consumeStreamPacket = useCallback((type, data = {}) => {
    setEvents(prev => [...prev, { type, data, ts: Date.now() }])

    if (type === 'progress') {
      const stage = data.status || 'progress'

      if (stage === 'baseline' && data.score) {
        const firstPoint = chartPoint(0, data.score)
        setRun(prev => ({
          ...prev,
          status: 'running',
          current: 0,
          total: data.max_iterations || prev.total,
          baseline: data.score,
          chart: [firstPoint],
          feed: [...prev.feed, feedItem('baseline', data.message || 'Baseline scored', { score: data.score })],
        }))
        return
      }

      if (stage === 'approval_needed') {
        setPendingApproval(data)
        appendFeed({
          kind: 'approval',
          title: cleanAction(data.action_type || 'Proposed edit'),
          text: data.target || data.message || 'Review the proposed change',
          delta: data.reward,
        })
        return
      }

      if (stage === 'iteration_complete') {
        setPendingApproval(null)
        setRun(prev => {
          const score = data.score || data.candidate_score || prev.final || prev.baseline
          const accepted = data.accepted ? [...prev.accepted, { ...data.edit, iteration: data.iteration_count, reward: data.reward }] : prev.accepted
          return {
            ...prev,
            status: 'running',
            current: data.iteration_count || prev.current,
            total: data.max_iterations || prev.total,
            final: score || prev.final,
            accepted,
            chart: score ? [...prev.chart, chartPoint(data.iteration_count || prev.chart.length, score)] : prev.chart,
            feed: [
              ...prev.feed,
              feedItem(
                data.accepted ? 'accepted' : 'rejected',
                data.accepted ? 'Accepted edit' : 'Rejected edit',
                { action: cleanAction(data.action_type || data.edit?.action_type), delta: data.reward },
              ),
            ],
          }
        })
        return
      }

      if (stage === 'decision_received') {
        appendFeed({ kind: data.accept ? 'accepted' : 'rejected', title: data.accept ? 'Decision accepted' : 'Decision rejected', text: `Iteration ${data.iteration}` })
        return
      }

      if (stage === 'decision_timeout') {
        appendFeed({ kind: 'status', title: 'Decision timeout', text: data.message })
        return
      }

      appendFeed({ kind: 'status', title: cleanStage(stage), text: data.message || cleanStage(stage) })
      setRun(prev => ({ ...prev, status: 'running', current: data.iteration_count ?? prev.current, total: data.max_iterations || prev.total }))
    }

    if (type === 'brain_regions') {
      setBrainRegions(data.regions || null)
      setEthicsFlags(data.ethics_flags || [])
      if (data.intent_reward != null) setIntentReward(data.intent_reward)
    }

    if (type === 'gaze') {
      setGaze({
        regions: data.gaze_regions || data.salient_regions || [],
        overlay: data.annotated_screenshot_base64 || data.heatmap_overlay_base64 || '',
      })
    }

    if (type === 'complete') {
      streamRef.current?.close()
      setPendingApproval(null)
      setCurrentJobId('')
      setPreviewJobId(data.job_id || previewJobId)
      setBrainRegions(data.final_brain_regions || brainRegions)
      setEthicsFlags(data.ethics_flags || ethicsFlags)
      setRun(prev => ({
        ...prev,
        status: 'complete',
        current: prev.total,
        final: data.final_score || prev.final || prev.baseline,
        accepted: data.accepted_edits || prev.accepted,
        optimizedHtml: data.optimized_html || prev.optimizedHtml,
        completedAt: Date.now(),
        feed: [...prev.feed, feedItem('complete', 'Run complete', { text: `${(data.accepted_edits || prev.accepted || []).length} accepted edits` })],
      }))
    }

    if (type === 'error') {
      streamRef.current?.close()
      setPendingApproval(null)
      setCurrentJobId('')
      setRun(prev => ({ ...prev, status: 'error', error: data.message || 'Optimization failed' }))
      appendFeed({ kind: 'error', title: 'Run failed', text: data.message || 'Unknown backend error' })
    }
  }, [appendFeed, brainRegions, ethicsFlags, previewJobId])

  const connectStream = useCallback(jobId => {
    streamRef.current?.close()
    const stream = new EventSource(`/job/${jobId}/stream`)
    stream.onmessage = event => {
      try {
        const packet = JSON.parse(event.data)
        consumeStreamPacket(packet.type, packet.data)
      } catch {
        appendFeed({ kind: 'error', title: 'Stream parse failed', text: 'Could not read optimizer event' })
      }
    }
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) return
      appendFeed({ kind: 'status', title: 'Reconnecting', text: 'Waiting for optimizer stream' })
    }
    streamRef.current = stream
  }, [appendFeed, consumeStreamPacket])

  const uploadHtml = useCallback(async file => {
    if (!file) return
    setUploadState('uploading')
    setRun(prev => ({ ...prev, error: '' }))
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await postForm('/upload-html', form)
      setHtmlFile({
        name: data.filename || file.name,
        content: data.html_content || '',
        screenshot: data.screenshot_base64 || '',
        score: data.page_score || null,
        overlay: data.heatmap_overlay_base64 || '',
        regions: data.salient_regions || [],
      })
      setGaze({ regions: data.salient_regions || [], overlay: data.heatmap_overlay_base64 || '' })
      setBrainRegions(data.page_score?.atlas_regions || null)
      setRun(prev => ({
        ...prev,
        baseline: data.page_score || prev.baseline,
        chart: data.page_score ? [chartPoint(0, data.page_score)] : prev.chart,
        feed: [...prev.feed, feedItem('status', 'HTML rendered', { text: data.filename || file.name })],
      }))
      setUploadState('ready')
    } catch (err) {
      setUploadState('error')
      setRun(prev => ({ ...prev, error: err.message || 'Upload failed' }))
    }
  }, [])

  const startRun = useCallback(async () => {
    const total = clampInt(iterations, 1, 20, 10)
    resetRun(total)
    setRun(prev => ({ ...prev, status: 'starting', total }))

    try {
      const payload = sourceMode === 'url'
        ? { url: url.trim(), max_iterations: total, intent }
        : { html_content: htmlFile?.content || '', filename: htmlFile?.name || 'upload.html', max_iterations: total }
      const endpoint = sourceMode === 'url' ? '/optimize' : '/optimize-html'
      const data = await postJson(endpoint, payload)
      setCurrentJobId(data.job_id)
      setPreviewJobId(data.job_id)
      setActiveTab('optimize')
      setOptimizerPinned(true)
      appendFeed({ kind: 'status', title: 'Run started', text: sourceMode === 'url' ? url.trim() : htmlFile?.name })
      connectStream(data.job_id)
    } catch (err) {
      setRun(prev => ({ ...prev, status: 'error', error: err.message || 'Could not start optimizer' }))
    }
  }, [appendFeed, connectStream, htmlFile, intent, iterations, resetRun, sourceMode, url])

  const decide = useCallback(async accept => {
    if (!currentJobId || !pendingApproval?.iteration_count) return
    try {
      await postJson(`/job/${currentJobId}/decision`, {
        iteration: pendingApproval.iteration_count,
        accept,
      })
      setPendingApproval(null)
    } catch (err) {
      setRun(prev => ({ ...prev, error: err.message || 'Could not submit decision' }))
    }
  }, [currentJobId, pendingApproval])

  const downloadHtml = useCallback(async () => {
    if (!previewJobId) return
    const response = await fetch(`/html-job/${previewJobId}/download`)
    if (!response.ok) {
      setRun(prev => ({ ...prev, error: `Download failed: ${response.status}` }))
      return
    }
    const blob = await response.blob()
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${(htmlFile?.name || 'page').replace(/\.html?$/i, '')}_visual_cortex_flow.html`
    link.click()
    URL.revokeObjectURL(href)
  }, [htmlFile, previewJobId])

  const shell = (
    <AppShell
      activeTab={activeTab}
      onTab={setActiveTab}
      optimizerPinned={optimizerPinned}
      onToggleOptimizer={() => setOptimizerPinned(value => !value)}
      backendInfo={backendInfo}
    >
      {activeTab === 'optimize' && (
        <OptimizeWorkspace
          sourceMode={sourceMode}
          setSourceMode={setSourceMode}
          url={url}
          setUrl={setUrl}
          iterations={iterations}
          setIterations={setIterations}
          intent={intent}
          setIntent={setIntent}
          run={run}
          running={running}
          readyToRun={readyToRun}
          onStart={startRun}
          htmlFile={htmlFile}
          uploadHtml={uploadHtml}
          uploadState={uploadState}
          dragging={dragging}
          setDragging={setDragging}
          feedRef={feedRef}
          pendingApproval={pendingApproval}
          onDecision={decide}
          previewJobId={previewJobId}
          sourceUrl={url}
          gaze={gaze}
          brainRegions={brainRegions}
          ethicsFlags={ethicsFlags}
          intentReward={intentReward}
          events={events}
          optimizerPinned={optimizerPinned}
          onDownloadHtml={downloadHtml}
        />
      )}

      {activeTab === 'image' && <SnapshotDialogue backendInfo={backendInfo} />}
      {activeTab === 'build' && <FlowBuilder />}
      {activeTab === 'patterns' && <PatternsBoard />}
    </AppShell>
  )

  if (activeTab === 'optimize' || !optimizerPinned) return shell

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppShell
        activeTab={activeTab}
        onTab={setActiveTab}
        optimizerPinned={optimizerPinned}
        onToggleOptimizer={() => setOptimizerPinned(value => !value)}
        backendInfo={backendInfo}
        nested
      >
        <div className="grid min-h-[calc(100vh-90px)] grid-cols-[minmax(0,1fr)_420px] gap-0">
          <div className="min-w-0 overflow-auto">
            {activeTab === 'image' && <SnapshotDialogue backendInfo={backendInfo} />}
            {activeTab === 'build' && <FlowBuilder />}
            {activeTab === 'patterns' && <PatternsBoard />}
          </div>
          <aside className="border-l border-slate-800 bg-slate-950/96 p-4">
            <PinnedOptimizer
              events={events}
              run={run}
              url={sourceMode === 'url' ? url : htmlFile?.name}
              brainRegions={brainRegions}
              ethicsFlags={ethicsFlags}
              intent={intent}
              intentReward={intentReward}
            />
          </aside>
        </div>
      </AppShell>
    </div>
  )
}

function AppShell({ children, activeTab, onTab, optimizerPinned, onToggleOptimizer, backendInfo, nested = false }) {
  return (
    <div className={nested ? '' : 'min-h-screen bg-slate-950 text-slate-100'}>
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="flex min-h-[88px] items-center gap-5 px-5">
          <div className="flex min-w-[330px] items-center gap-3">
            <CortexLogo />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Visual Cortex Flow</h1>
              <p className="text-xs text-slate-500">Attention-aware web optimization</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
            {NAV_ITEMS.map(item => (
              <NavButton key={item.id} item={item} active={activeTab === item.id} onClick={() => onTab(item.id)} />
            ))}
          </nav>

          <button
            onClick={onToggleOptimizer}
            className={`ml-1 inline-flex h-12 items-center gap-2 rounded-xl border px-5 text-sm font-bold transition ${
              optimizerPinned
                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100'
            }`}
          >
            <Eye size={18} />
            Optimizer View
          </button>

          <div className="ml-auto hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-4 py-2 text-xs text-slate-400 lg:flex">
            <span className={`h-2 w-2 rounded-full ${backendInfo?.status === 'ok' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>OpenAI</span>
            <span className="font-mono text-emerald-300">{backendInfo?.model || 'local'}</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

function OptimizeWorkspace(props) {
  const {
    sourceMode,
    setSourceMode,
    url,
    setUrl,
    iterations,
    setIterations,
    intent,
    setIntent,
    run,
    running,
    readyToRun,
    onStart,
    htmlFile,
    uploadHtml,
    uploadState,
    dragging,
    setDragging,
    feedRef,
    pendingApproval,
    onDecision,
    previewJobId,
    sourceUrl,
    gaze,
    brainRegions,
    ethicsFlags,
    intentReward,
    events,
    optimizerPinned,
    onDownloadHtml,
  } = props

  return (
    <div className="grid min-h-[calc(100vh-89px)] grid-cols-[minmax(420px,0.92fr)_minmax(520px,1.3fr)]">
      <section className="border-r border-slate-800 bg-slate-950 p-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
          <SourceSwitch value={sourceMode} onChange={setSourceMode} />

          {sourceMode === 'url' ? (
            <div className="mt-4 flex gap-3">
              <input
                value={url}
                onChange={event => setUrl(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && readyToRun && !running) onStart()
                }}
                placeholder="https://example.com"
                className="h-12 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400"
              />
            </div>
          ) : (
            <UploadWell
              file={htmlFile}
              uploadState={uploadState}
              dragging={dragging}
              setDragging={setDragging}
              onFile={uploadHtml}
            />
          )}

          <RunControls
            iterations={iterations}
            setIterations={setIterations}
            intent={intent}
            setIntent={setIntent}
            running={running}
            disabled={!readyToRun}
            onStart={onStart}
          />
        </div>

        <ActivityFeed refEl={feedRef} items={run.feed} status={run.status} error={run.error} />
      </section>

      <section className="relative min-w-0 overflow-hidden bg-slate-950">
        {pendingApproval && <ApprovalDock pending={pendingApproval} onDecision={onDecision} />}

        <div className="grid h-full grid-rows-[minmax(300px,0.9fr)_minmax(300px,1fr)]">
          <div className="border-b border-slate-800 p-5">
            {optimizerPinned ? (
              <PerceptionTheater
                events={events}
                chartData={run.chart}
                status={run.status}
                currentIter={run.current}
                maxIterations={run.total}
                baselineScore={run.baseline}
                finalScore={run.final}
                url={sourceMode === 'url' ? sourceUrl : htmlFile?.name}
              />
            ) : (
              <PreviewDeck
                jobId={previewJobId}
                run={run}
                htmlFile={htmlFile}
                sourceMode={sourceMode}
                onDownloadHtml={onDownloadHtml}
              />
            )}
          </div>

          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-h-0 overflow-auto p-5">
              <ScoreTrace run={run} />
              <PreviewDeck
                jobId={previewJobId}
                run={run}
                htmlFile={htmlFile}
                sourceMode={sourceMode}
                onDownloadHtml={onDownloadHtml}
              />
            </div>

            <aside className="min-h-0 overflow-auto border-l border-slate-800 p-5">
              <CortexRegions regions={brainRegions} ethicsFlags={ethicsFlags} intent={intent} intentReward={intentReward} />
              <SaliencyCard gaze={gaze} />
            </aside>
          </div>
        </div>
      </section>
    </div>
  )
}

function PinnedOptimizer({ events, run, url, brainRegions, ethicsFlags, intent, intentReward }) {
  return (
    <div className="space-y-4">
      <PerceptionTheater
        events={events}
        chartData={run.chart}
        status={run.status}
        currentIter={run.current}
        maxIterations={run.total}
        baselineScore={run.baseline}
        finalScore={run.final}
        url={url}
      />
      <CortexRegions regions={brainRegions} ethicsFlags={ethicsFlags} intent={intent} intentReward={intentReward} />
    </div>
  )
}

function SourceSwitch({ value, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
      {SOURCE_OPTIONS.map(item => {
        const Icon = item.Icon
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
              value === item.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Icon size={15} />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function UploadWell({ file, uploadState, dragging, setDragging, onFile }) {
  const inputRef = useRef(null)
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={event => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        onFile(event.dataTransfer?.files?.[0])
      }}
      className={`mt-4 cursor-pointer rounded-xl border border-dashed p-5 text-center transition ${
        dragging ? 'border-violet-400 bg-violet-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-500'
      }`}
    >
      <input ref={inputRef} hidden type="file" accept=".html,.htm,text/html" onChange={event => onFile(event.target.files?.[0])} />
      <UploadCloud className="mx-auto mb-3 text-violet-300" size={28} />
      <p className="text-sm font-semibold text-slate-200">{file?.name || 'Drop an HTML file or click to choose'}</p>
      <p className="mt-1 text-xs text-slate-500">
        {uploadState === 'uploading' ? 'Rendering HTML...' : uploadState === 'ready' ? 'Rendered and ready to optimize' : 'The page is rendered locally before scoring'}
      </p>
    </div>
  )
}

function RunControls({ iterations, setIterations, intent, setIntent, running, disabled, onStart }) {
  return (
    <div className="mt-4 grid grid-cols-[92px_150px_minmax(0,1fr)] gap-3">
      <label className="text-xs text-slate-500">
        Iterations
        <input
          type="number"
          min="1"
          max="20"
          value={iterations}
          onChange={event => setIterations(clampInt(event.target.value, 1, 20, 10))}
          className="mt-1 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-white outline-none focus:border-violet-400"
        />
      </label>
      <label className="text-xs text-slate-500">
        Intent
        <select
          value={intent}
          onChange={event => setIntent(event.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-violet-400"
        >
          <option value="engage">Engage</option>
          <option value="trust">Trust</option>
          <option value="convert">Convert</option>
          <option value="clarity">Clarity</option>
        </select>
      </label>
      <button
        onClick={onStart}
        disabled={disabled || running}
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
      >
        {running ? <Loader2 className="animate-spin" size={17} /> : <Zap size={17} />}
        {running ? 'Running' : 'Optimize'}
      </button>
    </div>
  )
}

function ActivityFeed({ refEl, items, status, error }) {
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Action Feed</h2>
        <StatusChip status={status} />
      </div>
      <div ref={refEl} className="h-[calc(100vh-360px)] min-h-[300px] overflow-auto rounded-2xl border border-slate-800 bg-slate-900/35 p-3">
        {items.length === 0 && !error && (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-600">
            Enter a target and start an optimization run.
          </div>
        )}
        {error && <FeedRow item={{ kind: 'error', title: 'Error', text: error }} />}
        {items.map(item => <FeedRow key={item.id} item={item} />)}
      </div>
    </section>
  )
}

function FeedRow({ item }) {
  const tone = {
    baseline: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200',
    accepted: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    rejected: 'border-red-400/20 bg-red-500/10 text-red-200',
    approval: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
    complete: 'border-violet-400/20 bg-violet-500/10 text-violet-200',
    error: 'border-red-400/30 bg-red-500/10 text-red-200',
    status: 'border-slate-800 bg-slate-950/70 text-slate-300',
  }[item.kind || 'status']

  return (
    <div className={`mb-2 rounded-xl border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold">{item.title}</p>
          {item.text && <p className="mt-1 text-xs leading-relaxed opacity-80">{item.text}</p>}
          {item.action && <p className="mt-1 text-[11px] uppercase tracking-[0.14em] opacity-60">{item.action}</p>}
        </div>
        {item.delta != null && (
          <span className={`font-mono text-xs ${item.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {formatDelta(item.delta)}
          </span>
        )}
      </div>
    </div>
  )
}

function ApprovalDock({ pending, onDecision }) {
  const edit = pending.edit || {}
  return (
    <div className="absolute left-5 right-5 top-5 z-30 rounded-2xl border border-amber-400/35 bg-slate-950/95 p-4 shadow-2xl shadow-black/40">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Decision Required</p>
          <p className="mt-1 text-sm text-slate-300">{pending.message || cleanAction(pending.action_type)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onDecision(false)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/25 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/10">
            <X size={14} />
            Reject
          </button>
          <button onClick={() => onDecision(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">
            <Check size={14} />
            Accept
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DiffPane label="Before" text={edit.original || edit.css || pending.target || ''} tone="red" />
        <DiffPane label="After" text={edit.replacement || edit.css || edit.description || ''} tone="green" />
      </div>
      {edit.reasoning && <p className="mt-3 text-xs italic leading-relaxed text-slate-500">{edit.reasoning}</p>}
    </div>
  )
}

function DiffPane({ label, text, tone }) {
  const color = tone === 'green' ? 'border-emerald-400/20 text-emerald-100' : 'border-red-400/20 text-red-100'
  return (
    <div className={`max-h-28 overflow-auto rounded-lg border bg-slate-900/80 p-3 ${color}`}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] opacity-60">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{String(text || 'No text supplied')}</pre>
    </div>
  )
}

function ScoreTrace({ run }) {
  const hasData = run.chart.length > 0
  return (
    <section className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Neural Activation</h2>
          <p className="mt-1 text-xs text-slate-600">Score over accepted iterations</p>
        </div>
        <ScoreSummary baseline={run.baseline} final={run.final} accepted={run.accepted.length} />
      </div>
      <div className="h-48">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={run.chart}>
              <defs>
                <linearGradient id="overallFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="iteration" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
              <Tooltip contentStyle={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 10 }} />
              <Area type="monotone" dataKey="overall" stroke="#a78bfa" fill="url(#overallFill)" strokeWidth={2} />
              <Area type="monotone" dataKey="attention" stroke="#fbbf24" fill="transparent" strokeWidth={1.4} />
              <Area type="monotone" dataKey="visual" stroke="#22c55e" fill="transparent" strokeWidth={1.4} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-600">
            Score chart appears after the first baseline pass.
          </div>
        )}
      </div>
    </section>
  )
}

function PreviewDeck({ jobId, run, htmlFile, sourceMode, onDownloadHtml }) {
  const [side, setSide] = useState('after')
  const hasUrlPreview = Boolean(jobId)
  const hasHtmlPreview = sourceMode === 'file' && htmlFile?.content
  const stamp = run.completedAt || run.current || 0

  if (!hasUrlPreview && !hasHtmlPreview) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/35 p-8 text-center text-sm text-slate-600">
        <BarChart3 className="mx-auto mb-3 text-slate-700" size={30} />
        Optimization output appears here.
      </section>
    )
  }

  const beforeImg = jobId ? `/job/${jobId}/before-screenshot?v=${stamp}` : ''
  const afterImg = jobId ? `/job/${jobId}/after-screenshot?v=${stamp}` : ''

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Before / After</h2>
          <p className="mt-1 text-xs text-slate-600">{sourceMode === 'file' ? htmlFile?.name : 'Rendered page screenshots'}</p>
        </div>
        <div className="flex items-center gap-2">
          {sourceMode === 'file' && run.optimizedHtml && (
            <button onClick={onDownloadHtml} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white">
              <Download size={14} />
              Export HTML
            </button>
          )}
          {['before', 'after', 'split'].map(mode => (
            <button
              key={mode}
              onClick={() => setSide(mode)}
              className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${side === mode ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-500 hover:text-slate-200'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {side === 'split' ? (
        <div className="grid max-h-[520px] grid-cols-2 gap-3 overflow-hidden">
          <PreviewFrame title="Before" src={beforeImg} html={htmlFile?.content} />
          <PreviewFrame title="After" src={afterImg} html={run.optimizedHtml || htmlFile?.content} />
        </div>
      ) : (
        <PreviewFrame
          title={side === 'before' ? 'Before' : 'After'}
          src={side === 'before' ? beforeImg : afterImg}
          html={side === 'before' ? htmlFile?.content : run.optimizedHtml || htmlFile?.content}
        />
      )}
    </section>
  )
}

function PreviewFrame({ title, src, html }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-800 bg-black">
      <figcaption className="border-b border-slate-800 bg-slate-950 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </figcaption>
      {html ? (
        <iframe srcDoc={html} title={title} sandbox="allow-same-origin" className="h-[480px] w-full border-0 bg-white" />
      ) : (
        <img src={src} alt={title} className="max-h-[560px] w-full object-contain" />
      )}
    </figure>
  )
}

function SaliencyCard({ gaze }) {
  if (!gaze.overlay && !gaze.regions?.length) return null
  return (
    <section className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
        <Eye size={14} />
        Visual Saliency
      </div>
      {gaze.overlay && (
        <img src={`data:image/png;base64,${gaze.overlay}`} alt="Saliency overlay" className="max-h-72 w-full rounded-lg border border-slate-800 object-contain bg-black" />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {(gaze.regions || []).slice(0, 8).map(region => (
          <span key={region.rank} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-400">
            #{region.rank} {Math.round(Number(region.saliency_score || 0) * 100)}%
          </span>
        ))}
      </div>
    </section>
  )
}

function PatternsBoard() {
  const [patterns, setPatterns] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const load = useCallback(async quiet => {
    if (!quiet) setStatus('loading')
    try {
      const response = await fetch('/patterns')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setPatterns(Array.isArray(data) ? data : [])
      setStatus('ready')
      setError('')
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Could not load patterns')
    }
  }, [])

  useEffect(() => {
    let live = true
    load(false)
    const id = setInterval(() => live && load(true), 5000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [load])

  if (status === 'loading') {
    return <EmptyState icon={RefreshCw} title="Loading patterns" text="Reading the optimizer memory store." spin />
  }

  if (status === 'error') {
    return <EmptyState icon={X} title="Patterns unavailable" text={error} />
  }

  if (!patterns.length) {
    return <EmptyState icon={BrainCircuit} title="No patterns yet" text="Run optimizations to build the local knowledge base." />
  }

  const samples = patterns.reduce((total, pattern) => total + Number(pattern.sample_count || 0), 0)

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Learned Patterns</h2>
          <p className="mt-1 text-sm text-slate-500">{samples} measured optimization experiences</p>
        </div>
        <button onClick={() => load(false)} className="inline-flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm font-bold text-slate-300 hover:text-white">
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {patterns.map(pattern => <PatternCard key={pattern.id} pattern={pattern} />)}
      </div>
    </div>
  )
}

function PatternCard({ pattern }) {
  const confidence = Math.round(Number(pattern.confidence || 0) * 100)
  const delta = Number(pattern.avg_overall_delta || 0)
  const tone = PATTERN_PALETTE[pattern.pattern_type] || 'border-slate-700 bg-slate-800/60 text-slate-300'
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}>
          {pattern.pattern_type}
        </span>
        <span className={`font-mono text-xs font-bold ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatDelta(delta)} avg</span>
      </div>
      <p className="min-h-12 text-sm leading-relaxed text-slate-300">{pattern.pattern_description}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <MiniMetric label="Lang" value={pattern.avg_language_roi_delta} />
        <MiniMetric label="Attn" value={pattern.avg_attention_roi_delta} />
        <MiniMetric label="Vis" value={pattern.avg_visual_roi_delta} />
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>Confidence</span>
          <span>{confidence}% / n={pattern.sample_count}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-violet-400" style={{ width: `${confidence}%` }} />
        </div>
      </div>
    </article>
  )
}

function MiniMetric({ label, value }) {
  const number = Number(value || 0)
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
      <div className="text-slate-600">{label}</div>
      <div className={`font-mono ${number >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatDelta(number)}</div>
    </div>
  )
}

function ScoreSummary({ baseline, final, accepted }) {
  const start = Number(baseline?.overall_score || 0)
  const end = Number(final?.overall_score || start)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-slate-300">
        {start ? start.toFixed(4) : '0.0000'} to {end ? end.toFixed(4) : '0.0000'}
      </span>
      <span className="rounded-lg border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-violet-200">
        {accepted} accepted
      </span>
    </div>
  )
}

function StatusChip({ status }) {
  const color = {
    idle: 'bg-slate-700',
    starting: 'bg-amber-400',
    running: 'bg-cyan-400',
    complete: 'bg-emerald-400',
    error: 'bg-red-400',
  }[status] || 'bg-slate-700'
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  )
}

function EmptyState({ icon: Icon, title, text, spin = false }) {
  return (
    <div className="flex h-[calc(100vh-90px)] items-center justify-center p-8 text-center">
      <div>
        <Icon className={`mx-auto mb-4 text-slate-600 ${spin ? 'animate-spin' : ''}`} size={36} />
        <h2 className="text-lg font-bold text-slate-300">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{text}</p>
      </div>
    </div>
  )
}

function NavButton({ item, active, onClick }) {
  const Icon = item.Icon
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-11 min-w-[132px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
        active ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
      }`}
    >
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${active ? 'bg-white/12' : 'bg-slate-800 text-slate-500'}`}>
        <Icon size={14} />
      </span>
      {item.label}
    </button>
  )
}

function CortexLogo() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/25 bg-slate-900 shadow-[0_0_28px_rgba(34,211,238,0.18)]">
      <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden="true">
        <defs>
          <linearGradient id="cortexLogoGradient" x1="8" x2="40" y1="8" y2="40">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="48%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <path d="M10 25c0-7.4 5.9-13.5 13.2-13.8 7.8-.3 14.6 5.8 14.8 13.5.2 7.1-5.1 13.1-12 14.1" fill="none" stroke="url(#cortexLogoGradient)" strokeWidth="4.4" strokeLinecap="round" />
        <path d="M15 25c0-4.7 3.8-8.6 8.6-8.7 5-.1 9.3 3.8 9.4 8.8.1 4.6-3.4 8.5-7.9 9.1" fill="none" stroke="url(#cortexLogoGradient)" strokeWidth="3" strokeLinecap="round" opacity=".75" />
        <path d="M20.5 24.8c0-2 1.6-3.8 3.7-3.8s3.8 1.7 3.8 3.8-1.6 3.7-3.8 3.7" fill="none" stroke="url(#cortexLogoGradient)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="24" cy="25" r="2.2" fill="#e0f2fe" />
      </svg>
    </div>
  )
}

function feedItem(kind, title, extra = {}) {
  return { id: crypto.randomUUID(), at: Date.now(), kind, title, ...extra }
}

function chartPoint(iteration, score) {
  return {
    iteration,
    overall: Number(score?.overall_score || 0),
    language: Number(score?.language_roi || 0),
    attention: Number(score?.attention_roi || 0),
    visual: Number(score?.visual_roi || 0),
  }
}

function cleanAction(value = 'edit') {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function cleanStage(value = 'progress') {
  const map = {
    scraping: 'Rendering page',
    scoring: 'Scoring layout',
    scoring_wait: 'Waiting for score',
    proposing: 'Proposing edit',
    rendering: 'Rendering preview',
  }
  return map[value] || cleanAction(value)
}

function formatDelta(value) {
  const number = Number(value || 0)
  return `${number >= 0 ? '+' : ''}${number.toFixed(4)}`
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || data.message || `HTTP ${response.status}`)
  return data
}

async function postForm(url, form) {
  const response = await fetch(url, { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || data.message || `HTTP ${response.status}`)
  return data
}
