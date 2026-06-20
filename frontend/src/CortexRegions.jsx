import { AlertTriangle, BadgeInfo, CircleDot, ShieldCheck } from 'lucide-react'

const REGION_ORDER = ['FFA', 'V4', 'MT+', 'Hippocampus', 'PFC', 'ACC', 'Amygdala', 'Insula', 'NAcc']

const REGION_INFO = {
  FFA: { group: 'recognition', label: 'Face and social recognition', tone: 'violet' },
  V4: { group: 'visual', label: 'Color and visual richness', tone: 'cyan' },
  'MT+': { group: 'motion', label: 'Motion and dynamic elements', tone: 'sky' },
  Hippocampus: { group: 'memory', label: 'Novelty and memorability', tone: 'indigo', sub: true },
  PFC: { group: 'clarity', label: 'Clarity and planning', tone: 'emerald' },
  ACC: { group: 'friction', label: 'Conflict and effort', tone: 'rose' },
  Amygdala: { group: 'pressure', label: 'Threat and anxiety signal', tone: 'red', sub: true },
  Insula: { group: 'unease', label: 'Visceral discomfort', tone: 'orange' },
  NAcc: { group: 'reward', label: 'Reward anticipation', tone: 'amber', sub: true },
}

const TONE = {
  amber: 'bg-amber-400 text-amber-300 border-amber-400/30',
  cyan: 'bg-cyan-400 text-cyan-300 border-cyan-400/30',
  emerald: 'bg-emerald-400 text-emerald-300 border-emerald-400/30',
  indigo: 'bg-indigo-400 text-indigo-300 border-indigo-400/30',
  orange: 'bg-orange-400 text-orange-300 border-orange-400/30',
  red: 'bg-red-400 text-red-300 border-red-400/30',
  rose: 'bg-rose-400 text-rose-300 border-rose-400/30',
  sky: 'bg-sky-400 text-sky-300 border-sky-400/30',
  violet: 'bg-violet-400 text-violet-300 border-violet-400/30',
}

const FLAG_TONE = {
  block: 'border-red-400/35 bg-red-500/10 text-red-200',
  warn: 'border-amber-400/35 bg-amber-500/10 text-amber-200',
  info: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-200',
}

function asUnit(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function percent(value) {
  return Math.round(asUnit(value) * 100)
}

function regionRows(regions) {
  return REGION_ORDER
    .filter(name => Object.prototype.hasOwnProperty.call(regions, name))
    .map(name => ({ name, value: asUnit(regions[name]), ...REGION_INFO[name] }))
    .sort((a, b) => b.value - a.value)
}

function SignalCard({ name, value, label, tone, sub }) {
  const toneClasses = TONE[tone] || TONE.violet
  const warning = (name === 'Amygdala' && value > 0.6) || (name === 'NAcc' && value > 0.72)

  return (
    <div className={`rounded-lg border bg-slate-950/45 px-3 py-3 ${warning ? 'border-red-400/45' : 'border-slate-800'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-300">{name}</span>
        {sub && <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">sub</span>}
      </div>
      <div className={`font-mono text-2xl font-black ${warning ? 'text-red-300' : toneClasses.split(' ')[1]}`}>
        {value.toFixed(3)}
      </div>
      <p className="mt-1 min-h-8 text-[10px] leading-snug text-slate-500">{label}</p>
    </div>
  )
}

function RegionMeter({ row }) {
  const toneClasses = TONE[row.tone] || TONE.violet
  const barClass = toneClasses.split(' ')[0]
  const textClass = toneClasses.split(' ')[1]

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/25 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-14 text-xs font-semibold text-slate-200">{row.name}</span>
        <span className="truncate text-[10px] text-slate-500">{row.label}</span>
        {row.sub && <span className="ml-auto rounded bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">sub</span>}
        <span className={`ml-auto font-mono text-[11px] ${textClass}`}>{row.value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent(row.value)}%` }} />
      </div>
    </div>
  )
}

export default function CortexRegions({ regions, ethicsFlags = [], intent = 'engage', intentReward = null }) {
  if (!regions) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-center text-sm text-slate-500">
        Cortex signal estimates appear once a page has been scored.
      </div>
    )
  }

  const rows = regionRows(regions)
  const featured = ['Amygdala', 'Hippocampus', 'NAcc']
    .map(name => rows.find(row => row.name === name))
    .filter(Boolean)

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.16)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
            <CircleDot size={14} className="text-cyan-300" />
            Cortex Signal Map
          </div>
          <p className="mt-1 text-xs text-slate-500">Intent: {intent}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-950/55 px-2.5 py-1 text-[11px] text-slate-400">
            9 channels
          </span>
          {intentReward !== null && (
            <span className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
              intentReward >= 0
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                : 'border-red-400/25 bg-red-500/10 text-red-300'
            }`}>
              {intentReward >= 0 ? '+' : ''}{Number(intentReward).toFixed(4)}
            </span>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        {featured.map(row => <SignalCard key={row.name} {...row} />)}
      </div>

      <div className="grid gap-2">
        {rows.map(row => <RegionMeter key={row.name} row={row} />)}
      </div>

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/35 p-3 text-[11px] leading-relaxed text-slate-500">
        <div className="mb-1 flex items-center gap-2 font-semibold text-slate-400">
          <BadgeInfo size={13} />
          Signal provenance
        </div>
        Hippocampus, Amygdala, and NAcc are subcortical estimates. Cortical channels use the local visual-language scoring model.
      </div>

      {ethicsFlags?.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            <ShieldCheck size={14} />
            Guardrail Flags
          </div>
          {ethicsFlags.map((flag, index) => (
            <div
              key={`${flag.code || 'flag'}-${index}`}
              className={`rounded-lg border px-3 py-2 text-xs ${FLAG_TONE[flag.severity] || FLAG_TONE.info}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">{String(flag.code || 'notice').replace(/_/g, ' ')}</div>
                  <div className="mt-0.5 opacity-80">{flag.message}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
