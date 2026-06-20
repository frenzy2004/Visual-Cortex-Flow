import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { chromium } from "playwright";
import { PNG } from "pngjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type RegionMap = Record<string, number>;
type Score = {
  overall_score: number;
  visual_score: number;
  text_score: number;
  audio_score: number;
  language_roi: number;
  attention_roi: number;
  visual_roi: number;
  atlas_regions: RegionMap;
};
type EventPacket = { type: string; data: Record<string, unknown> };
type JobState = {
  job_id: string;
  url: string;
  status: "pending" | "running" | "complete" | "error";
  max_iterations: number;
  current_iteration: number;
  events: EventPacket[];
  clients: Set<Response>;
  result?: Record<string, unknown>;
  error?: string;
  beforeScreenshot?: string;
  afterScreenshot?: string;
  generatedAfterScreenshot?: string;
  iterationScreenshots: Record<number, string>;
  pendingDecision?: {
    iteration: number;
    resolve: (accept: boolean) => void;
    timeout: NodeJS.Timeout;
  };
};
type PageCapture = {
  url: string;
  title: string;
  text: string;
  html: string;
  screenshotPath: string;
};
type Hotspot = {
  rank: number;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};
type SaliencyResult = {
  overlayPath: string;
  width: number;
  height: number;
  hotspots: Hotspot[];
};
type ElementSaliencyBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
  kind: string;
};
type GazeRegion = {
  rank: number;
  bbox: [number, number, number, number];
  peak_coords: [number, number];
  saliency_score: number;
};
type VisionImage = {
  path: string;
  mime: string;
  label: string;
  time?: number;
};
type MemoryExperience = {
  id: string;
  job_id: string;
  url: string;
  created_at: string;
  baseline_overall: number;
  final_overall: number;
  improvement_pct: number;
  accepted_edits: Array<Record<string, any>>;
  history: Array<Record<string, any>>;
};
type LearnedPattern = {
  id: string;
  pattern_type: string;
  pattern_description: string;
  action_type: string;
  sample_count: number;
  confidence: number;
  avg_overall_delta: number;
  avg_language_roi_delta: number;
  avg_attention_roi_delta: number;
  avg_visual_roi_delta: number;
  last_updated: string;
};
type MemoryState = {
  experiences: MemoryExperience[];
  patterns: LearnedPattern[];
};

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });
const jobs = new Map<string, JobState>();
const screenshotCache = new Map<string, string>();
const runsDir = path.resolve(process.cwd(), "runs");
const memoryPath = path.join(runsDir, "memory.json");
const memoryState: MemoryState = loadMemoryState();

function loadMemoryState(): MemoryState {
  try {
    if (!fs.existsSync(memoryPath)) {
      return { experiences: [], patterns: [] };
    }

    const parsed = safeJson(fs.readFileSync(memoryPath, "utf8"));
    const experiences = normalizeExperiences(parsed?.experiences);
    const storedPatterns = normalizePatterns(parsed?.patterns);

    if (experiences.length > 0) {
      return {
        experiences,
        patterns: rebuildLearnedPatterns(experiences),
      };
    }

    return {
      experiences,
      patterns: storedPatterns,
    };
  } catch {
    return { experiences: [], patterns: [] };
  }
}

function persistMemoryState() {
  fs.mkdirSync(runsDir, { recursive: true });
  const tmpPath = `${memoryPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(memoryState, null, 2));
  fs.renameSync(tmpPath, memoryPath);
}

function normalizeExperiences(value: unknown): MemoryExperience[] {
  if (!Array.isArray(value)) return [];
  return value.map((experience) => normalizeExperience(experience)).filter((experience): experience is MemoryExperience => Boolean(experience));
}

function normalizePatterns(value: unknown): LearnedPattern[] {
  if (!Array.isArray(value)) return [];
  return value.map((pattern) => normalizePattern(pattern)).filter((pattern): pattern is LearnedPattern => Boolean(pattern));
}

function normalizeExperience(value: unknown): MemoryExperience | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const jobId = String(candidate.job_id || "");
  const createdAt = String(candidate.created_at || "");
  const id = String(candidate.id || jobId || crypto.randomUUID());
  const baselineScore = candidate.baseline_score && typeof candidate.baseline_score === "object"
    ? candidate.baseline_score as Record<string, unknown>
    : {};
  const finalScore = candidate.final_score && typeof candidate.final_score === "object"
    ? candidate.final_score as Record<string, unknown>
    : {};
  return {
    id,
    job_id: jobId,
    url: String(candidate.url || ""),
    created_at: createdAt || new Date().toISOString(),
    baseline_overall: Number(candidate.baseline_overall ?? baselineScore.overall_score ?? 0),
    final_overall: Number(candidate.final_overall ?? finalScore.overall_score ?? 0),
    improvement_pct: Number(candidate.improvement_pct ?? 0),
    accepted_edits: Array.isArray(candidate.accepted_edits) ? candidate.accepted_edits.map((item) => normalizePlainRecord(item)) : [],
    history: Array.isArray(candidate.history) ? candidate.history.map((item) => normalizeHistoryEntry(item)) : [],
  };
}

function normalizePattern(value: unknown): LearnedPattern | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = String(candidate.id || "");
  const patternType = String(candidate.pattern_type || "");
  const actionType = String(candidate.action_type || "");
  if (!id || !patternType || !actionType) return null;
  return {
    id,
    pattern_type: patternType,
    pattern_description: String(candidate.pattern_description || ""),
    action_type: actionType,
    sample_count: Math.max(0, Number(candidate.sample_count ?? 0)),
    confidence: clamp01(Number(candidate.confidence ?? 0)),
    avg_overall_delta: Number(candidate.avg_overall_delta ?? 0),
    avg_language_roi_delta: Number(candidate.avg_language_roi_delta ?? 0),
    avg_attention_roi_delta: Number(candidate.avg_attention_roi_delta ?? 0),
    avg_visual_roi_delta: Number(candidate.avg_visual_roi_delta ?? 0),
    last_updated: String(candidate.last_updated || new Date().toISOString()),
  };
}

function normalizePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return { ...(value as Record<string, unknown>) };
}

function normalizeHistoryEntry(value: unknown): Record<string, unknown> {
  const record = normalizePlainRecord(value);
  const edit = record.edit && typeof record.edit === "object" ? { ...(record.edit as Record<string, unknown>) } : {};
  const actionType = String(record.action_type || edit.action_type || "unknown");
  const roiDeltas = record.roi_deltas && typeof record.roi_deltas === "object"
    ? {
        language: Number((record.roi_deltas as Record<string, unknown>).language ?? 0),
        attention: Number((record.roi_deltas as Record<string, unknown>).attention ?? 0),
        visual: Number((record.roi_deltas as Record<string, unknown>).visual ?? 0),
      }
    : { language: 0, attention: 0, visual: 0 };
  return {
    ...record,
    edit,
    action_type: actionType,
    accepted: Boolean(record.accepted),
    reward: Number(record.reward ?? 0),
    roi_deltas: roiDeltas,
  };
}

function normalizeAcceptedEdit(value: unknown): Record<string, unknown> {
  const record = normalizePlainRecord(value);
  const iteration = Number(record.iteration ?? record.iteration_count ?? 0);
  const edit = record.edit && typeof record.edit === "object" ? { ...(record.edit as Record<string, unknown>) } : {};
  const actionType = String(record.action_type || edit.action_type || "unknown");
  const roiDeltas = record.roi_deltas && typeof record.roi_deltas === "object"
    ? {
        language: Number((record.roi_deltas as Record<string, unknown>).language ?? 0),
        attention: Number((record.roi_deltas as Record<string, unknown>).attention ?? 0),
        visual: Number((record.roi_deltas as Record<string, unknown>).visual ?? 0),
      }
    : { language: 0, attention: 0, visual: 0 };
  return {
    ...record,
    edit,
    action_type: actionType,
    iteration,
    reward: Number(record.reward ?? 0),
    roi_deltas: roiDeltas,
  };
}

function buildJobMemoryExperience(job: JobState, result: Record<string, unknown>): MemoryExperience {
  const normalizedHistory = Array.isArray(result.history) ? result.history.map((item) => normalizeHistoryEntry(item)) : [];
  const acceptedFromHistory = normalizedHistory.filter((entry) => Boolean(entry.accepted));
  const acceptedEdits = buildAcceptedEdits(result.accepted_edits, acceptedFromHistory);
  result.history = normalizedHistory;
  result.accepted_edits = acceptedEdits;

  return {
    id: String(result.memory_id || job.job_id),
    job_id: job.job_id,
    url: job.url,
    created_at: new Date().toISOString(),
    baseline_overall: Number(result.baseline_score && typeof result.baseline_score === "object"
      ? (result.baseline_score as Record<string, unknown>).overall_score ?? 0
      : 0),
    final_overall: Number(result.final_score && typeof result.final_score === "object"
      ? (result.final_score as Record<string, unknown>).overall_score ?? 0
      : 0),
    improvement_pct: Number(result.improvement_pct ?? 0),
    accepted_edits: acceptedEdits,
    history: normalizedHistory,
  };
}

function buildAcceptedEdits(value: unknown, history: Record<string, unknown>[]) {
  const source = Array.isArray(value) ? value.map((item) => normalizeAcceptedEdit(item)) : [];
  if (source.length === 0) {
    return history.map((entry) => ({
      ...(entry.edit as Record<string, unknown>),
      iteration: Number(entry.iteration_count ?? entry.iteration ?? 0),
      reward: Number(entry.reward ?? 0),
      roi_deltas: normalizeRoiDeltas(entry.roi_deltas),
      action_type: String(entry.action_type || getRecordActionType(entry.edit) || "unknown"),
      accepted: true,
    }));
  }

  return source.map((acceptedEdit) => {
    const iteration = Number(acceptedEdit.iteration ?? 0);
    const matchingHistory = history.find((entry) => Number(entry.iteration_count ?? entry.iteration ?? 0) === iteration || Number(entry.iteration_count ?? entry.iteration ?? 0) === Number(acceptedEdit.iteration_count ?? 0));
    const edit = acceptedEdit.edit && typeof acceptedEdit.edit === "object" ? acceptedEdit.edit as Record<string, unknown> : {};
    return {
      ...edit,
      ...acceptedEdit,
      iteration,
      action_type: String(acceptedEdit.action_type || matchingHistory?.action_type || getRecordActionType(edit) || "unknown"),
      reward: Number(matchingHistory?.reward ?? acceptedEdit.reward ?? 0),
      roi_deltas: normalizeRoiDeltas(matchingHistory?.roi_deltas ?? acceptedEdit.roi_deltas),
      edit,
      accepted: true,
    };
  });
}

function getRecordActionType(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return String((value as Record<string, unknown>).action_type || "");
}

function normalizeRoiDeltas(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    language: Number(record.language ?? 0),
    attention: Number(record.attention ?? 0),
    visual: Number(record.visual ?? 0),
  };
}

function buildMemoryStats(experiences: MemoryExperience[]) {
  const aggregates = new Map<string, {
    count: number;
    accepted: number;
    rewardSum: number;
    lastUpdated: string;
  }>();

  for (const experience of experiences) {
    for (const entry of experience.history || []) {
      const actionType = String(entry.action_type || entry.edit?.action_type || "unknown");
      if (!actionType || actionType === "unknown") continue;
      const current = aggregates.get(actionType) || {
        count: 0,
        accepted: 0,
        rewardSum: 0,
        lastUpdated: experience.created_at || new Date().toISOString(),
      };
      current.count += 1;
      if (Boolean(entry.accepted)) current.accepted += 1;
      current.rewardSum += Number(entry.reward ?? 0);
      if (experience.created_at > current.lastUpdated) current.lastUpdated = experience.created_at;
      aggregates.set(actionType, current);
    }
  }

  const stats: Record<string, { avg_reward: number; success_rate: number; count: number; last_updated: string }> = {};
  for (const [actionType, aggregate] of aggregates.entries()) {
    stats[actionType] = {
      avg_reward: aggregate.count ? round4(aggregate.rewardSum / aggregate.count) : 0,
      success_rate: aggregate.count ? round4(aggregate.accepted / aggregate.count) : 0,
      count: aggregate.count,
      last_updated: aggregate.lastUpdated,
    };
  }
  return stats;
}

function rebuildLearnedPatterns(experiences: MemoryExperience[]): LearnedPattern[] {
  const groups = new Map<string, {
    action_type: string;
    pattern_type: string;
    accepted_count: number;
    total_count: number;
    overall_sum: number;
    language_sum: number;
    attention_sum: number;
    visual_sum: number;
    last_updated: string;
  }>();

  for (const experience of experiences) {
    for (const entry of experience.history || []) {
      const actionType = String(entry.action_type || entry.edit?.action_type || "unknown");
      if (!actionType || actionType === "unknown" || !Boolean(entry.accepted)) continue;
      const key = actionType;
      const current = groups.get(key) || {
        action_type: actionType,
        pattern_type: classifyPatternType(actionType),
        accepted_count: 0,
        total_count: 0,
        overall_sum: 0,
        language_sum: 0,
        attention_sum: 0,
        visual_sum: 0,
        last_updated: experience.created_at || new Date().toISOString(),
      };
      current.accepted_count += 1;
      current.total_count += 1;
      current.overall_sum += Number(entry.reward ?? 0);
      const deltas = normalizeRoiDeltas(entry.roi_deltas);
      current.language_sum += deltas.language;
      current.attention_sum += deltas.attention;
      current.visual_sum += deltas.visual;
      if (experience.created_at > current.last_updated) current.last_updated = experience.created_at;
      groups.set(key, current);
    }
  }

  const patterns = Array.from(groups.values()).map((group) => {
    const avgOverall = group.accepted_count ? group.overall_sum / group.accepted_count : 0;
    const avgLanguage = group.accepted_count ? group.language_sum / group.accepted_count : 0;
    const avgAttention = group.accepted_count ? group.attention_sum / group.accepted_count : 0;
    const avgVisual = group.accepted_count ? group.visual_sum / group.accepted_count : 0;
    const coverage = group.accepted_count / Math.max(1, group.accepted_count + 2);
    const liftSignal = clamp01(0.5 + avgOverall * 5);
    const confidence = round4(clamp01(coverage * 0.65 + liftSignal * 0.35));

    return {
      id: `pattern:${group.action_type}`,
      pattern_type: group.pattern_type,
      pattern_description: describePattern(group.action_type, group.accepted_count, avgOverall, avgLanguage, avgAttention, avgVisual),
      action_type: group.action_type,
      sample_count: group.accepted_count,
      confidence,
      avg_overall_delta: round4(avgOverall),
      avg_language_roi_delta: round4(avgLanguage),
      avg_attention_roi_delta: round4(avgAttention),
      avg_visual_roi_delta: round4(avgVisual),
      last_updated: group.last_updated,
    } satisfies LearnedPattern;
  });

  return patterns.sort((a, b) => {
    if (b.sample_count !== a.sample_count) return b.sample_count - a.sample_count;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.id.localeCompare(b.id);
  });
}

function classifyPatternType(actionType: string) {
  if (/social_proof|testimonial|review|trust/i.test(actionType)) return "SOCIAL_PROOF";
  if (/contrast|font|cta|hierarchy|accessibility|load|clarity|visual/i.test(actionType)) return "COGNITIVE_LOAD";
  if (/reorder|section|spacing|layout|structure|whitespace/i.test(actionType)) return "STRUCTURAL";
  return "LEXICAL";
}

function describePattern(actionType: string, sampleCount: number, avgOverall: number, avgLanguage: number, avgAttention: number, avgVisual: number) {
  const delta = formatSigned(avgOverall);
  const language = formatSigned(avgLanguage);
  const attention = formatSigned(avgAttention);
  const visual = formatSigned(avgVisual);
  return `${humanizeActionType(actionType)} averaged ${delta} overall across ${sampleCount} accepted edit${sampleCount === 1 ? "" : "s"}, with language ${language}, attention ${attention}, and visual ${visual}.`;
}

function humanizeActionType(actionType: string) {
  return actionType.replace(/_/g, " ").trim();
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${round4(value).toFixed(4)}`;
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const asyncRoute = (
  handler: (req: Request, res: Response) => Promise<void>,
) => (req: Request, res: Response) => {
  handler(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ detail: message });
  });
};

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    runtime: "node-typescript",
    openai_live: envBool("OPENAI_LIVE", true),
    model: process.env.OPENAI_MODEL || "local",
    image_chat_model: process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "local",
    vision_model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "local",
    image_model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    neural_encoder_configured: Boolean(neuralEncoderEndpoint()),
  });
});

app.post("/optimize", asyncRoute(async (req, res) => {
  const url = normalizeUrl(String(req.body?.url || ""));
  const maxIterations = clampInt(req.body?.max_iterations, 1, 20, 10);
  const job = createJob(url, maxIterations);
  void runUrlOptimization(job, String(req.body?.intent || "engage"));
  res.json({ job_id: job.job_id });
}));

app.get("/job/:id/stream", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "Job not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (job.status === "complete" || job.status === "error") {
    res.end();
    return;
  }
  job.clients.add(res);
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 30_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    job.clients.delete(res);
  });
});

app.get("/job/:id/result", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "Job not found" });
    return;
  }
  if (job.status === "error") {
    res.status(500).json({ detail: job.error || "Job failed" });
    return;
  }
  if (job.status !== "complete") {
    res.status(202).json({ detail: "Job still running" });
    return;
  }
  res.json(job.result || {});
});

app.post("/job/:id/decision", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "Job not found" });
    return;
  }
  const iteration = Number(req.body?.iteration);
  const accept = Boolean(req.body?.accept);
  if (!job.pendingDecision || job.pendingDecision.iteration !== iteration) {
    res.status(409).json({ detail: "No matching decision is pending" });
    return;
  }
  const pending = job.pendingDecision;
  job.pendingDecision = undefined;
  clearTimeout(pending.timeout);
  pending.resolve(accept);
  emit(job, "progress", {
    status: "decision_received",
    iteration,
    accept,
  });
  res.json({ ok: true });
});

app.get("/job/:id/before-screenshot", asyncRoute(async (req, res) => {
  await sendJobImage(req, res, "before");
}));
app.get("/job/:id/after-screenshot", asyncRoute(async (req, res) => {
  await sendJobImage(req, res, "after");
}));
app.get("/job/:id/iteration/:step/screenshot", (req, res) => {
  const job = jobs.get(req.params.id);
  const step = Number(req.params.step);
  const file = job?.iterationScreenshots[step];
  if (!file || !fs.existsSync(file)) {
    res.status(404).json({ detail: "Iteration screenshot not available" });
    return;
  }
  res.type("png").sendFile(file);
});

app.get("/memory/stats", (_req, res) => res.json(buildMemoryStats(memoryState.experiences)));
app.get("/memory/history", (_req, res) => res.json([...memoryState.experiences].reverse()));
app.get("/patterns", (_req, res) => res.json(memoryState.patterns));

app.post("/parse-page", asyncRoute(async (req, res) => {
  const url = normalizeUrl(String(req.body?.url || ""));
  const workDir = await makeRunDir(`parse-${crypto.randomUUID()}`);
  const capture = await captureUrl(url, workDir);
  screenshotCache.set(url, capture.screenshotPath);
  const score = await scoreContent(capture.text, capture.screenshotPath);
  res.json({
    components: parseComponents(capture.text),
    screenshot_base64: await fileBase64(capture.screenshotPath),
    page_score: score,
    url,
  });
}));

app.post("/score-layout", asyncRoute(async (req, res) => {
  const components = Array.isArray(req.body?.components) ? req.body.components : [];
  const fullText = components.map((c: Record<string, unknown>) => String(c.content || "")).join("\n\n");
  const screenshotPath = screenshotCache.get(String(req.body?.url || ""));
  const totalScore = await scoreContent(fullText, screenshotPath);
  const perComponent = await Promise.all(components.map(async (comp: Record<string, unknown>) => {
    const compScore = await scoreContent(String(comp.content || ""), screenshotPath);
    return {
      id: comp.id,
      type: comp.type,
      score: compScore,
      neural_contribution: compScore.overall_score,
    };
  }));
  res.json({ total_score: totalScore, per_component: perComponent });
}));

app.post("/optimize-block", asyncRoute(async (req, res) => {
  const block = req.body?.block || {};
  res.json({ edit: localTextEdit(String(block.content || ""), 1), block_id: block.id });
}));

app.post("/apply-edit", asyncRoute(async (req, res) => {
  const edit = req.body?.edit || {};
  const currentText = String(req.body?.current_text || "");
  const original = String(edit.original || "");
  const replacement = String(edit.replacement || "");
  const newText = original && currentText.includes(original)
    ? currentText.replace(original, replacement)
    : currentText;
  const screenshotPath = screenshotCache.get(String(req.body?.url || ""));
  const newScore = await scoreContent(newText, screenshotPath);
  const currentScore = req.body?.current_score || {};
  const delta = round4(newScore.overall_score - Number(currentScore.overall_score || 0));
  res.json({
    new_score: newScore,
    score_delta: delta,
    accepted: delta > 0,
    new_text: newText,
  });
}));

app.post("/gaze-analysis", asyncRoute(async (req, res) => {
  const url = String(req.body?.url || "");
  let screenshotPath = String(req.body?.screenshot_path || "");
  if (!screenshotPath && url) screenshotPath = screenshotCache.get(url) || "";
  if (!screenshotPath && url) {
    const capture = await captureUrl(normalizeUrl(url), await makeRunDir(`gaze-${crypto.randomUUID()}`));
    screenshotPath = capture.screenshotPath;
    screenshotCache.set(url, screenshotPath);
  }
  const gaze = screenshotPath && fs.existsSync(screenshotPath)
    ? await createGazePrediction(screenshotPath, path.join(path.dirname(screenshotPath), "gaze-overlay.png"))
    : null;
  res.json({
    salient_regions: gaze?.regions || [],
    gaze_regions: gaze?.regions || [],
    heatmap_overlay_base64: gaze ? await fileBase64(gaze.overlayPath) : "",
    gaze_live: true,
    scanpath_embedded: Boolean(gaze),
  });
}));

app.post("/score-brain-regions", asyncRoute(async (req, res) => {
  const screenshotPath = String(req.body?.screenshot_path || "") || screenshotCache.get(String(req.body?.url || "")) || "";
  const score = await scoreContent("", screenshotPath);
  res.json({
    regions: score.atlas_regions,
    categories: {},
    ethics_flags: evaluateEthics(score.atlas_regions),
  });
}));

app.post("/export", (req, res) => {
  const components = Array.isArray(req.body?.components) ? req.body.components : [];
  const html = exportHtml(components);
  res.setHeader("Content-Disposition", "attachment; filename=visual_cortex_flow_export.html");
  res.type("html").send(html);
});

app.post("/upload-html", upload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ detail: "HTML file is required" });
    return;
  }
  const filename = req.file.originalname || "upload.html";
  const html = decodeBuffer(req.file.buffer);
  const workDir = await makeRunDir(`upload-${crypto.randomUUID()}`);
  const capture = await renderHtml(html, workDir);
  const score = await scoreContent(capture.text, capture.screenshotPath);
  const gaze = await createGazePrediction(capture.screenshotPath, path.join(workDir, "gaze-overlay.png"));
  res.json({
    html_content: html,
    filename,
    screenshot_base64: await fileBase64(capture.screenshotPath),
    heatmap_overlay_base64: await fileBase64(gaze.overlayPath),
    page_score: score,
    salient_regions: gaze.regions,
    gaze_live: true,
    scanpath_embedded: true,
  });
}));

app.post("/optimize-html", asyncRoute(async (req, res) => {
  const html = String(req.body?.html_content || "");
  const filename = String(req.body?.filename || "upload.html");
  const maxIterations = clampInt(req.body?.max_iterations, 1, 20, 10);
  const job = createJob(`[html:${filename}]`, maxIterations);
  void runHtmlOptimization(job, html, filename);
  res.json({ job_id: job.job_id });
}));

app.get("/html-job/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ detail: "Job not found" });
    return;
  }
  if (job.status !== "complete") {
    res.status(202).json({ detail: "Job still running" });
    return;
  }
  const html = String(job.result?.optimized_html || "");
  if (!html) {
    res.status(404).json({ detail: "No optimized HTML in result" });
    return;
  }
  const filename = String(job.result?.filename || "optimized.html").replace(/\.html?$/i, "");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}_visual_cortex_flow.html"`);
  res.type("html").send(html);
});

app.post("/image-chat", asyncRoute(async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ detail: "message is required" });
    return;
  }
  res.json(await generateImage(message, {
    size: String(req.body?.size || "1024x1024"),
    quality: String(req.body?.quality || "medium"),
    outputFormat: String(req.body?.output_format || "png"),
  }));
}));

app.post("/vision-chat", upload.single("screenshot"), asyncRoute(async (req, res) => {
  const message = String(req.body?.message || "").trim();
  const screenshot = req.file;
  if (!message && !screenshot) {
    res.status(400).json({ detail: "message or screenshot is required" });
    return;
  }

  const workDir = await makeRunDir(`vision-${crypto.randomUUID()}`);
  const warnings: string[] = [];
  const imagesForModel: VisionImage[] = [];
  let sourceImageBase64 = "";
  let saliencyOverlayBase64 = "";
  let saliency: SaliencyResult | null = null;
  let neuralRegions: RegionMap | null = null;
  let neuralEncoderSource = "local";
  let screenshotPath = "";

  if (screenshot) {
    screenshotPath = path.join(workDir, "screenshot.png");
    await fsp.writeFile(screenshotPath, screenshot.buffer);
    sourceImageBase64 = await fileBase64(screenshotPath);
    saliency = await createSaliencyOverlay(screenshotPath, path.join(workDir, "screenshot-overlay.png"));
    saliencyOverlayBase64 = await fileBase64(saliency.overlayPath);
    imagesForModel.push({ path: screenshotPath, mime: "image/png", label: "pasted screenshot" });

    const remote = await tryNeuralEncoder(screenshotPath, message);
    if (remote.regions) {
      neuralRegions = remote.regions;
      neuralEncoderSource = remote.source;
    } else if (remote.warning) {
      warnings.push(remote.warning);
    }
  }

  if (!neuralRegions && screenshotPath) {
    neuralRegions = await localRegions(message, screenshotPath);
  }

  const answer = await analyzeVisionChat({
    message,
    images: imagesForModel,
    saliency,
    neuralRegions,
    warnings,
  });

  res.json({
    provider: "vision-chat",
    text: answer.text,
    response_id: answer.response_id,
    source_image_base64: sourceImageBase64,
    saliency_overlay_base64: saliencyOverlayBase64,
    saliency: saliency ? {
      width: saliency.width,
      height: saliency.height,
      hotspots: saliency.hotspots,
    } : null,
    neural_regions: neuralRegions ? Object.fromEntries(Object.entries(neuralRegions).map(([k, v]) => [k, round4(v)])) : null,
    neural_encoder_source: neuralRegions ? neuralEncoderSource : "none",
    warnings,
  });
}));

async function runUrlOptimization(job: JobState, intent: string) {
  try {
    const workDir = await makeRunDir(job.job_id);
    emit(job, "progress", { status: "scraping", message: "Rendering page with Node Playwright...", iteration_count: 0, max_iterations: job.max_iterations });
    const capture = await captureUrl(job.url, workDir);
    screenshotCache.set(job.url, capture.screenshotPath);
    job.beforeScreenshot = capture.screenshotPath;
    job.afterScreenshot = path.join(workDir, "after.png");
    await fsp.copyFile(capture.screenshotPath, job.afterScreenshot);
    const gaze = await createGazePrediction(capture.screenshotPath, path.join(workDir, "gaze-overlay.png"));

    emit(job, "gaze", {
      status: "gaze_analysis",
      gaze_regions: gaze.regions,
      annotated_screenshot_base64: await fileBase64(gaze.overlayPath),
      gaze_live: true,
      scanpath_embedded: true,
      iteration_count: 0,
      max_iterations: job.max_iterations,
    });
    const baselineScore = await scoreContent(capture.text, capture.screenshotPath);
    emit(job, "progress", {
      status: "baseline",
      message: `Baseline overall: ${baselineScore.overall_score.toFixed(4)}`,
      score: baselineScore,
      iteration_count: 0,
      max_iterations: job.max_iterations,
      annotated_screenshot_base64: await fileBase64(gaze.overlayPath),
      scanpath_embedded: true,
    });
    emit(job, "brain_regions", {
      iteration_count: 0,
      regions: baselineScore.atlas_regions,
      ethics_flags: evaluateEthics(baselineScore.atlas_regions),
      intent,
      is_baseline: true,
    });

    let currentText = capture.text;
    let currentScore = baselineScore;
    const history: Record<string, unknown>[] = [];
    const acceptedEdits: Record<string, unknown>[] = [];
    for (let step = 1; step <= job.max_iterations; step++) {
      job.current_iteration = step;
      const edit = localTextEdit(currentText, step);
      emit(job, "progress", {
        status: "proposing",
        message: `[${step}/${job.max_iterations}] Local Node optimizer proposing edit...`,
        iteration_count: step,
        max_iterations: job.max_iterations,
        epsilon: 0,
        strategy: "local-saliency",
        action_type: edit.action_type,
      });
      const original = String(edit.original || "");
      const replacement = String(edit.replacement || "");
      const updatedText = original && currentText.includes(original) ? currentText.replace(original, replacement) : currentText;

      emit(job, "progress", { status: "scoring", message: `[${step}/${job.max_iterations}] Scoring updated content...`, iteration_count: step, max_iterations: job.max_iterations });
      const newScore = await scoreContent(updatedText, capture.screenshotPath);
      const scoreDelta = round4(newScore.overall_score - currentScore.overall_score);
      const roiDeltas = {
        language: round4(newScore.language_roi - currentScore.language_roi),
        attention: round4(newScore.attention_roi - currentScore.attention_roi),
        visual: round4(newScore.visual_roi - currentScore.visual_roi),
      };
      const defaultAccept = scoreDelta > 0 || step === 1;
      emit(job, "progress", {
        status: "approval_needed",
        message: `[${step}/${job.max_iterations}] Review proposed ${humanizeActionType(String(edit.action_type || "edit"))}`,
        iteration_count: step,
        max_iterations: job.max_iterations,
        edit,
        action_type: String(edit.action_type || "unknown"),
        reward: scoreDelta,
        score: newScore,
        current_score: currentScore,
        roi_deltas: roiDeltas,
        default_decision: defaultAccept ? "accept" : "reject",
        target: "visible page copy",
      });
      const accepted = await waitForDecision(job, step, defaultAccept);
      if (accepted) {
        currentText = updatedText;
        currentScore = newScore;
        acceptedEdits.push({ ...edit, iteration: step, reward: scoreDelta, roi_deltas: roiDeltas });
      }
      job.iterationScreenshots[step] = capture.screenshotPath;

      const record = {
        iteration_count: step,
        edit,
        action_type: String(edit.action_type || "unknown"),
        reward: scoreDelta,
        score: currentScore,
        candidate_score: newScore,
        accepted,
        roi_deltas: roiDeltas,
      };
      history.push(record);
      emit(job, "progress", { status: "iteration_complete", message: accepted ? "Accepted edit" : "Rejected edit", ...record, max_iterations: job.max_iterations });
      emit(job, "brain_regions", {
        iteration_count: step,
        regions: currentScore.atlas_regions,
        ethics_flags: evaluateEthics(currentScore.atlas_regions),
        intent,
      });
    }

    completeJob(job, {
      job_id: job.job_id,
      url: job.url,
      baseline_score: baselineScore,
      final_score: currentScore,
      improvement_pct: baselineScore.overall_score ? round4(((currentScore.overall_score - baselineScore.overall_score) / baselineScore.overall_score) * 100) : 0,
      history,
      accepted_edits: acceptedEdits,
      before_screenshot: job.beforeScreenshot,
      after_screenshot: job.afterScreenshot,
      iteration_screenshots: job.iterationScreenshots,
      final_brain_regions: currentScore.atlas_regions,
      ethics_flags: evaluateEthics(currentScore.atlas_regions),
    });
  } catch (err) {
    failJob(job, err);
  }
}

async function runHtmlOptimization(job: JobState, html: string, filename: string) {
  try {
    const workDir = await makeRunDir(job.job_id);
    let currentHtml = html;
    const before = await renderHtml(currentHtml, path.join(workDir, "before"));
    job.beforeScreenshot = before.screenshotPath;
    let currentScore = await scoreContent(before.text, before.screenshotPath);
    const baselineScore = currentScore;
    const gaze = await createGazePrediction(before.screenshotPath, path.join(workDir, "gaze-overlay.png"));
    emit(job, "progress", { status: "baseline", message: `Baseline overall: ${baselineScore.overall_score.toFixed(4)}`, score: baselineScore, iteration_count: 0, max_iterations: job.max_iterations, annotated_screenshot_base64: await fileBase64(gaze.overlayPath), scanpath_embedded: true });
    emit(job, "gaze", { status: "gaze_analysis", gaze_regions: gaze.regions, annotated_screenshot_base64: await fileBase64(gaze.overlayPath), gaze_live: true, scanpath_embedded: true, iteration_count: 0, max_iterations: job.max_iterations });

    const history: Record<string, unknown>[] = [];
    const acceptedEdits: Record<string, unknown>[] = [];
    for (let step = 1; step <= job.max_iterations; step++) {
      const edit = localHtmlEdit(step);
      const candidateHtml = applyHtmlStyle(currentHtml, edit.css);
      const rendered = await renderHtml(candidateHtml, path.join(workDir, `iter-${step}`));
      const newScore = await scoreContent(rendered.text, rendered.screenshotPath);
      const scoreDelta = round4(newScore.overall_score - currentScore.overall_score);
      const roiDeltas = {
        language: round4(newScore.language_roi - currentScore.language_roi),
        attention: round4(newScore.attention_roi - currentScore.attention_roi),
        visual: round4(newScore.visual_roi - currentScore.visual_roi),
      };
      const defaultAccept = scoreDelta >= -0.01;
      emit(job, "progress", {
        status: "approval_needed",
        message: `[${step}/${job.max_iterations}] Review proposed ${humanizeActionType(String(edit.action_type || "HTML edit"))}`,
        iteration_count: step,
        max_iterations: job.max_iterations,
        edit,
        action_type: String(edit.action_type || "unknown"),
        reward: scoreDelta,
        score: newScore,
        current_score: currentScore,
        roi_deltas: roiDeltas,
        default_decision: defaultAccept ? "accept" : "reject",
        target: String(edit.target || "HTML styling"),
      });
      const accepted = await waitForDecision(job, step, defaultAccept);
      if (accepted) {
        currentHtml = candidateHtml;
        currentScore = newScore;
        job.afterScreenshot = rendered.screenshotPath;
        acceptedEdits.push({ ...edit, iteration: step, reward: scoreDelta, roi_deltas: roiDeltas });
      }
      job.iterationScreenshots[step] = rendered.screenshotPath;
      const record = {
        iteration_count: step,
        edit,
        action_type: String(edit.action_type || "unknown"),
        reward: scoreDelta,
        score: currentScore,
        candidate_score: newScore,
        accepted,
        roi_deltas: roiDeltas,
      };
      history.push(record);
      emit(job, "progress", { status: "iteration_complete", message: accepted ? "Accepted HTML edit" : "Rejected HTML edit", ...record, max_iterations: job.max_iterations });
    }
    job.afterScreenshot ||= job.beforeScreenshot;
    completeJob(job, {
      job_id: job.job_id,
      filename,
      baseline_score: baselineScore,
      final_score: currentScore,
      improvement_pct: baselineScore.overall_score ? round4(((currentScore.overall_score - baselineScore.overall_score) / baselineScore.overall_score) * 100) : 0,
      history,
      accepted_edits: acceptedEdits,
      optimized_html: currentHtml,
      before_screenshot: job.beforeScreenshot,
      after_screenshot: job.afterScreenshot,
      iteration_screenshots: job.iterationScreenshots,
      final_brain_regions: currentScore.atlas_regions,
    });
  } catch (err) {
    failJob(job, err);
  }
}

async function captureUrl(url: string, workDir: string): Promise<PageCapture> {
  await fsp.mkdir(workDir, { recursive: true });
  const screenshotPath = path.join(workDir, "screenshot.png");
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
    await prepareFullPageCapture(page);
    const elementBoxes = await captureElementSaliencyBoxes(page);
    await fsp.writeFile(path.join(workDir, "saliency-elements.json"), JSON.stringify(elementBoxes, null, 2));
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText || "");
    const html = await page.evaluate(() => {
      const clone = document.body?.cloneNode(true) as HTMLElement | null;
      if (!clone) return "";
      clone.querySelectorAll("script,style,noscript,iframe,svg,canvas,video,audio").forEach((el) => el.remove());
      return clone.innerHTML.slice(0, 8000);
    });
    return { url, title, text, html, screenshotPath };
  } finally {
    await browser.close();
  }
}

async function renderHtml(html: string, workDir: string): Promise<PageCapture> {
  await fsp.mkdir(workDir, { recursive: true });
  const screenshotPath = path.join(workDir, "screenshot.png");
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    await prepareFullPageCapture(page);
    const elementBoxes = await captureElementSaliencyBoxes(page);
    await fsp.writeFile(path.join(workDir, "saliency-elements.json"), JSON.stringify(elementBoxes, null, 2));
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText || "");
    return { url: "html-upload", title, text, html, screenshotPath };
  } finally {
    await browser.close();
  }
}

async function prepareFullPageCapture(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>) {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxY = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    );
    const step = Math.max(450, Math.round(window.innerHeight * 0.8));
    for (let y = 0; y < maxY; y += step) {
      window.scrollTo(0, y);
      await delay(80);
    }
    window.scrollTo(0, 0);
    await delay(180);
  });
}

async function captureElementSaliencyBoxes(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>): Promise<ElementSaliencyBox[]> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth || 1280;
    const pageHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    );
    const selector = [
      "h1", "h2", "h3", "h4",
      "p", "li", "blockquote",
      "button", "a", "[role='button']",
      "[class*='card']", "[class*='stat']", "[class*='price']", "[class*='feature']",
      "img",
    ].join(",");
    const boxes: ElementSaliencyBox[] = [];
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") < 0.08) continue;
      if (rect.width < 18 || rect.height < 8) continue;
      const x = Math.max(0, rect.left + window.scrollX);
      const y = Math.max(0, rect.top + window.scrollY);
      const width = Math.min(viewportWidth - x, rect.width);
      const height = Math.min(pageHeight - y, rect.height);
      if (width < 18 || height < 8) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      const tag = el.tagName.toLowerCase();
      const className = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.toLowerCase() : "";
      const isFooter = Boolean(el.closest("footer")) || y > pageHeight * 0.72;
      const isNav = Boolean(el.closest("nav,header")) || y < 95;
      const key = `${Math.round(x / 4)},${Math.round(y / 4)},${Math.round(width / 4)},${Math.round(height / 4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let weight = 0.35;
      let kind = "text";
      if (/^h[1-4]$/.test(tag)) {
        weight = tag === "h1" ? 1.0 : tag === "h2" ? 0.92 : 0.78;
        kind = "heading";
      } else if (tag === "button" || el.getAttribute("role") === "button" || /btn|button|cta/.test(className)) {
        weight = 0.94;
        kind = "action";
      } else if (tag === "a") {
        weight = 0.62;
        kind = "link";
      } else if (/card|feature|stat|price|metric|testimonial/.test(className)) {
        weight = 0.70;
        kind = "card";
      } else if (tag === "img") {
        weight = 0.50;
        kind = "image";
      }
      if (/\d|%|\$|rating|customers|clients|advisor|contact|pricing|plan/i.test(text)) weight += 0.14;
      if (text.length >= 24 && text.length <= 180) weight += 0.12;
      if (isNav && !/^h[1-4]$/.test(tag)) weight *= 0.16;
      if (isFooter && !/contact|email|office|address|headquarters|terms/i.test(text)) weight *= 0.18;
      if (isFooter && tag === "a") weight *= 0.34;
      if (text.length > 220) weight *= 0.18;
      if (!text && tag !== "img") weight *= 0.30;
      if (width > viewportWidth * 0.82 && height > 240) weight *= 0.45;
      if (height > 280) weight *= 0.55;
      if (weight < 0.18) continue;

      boxes.push({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(Math.min(width, viewportWidth)),
        height: Math.round(Math.min(height, 180)),
        weight: Math.max(0.08, Math.min(1.15, weight)),
        kind,
      });
    }
    return boxes
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 90);
  });
}

async function launchChromium() {
  const executablePath = findChromeExecutable();
  return chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-gpu"],
  });
}

function findChromeExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_EXECUTABLE_PATH;
  const candidates = [
    configured,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : "",
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Microsoft\\Edge\\Application\\msedge.exe") : "",
    process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft\\Edge\\Application\\msedge.exe") : "",
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function scoreContent(text: string, screenshotPath?: string): Promise<Score> {
  const regions = await localRegions(text, screenshotPath);
  const ffa = regions.FFA;
  const v4 = regions.V4;
  const mt = regions["MT+"];
  const hip = regions.Hippocampus;
  const pfc = regions.PFC;
  const acc = regions.ACC;
  const amyg = regions.Amygdala;
  const ins = regions.Insula;
  const nacc = regions.NAcc;
  const visual = clamp01(0.45 * v4 + 0.35 * ffa + 0.20 * mt);
  const attention = clamp01(0.30 * ffa + 0.25 * v4 + 0.15 * mt + 0.20 * nacc + 0.10 * pfc);
  const language = clamp01(0.55 * pfc + 0.30 * hip + 0.15 * ffa);
  const penalty = 0.55 * amyg + 0.30 * ins + 0.15 * acc;
  const textBonus = Math.min(0.05, Math.max(0, text.split(/\s+/).filter(Boolean).length / 2000));
  const overall = clamp01(0.36 * attention + 0.34 * language + 0.30 * visual - 0.35 * penalty + textBonus);
  return {
    overall_score: round4(overall),
    visual_score: round4(visual),
    text_score: round4(language),
    audio_score: 0.3,
    language_roi: round4(language),
    attention_roi: round4(attention),
    visual_roi: round4(visual),
    atlas_regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, round4(v)])),
  };
}

async function localRegions(text: string, screenshotPath?: string): Promise<RegionMap> {
  const words = text.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.min(1, Math.log1p(words) / Math.log1p(500));
  const punch = Math.max(0, 1 - words / 200);
  const regions: RegionMap = {
    FFA: 0.4,
    V4: 0.4,
    "MT+": 0.35,
    Hippocampus: 0.3 + 0.5 * lengthFactor,
    PFC: 0.45 + 0.2 * lengthFactor,
    ACC: 0.35 + 0.1 * (1 - lengthFactor),
    Amygdala: 0.3,
    Insula: 0.3,
    NAcc: 0.35 + 0.3 * punch,
  };
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return regions;

  try {
    const png = PNG.sync.read(await fsp.readFile(screenshotPath));
    let bright = 0;
    let contrastAccum = 0;
    let sat = 0;
    let whitespace = 0;
    const sampleStep = Math.max(1, Math.floor((png.width * png.height) / 12000));
    const lumas: number[] = [];
    for (let pixel = 0; pixel < png.width * png.height; pixel += sampleStep) {
      const idx = pixel * 4;
      const r = png.data[idx] / 255;
      const g = png.data[idx + 1] / 255;
      const b = png.data[idx + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumas.push(luma);
      bright += luma;
      sat += saturation(r, g, b);
      if (luma > 0.9) whitespace += 1;
    }
    const n = Math.max(1, lumas.length);
    bright /= n;
    sat /= n;
    whitespace /= n;
    for (const l of lumas) contrastAccum += Math.pow(l - bright, 2);
    const contrast = Math.min(1, Math.sqrt(contrastAccum / n) * 3);
    const visual = clamp01(0.25 + 0.45 * sat + 0.30 * contrast);
    const clarity = clamp01(0.35 + 0.35 * whitespace + 0.25 * contrast);
    const density = clamp01((1 - whitespace) * 0.65 + sat * 0.35);
    const reward = clamp01(0.30 + 0.35 * contrast + 0.25 * bright);
    regions.FFA = Math.max(regions.FFA, 0.35 + 0.15 * contrast);
    regions.V4 = visual;
    regions["MT+"] = Math.max(regions["MT+"], 0.30 + 0.25 * contrast);
    regions.PFC = Math.max(regions.PFC, clarity);
    regions.ACC = 0.25 + 0.35 * density;
    regions.Amygdala = 0.22 + 0.25 * Math.max(0, sat - whitespace);
    regions.Insula = 0.22 + 0.40 * density;
    regions.NAcc = Math.max(regions.NAcc, reward);
  } catch {
    return regions;
  }
  return regions;
}

function localTextEdit(text: string, step: number): Record<string, unknown> {
  const lines = text.split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.split(/\s+/).length >= 5 && line.length <= 180);
  const original = lines.length ? lines[(step - 1) % lines.length] : "";
  const replacement = tightenCopy(original);
  return {
    action_type: ["rewrite_headline", "simplify_language", "strengthen_value_prop"][step % 3],
    target: original ? "visible page copy" : "local fallback",
    html_selector: "",
    original,
    replacement,
    reasoning: "TypeScript local optimizer tightened copy while preserving meaning.",
    expected_roi_impact: { language: 0.02, attention: 0.01, visual: 0 },
    expected_roi: "language_roi",
  };
}

function tightenCopy(original: string): string {
  if (!original) return "";
  const words = original.split(/\s+/);
  if (words.length > 18) return `${words.slice(0, 18).join(" ").replace(/[.,;:]$/, "")}.`;
  const replacements: Array<[RegExp, string]> = [
    [/\bcomprehensive\b/gi, "focused"],
    [/\bsolutions\b/gi, "tools"],
    [/\butilize\b/gi, "use"],
    [/\bseeking to\b/gi, "ready to"],
    [/\boptimize\b/gi, "improve"],
    [/\boperational performance\b/gi, "daily performance"],
  ];
  let revised = original;
  for (const [pattern, replacement] of replacements) revised = revised.replace(pattern, replacement);
  if (revised !== original) return revised;
  const base = original.replace(/[.,;:]$/, "");
  if (words.length >= 8) return `${base} with a clearer next step.`;
  if (words.length >= 5) return `${base} that people can trust.`;
  return revised;
}

function localHtmlEdit(step: number) {
  const variants = [
    { action_type: "improve_font_contrast", target: "body", css: "body{color:#111827;background:#ffffff;line-height:1.65;}" },
    { action_type: "increase_cta_size", target: "buttons and links", css: "button,a[role='button'],.btn,.cta{font-weight:700;padding:0.9rem 1.25rem;border-radius:8px;}" },
    { action_type: "add_whitespace", target: "sections", css: "section,main,article{padding-top:2rem;padding-bottom:2rem;}" },
    { action_type: "highlight_cta_section", target: "primary actions", css: ".cta,button[type='submit']{box-shadow:0 10px 24px rgba(79,70,229,.18);}" },
  ];
  const chosen = variants[(step - 1) % variants.length];
  return { ...chosen, reasoning: "TypeScript local HTML edit for clearer visual hierarchy.", expected_roi_impact: { language: 0, attention: 0.01, visual: 0.02 } };
}

function applyHtmlStyle(html: string, css: string): string {
  const style = `<style data-visual-cortex-flow-node>${css}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return `<!doctype html><html><head>${style}</head><body>${html}</body></html>`;
}

async function analyzeVisionChat(args: {
  message: string;
  images: VisionImage[];
  saliency: SaliencyResult | null;
  neuralRegions: RegionMap | null;
  warnings: string[];
}) {
  const key = process.env.OPENAI_API_KEY;
  const fallback = localVisionAnswer(args);
  if (!key || !envBool("OPENAI_LIVE", true)) {
    return { text: fallback, response_id: "" };
  }

  const prompt = [
    "You are Visual Cortex Flow Vision Chat. Analyze pasted website screenshots.",
    "Use the visual evidence first.",
    "Explain what the user is looking at, what attracts attention, what likely hurts comprehension or conversion, and what concrete UI/content changes would help.",
    "Be direct and practical. Do not claim clinical or scientific certainty.",
    args.message ? `User question: ${args.message}` : "User question: analyze the visual content.",
    args.saliency ? `Local visual saliency hotspots:\n${args.saliency.hotspots.map((h) => `#${h.rank} x=${h.x} y=${h.y} w=${h.width} h=${h.height} score=${h.score}`).join("\n")}` : "",
    args.neuralRegions ? `Neural region estimates:\n${Object.entries(args.neuralRegions).map(([k, v]) => `${k}: ${round4(v)}`).join("\n")}` : "",
    args.warnings.length ? `Pipeline warnings:\n${args.warnings.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const images = args.images.slice(0, 10);
  try {
    return await callResponsesVision(prompt, images);
  } catch (firstErr) {
    try {
      return await callChatCompletionsVision(prompt, images);
    } catch (secondErr) {
      const first = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const second = secondErr instanceof Error ? secondErr.message : String(secondErr);
      args.warnings.push(`OpenAI vision failed; using local answer. Responses: ${first}; chat fallback: ${second}`);
      return { text: fallback, response_id: "" };
    }
  }
}

async function callResponsesVision(prompt: string, images: VisionImage[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
  for (const image of images) {
    content.push({
      type: "input_text",
      text: `${image.label}${image.time != null ? ` at ${image.time}s` : ""}`,
    });
    content.push({
      type: "input_image",
      image_url: await imageDataUrl(image.path, image.mime),
      detail: "high",
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [{ role: "user", content }],
      max_output_tokens: 900,
    }),
  });
  const bodyText = await response.text();
  const data = safeJson(bodyText);
  if (!response.ok) throw new Error(data?.error?.message || bodyText || "OpenAI Responses vision failed");
  return {
    text: extractResponseText(data) || "I analyzed the visual input, but the model returned no text.",
    response_id: String(data?.id || ""),
  };
}

async function callChatCompletionsVision(prompt: string, images: VisionImage[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({
      type: "text",
      text: `${image.label}${image.time != null ? ` at ${image.time}s` : ""}`,
    });
    content.push({
      type: "image_url",
      image_url: { url: await imageDataUrl(image.path, image.mime), detail: "high" },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You are a concise visual UX analyst." },
        { role: "user", content },
      ],
      max_tokens: 900,
    }),
  });
  const bodyText = await response.text();
  const data = safeJson(bodyText);
  if (!response.ok) throw new Error(data?.error?.message || bodyText || "OpenAI chat vision failed");
  return {
    text: String(data?.choices?.[0]?.message?.content || "").trim() || "I analyzed the visual input, but the model returned no text.",
    response_id: String(data?.id || ""),
  };
}

async function imageDataUrl(filePath: string, mime: string) {
  return `data:${mime};base64,${await fileBase64(filePath)}`;
}

function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const chunks: string[] = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
      if (typeof part?.output_text === "string") chunks.push(part.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function localVisionAnswer(args: {
  message: string;
  images: VisionImage[];
  saliency: SaliencyResult | null;
  neuralRegions: RegionMap | null;
  warnings: string[];
}) {
  const lines = [
    "I processed the visual input locally.",
    args.images.length ? `Screenshots available: ${args.images.length}.` : "No screenshot was attached.",
    args.saliency?.hotspots?.length
      ? `Strongest saliency hotspots: ${args.saliency.hotspots.slice(0, 3).map((h) => `#${h.rank} (${h.x},${h.y}) score ${h.score}`).join("; ")}.`
      : "",
    args.neuralRegions ? `Estimated attention=${round4((args.neuralRegions.FFA + args.neuralRegions.V4 + args.neuralRegions.NAcc) / 3)} visual=${round4(args.neuralRegions.V4)} language=${round4(args.neuralRegions.PFC)}.` : "",
    "Open the overlay image to inspect where visual contrast and edges are pulling attention.",
  ].filter(Boolean);
  return lines.join("\n");
}

async function createSaliencyOverlay(inputPng: string, outputPng: string): Promise<SaliencyResult> {
  const png = PNG.sync.read(await fsp.readFile(inputPng));
  const { width, height, data } = png;
  const cell = Math.max(8, Math.round(Math.min(width, height) / 80));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const stats = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    count: 0,
    luma: 0,
    lumaSq: 0,
    sat: 0,
  })));

  const sample = Math.max(1, Math.round(Math.sqrt((width * height) / 220_000)));
  let globalLuma = 0;
  let globalCount = 0;
  for (let y = 0; y < height; y += sample) {
    for (let x = 0; x < width; x += sample) {
      const idx = (y * width + x) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s = saturation(r, g, b);
      const bucket = stats[Math.floor(y / cell)][Math.floor(x / cell)];
      bucket.count += 1;
      bucket.luma += luma;
      bucket.lumaSq += luma * luma;
      bucket.sat += s;
      globalLuma += luma;
      globalCount += 1;
    }
  }
  globalLuma /= Math.max(1, globalCount);

  const lumaGrid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  const rawGrid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  let maxRaw = 0.0001;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bucket = stats[r][c];
      const n = Math.max(1, bucket.count);
      const mean = bucket.luma / n;
      const variance = Math.max(0, bucket.lumaSq / n - mean * mean);
      const satMean = bucket.sat / n;
      lumaGrid[r][c] = mean;
      const centerX = (c + 0.5) / cols - 0.5;
      const centerY = (r + 0.5) / rows - 0.45;
      const centerBias = Math.exp(-(centerX * centerX + centerY * centerY) / 0.20);
      const contrast = Math.abs(mean - globalLuma);
      const detail = Math.sqrt(variance) * 2.5;
      const score = 0.28 * satMean + 0.30 * contrast + 0.24 * detail + 0.18 * centerBias;
      rawGrid[r][c] = score;
      maxRaw = Math.max(maxRaw, score);
    }
  }

  const smoothGrid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  let maxSmooth = 0.0001;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let total = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const rr = r + dy;
          const cc = c + dx;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const w = dx === 0 && dy === 0 ? 2 : 1;
          total += rawGrid[rr][cc] * w;
          weight += w;
        }
      }
      const neighborEdge = (
        Math.abs(lumaGrid[r][c] - (lumaGrid[r]?.[c - 1] ?? lumaGrid[r][c])) +
        Math.abs(lumaGrid[r][c] - (lumaGrid[r]?.[c + 1] ?? lumaGrid[r][c])) +
        Math.abs(lumaGrid[r][c] - (lumaGrid[r - 1]?.[c] ?? lumaGrid[r][c])) +
        Math.abs(lumaGrid[r][c] - (lumaGrid[r + 1]?.[c] ?? lumaGrid[r][c]))
      ) / 4;
      const normalized = clamp01((total / weight) / maxRaw + 0.18 * neighborEdge);
      smoothGrid[r][c] = normalized;
      maxSmooth = Math.max(maxSmooth, normalized);
    }
  }

  const hotspots = topHotspots(smoothGrid, cell, width, height);
  const elementBoxes = await readElementSaliencyBoxes(inputPng);
  const elementHotspots = elementBoxes.map((box, index) => ({
    rank: 1000 + index,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    score: box.weight,
  }));
  const heatSources = [
    ...elementHotspots.slice(0, 54),
    ...hotspots.slice(0, elementHotspots.length ? 16 : 34),
  ];
  const out = new PNG({ width, height });
  const sampleField = (px: number, py: number) => {
    const gx = px / cell - 0.5;
    const gy = py / cell - 0.5;
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
    const c1 = Math.max(0, Math.min(cols - 1, c0 + 1));
    const r1 = Math.max(0, Math.min(rows - 1, r0 + 1));
    const tx = clamp01(gx - c0);
    const ty = clamp01(gy - r0);
    const a = smoothGrid[r0]?.[c0] ?? 0;
    const b = smoothGrid[r0]?.[c1] ?? a;
    const c = smoothGrid[r1]?.[c0] ?? a;
    const d = smoothGrid[r1]?.[c1] ?? c;
    const top = a * (1 - tx) + b * tx;
    const bottom = c * (1 - tx) + d * tx;
    return top * (1 - ty) + bottom * ty;
  };

  const heat = new Float32Array(width * height);
  for (const hotspot of heatSources) {
    const cx = hotspot.x + hotspot.width / 2;
    const cy = hotspot.y + hotspot.height / 2;
    const isElement = hotspot.rank >= 1000;
    const rx = isElement
      ? Math.max(64, Math.min(300, hotspot.width * 0.42))
      : Math.max(56, hotspot.width * 1.22);
    const ry = isElement
      ? Math.max(38, Math.min(116, hotspot.height * 1.55))
      : Math.max(34, hotspot.height * 0.92);
    const x1 = Math.max(0, Math.floor(cx - rx * 3.1));
    const x2 = Math.min(width - 1, Math.ceil(cx + rx * 3.1));
    const y1 = Math.max(0, Math.floor(cy - ry * 3.1));
    const y2 = Math.min(height - 1, Math.ceil(cy + ry * 3.1));

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const angle = Math.atan2(dy, dx);
        const wobble =
          1 +
          0.08 * Math.sin(angle * 3.1 + hotspot.rank * 0.9) +
          0.06 * Math.cos(angle * 5.3 + hotspot.x * 0.017) +
          0.04 * Math.sin(angle * 8.0 + hotspot.y * 0.013);
        const radius2 = (dx * dx + dy * dy) / Math.max(0.58, wobble * wobble);
        if (radius2 > 10.5) continue;
        const field = sampleField(x, y);
        const contour = 0.92 + 0.08 * softNoise(x * 0.030, y * 0.030, hotspot.rank);
        const contentPull = 0.72 + 0.34 * clamp01((field - 0.36) / 0.64);
        const halo = Math.exp(-radius2 * (isElement ? 1.12 : 1.58)) * (isElement ? 0.18 : 0.12);
        const mid = Math.exp(-radius2 * (isElement ? 2.18 : 3.1)) * (isElement ? 0.30 : 0.24);
        const core = Math.exp(-radius2 * (isElement ? 5.7 : 7.4)) * (0.25 + hotspot.score * 0.42) * contentPull;
        const local = clamp01((halo + mid + core) * contour);
        const heatIdx = y * width + x;
        heat[heatIdx] = 1 - (1 - heat[heatIdx]) * (1 - local);
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const idx = pixel * 4;
      const baseR = data[idx];
      const baseG = data[idx + 1];
      const baseB = data[idx + 2];
      const glow = clamp01(Math.pow(heat[pixel] * 1.02, 0.90));
      const [hr, hg, hb] = heatColor(glow);
      const dimR = baseR * 0.50 + 82 * 0.50;
      const dimG = baseG * 0.50 + 92 * 0.50;
      const dimB = baseB * 0.50 + 170 * 0.50;
      const alpha = glow > 0.035 ? Math.min(0.84, 0.08 + glow * 0.72) : 0;
      out.data[idx] = Math.round(dimR * (1 - alpha) + hr * alpha);
      out.data[idx + 1] = Math.round(dimG * (1 - alpha) + hg * alpha);
      out.data[idx + 2] = Math.round(dimB * (1 - alpha) + hb * alpha);
      out.data[idx + 3] = 255;
    }
  }
  await fsp.writeFile(outputPng, PNG.sync.write(out));
  return { overlayPath: outputPng, width, height, hotspots };
}

async function readElementSaliencyBoxes(inputPng: string): Promise<ElementSaliencyBox[]> {
  const elementPath = path.join(path.dirname(inputPng), "saliency-elements.json");
  try {
    const raw = await fsp.readFile(elementPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((box) => ({
        x: Math.max(0, Number(box.x) || 0),
        y: Math.max(0, Number(box.y) || 0),
        width: Math.max(1, Number(box.width) || 1),
        height: Math.max(1, Number(box.height) || 1),
        weight: clamp01(Number(box.weight) || 0.3),
        kind: String(box.kind || "element"),
      }))
      .filter((box) => box.width >= 18 && box.height >= 8 && box.weight >= 0.16);
  } catch {
    return [];
  }
}

function topHotspots(grid: number[][], cell: number, width: number, height: number): Hotspot[] {
  const candidates: Array<{ r: number; c: number; score: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length || 0); c++) {
      candidates.push({ r, c, score: grid[r][c] });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen: Hotspot[] = [];
  const minDistance = cell * (height > 1100 ? 4.4 : 3.8);
  const addCandidate = (cand: { r: number; c: number; score: number }, minScore: number) => {
    if (cand.score < minScore) return false;
    const x = cand.c * cell;
    const y = cand.r * cell;
    const tooClose = chosen.some((h) => Math.hypot((h.x + h.width / 2) - (x + cell / 2), (h.y + h.height / 2) - (y + cell / 2)) < minDistance);
    if (tooClose) return false;
    chosen.push({
      rank: chosen.length + 1,
      x: Math.max(0, x - cell),
      y: Math.max(0, y - cell),
      width: Math.min(width - Math.max(0, x - cell), cell * 4),
      height: Math.min(height - Math.max(0, y - cell), cell * 3),
      score: round4(cand.score),
    });
    return true;
  };

  const navSkip = Math.min(150, Math.max(80, width * 0.10));
  const usableTop = Math.min(height - 1, navSkip);
  const usableHeight = Math.max(1, height - usableTop);
  const maxHotspots = Math.min(44, Math.max(14, Math.ceil(usableHeight / 150)));
  const bandCount = Math.min(maxHotspots, Math.max(6, Math.ceil(usableHeight / 260)));
  const bandHeight = usableHeight / bandCount;

  for (let band = 0; band < bandCount; band++) {
    const y1 = usableTop + band * bandHeight;
    const y2 = band === bandCount - 1 ? height : y1 + bandHeight;
    const bandCandidates = candidates.filter((cand) => {
      const cy = (cand.r + 0.5) * cell;
      return cy >= y1 && cy < y2;
    });
    for (const cand of bandCandidates) {
      if (addCandidate(cand, 0.055)) break;
    }
  }

  for (const cand of candidates) {
    const cy = (cand.r + 0.5) * cell;
    if (cy < usableTop) continue;
    addCandidate(cand, 0.10);
    if (chosen.length >= maxHotspots) break;
  }

  if (chosen.length < Math.min(6, maxHotspots)) {
    for (const cand of candidates) {
      const cy = (cand.r + 0.5) * cell;
      if (cy < usableTop) continue;
      addCandidate(cand, 0.035);
      if (chosen.length >= Math.min(6, maxHotspots)) break;
    }
  }

  return chosen
    .sort((a, b) => {
      const ay = a.y + a.height / 2;
      const by = b.y + b.height / 2;
      const rowTolerance = Math.max(a.height, b.height, 90);
      if (Math.abs(ay - by) > rowTolerance) return ay - by;
      return (a.x + a.width / 2) - (b.x + b.width / 2);
    })
    .map((hotspot, index) => ({ ...hotspot, rank: index + 1 }));
}

function heatColor(score: number): [number, number, number] {
  const s = clamp01(score);
  if (s < 0.20) {
    const t = s / 0.20;
    return [
      Math.round(94 - 40 * t),
      Math.round(166 + 50 * t),
      255,
    ];
  }
  if (s < 0.38) {
    const t = (s - 0.20) / 0.18;
    return [
      Math.round(54 - 8 * t),
      Math.round(216 + 39 * t),
      Math.round(255 - 70 * t),
    ];
  }
  if (s < 0.60) {
    const t = (s - 0.38) / 0.20;
    return [
      Math.round(46 + 160 * t),
      255,
      Math.round(185 - 126 * t),
    ];
  }
  if (s < 0.80) {
    const t = (s - 0.60) / 0.20;
    return [
      Math.round(206 + 49 * t),
      Math.round(255 - 45 * t),
      Math.round(59 - 34 * t),
    ];
  }
  if (s < 0.94) {
    const t = (s - 0.80) / 0.14;
    return [
      255,
      Math.round(210 - 84 * t),
      Math.round(25 - 9 * t),
    ];
  }
  const t = (s - 0.94) / 0.06;
  return [
    255,
    Math.round(126 - 84 * t),
    Math.round(16 - 10 * t),
  ];
}

function softNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const fade = (t: number) => t * t * (3 - 2 * t);
  const n00 = hashNoise(xi, yi, seed);
  const n10 = hashNoise(xi + 1, yi, seed);
  const n01 = hashNoise(xi, yi + 1, seed);
  const n11 = hashNoise(xi + 1, yi + 1, seed);
  const u = fade(xf);
  const v = fade(yf);
  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;
  return nx0 * (1 - v) + nx1 * v;
}

function hashNoise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

async function tryNeuralEncoder(imagePath: string, text: string): Promise<{ regions: RegionMap | null; source: string; warning?: string }> {
  const endpoint = neuralEncoderEndpoint();
  if (!endpoint) return { regions: null, source: "none" };
  const url = endpoint.endsWith("/encode") ? endpoint : `${endpoint.replace(/\/$/, "")}/encode`;
  const imageBase64 = await fileBase64(imagePath);
  const jsonPayload = { image_base64: imageBase64, text };

  try {
    const data = await postWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(jsonPayload),
    }, 45_000);
    return { regions: extractRegionsFromPayload(data), source: "remote" };
  } catch (jsonErr) {
    try {
      const png = await fsp.readFile(imagePath);
      const data = await postWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "ngrok-skip-browser-warning": "true",
        },
        body: new Uint8Array(png),
      }, 45_000);
      return { regions: extractRegionsFromPayload(data), source: "remote" };
    } catch (rawErr) {
      const first = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
      const second = rawErr instanceof Error ? rawErr.message : String(rawErr);
      return { regions: null, source: "local", warning: `Remote neural encoder unavailable; local saliency used. JSON: ${first}; PNG: ${second}` };
    }
  }
}

function neuralEncoderEndpoint() {
  return String(process.env.NEURAL_ENCODER_ENDPOINT || "").trim();
}

async function postWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    const data = safeJson(body);
    if (!response.ok) throw new Error(data?.error?.message || body || `HTTP ${response.status}`);
    if (!data) throw new Error("response was not JSON");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function extractRegionsFromPayload(payload: any): RegionMap {
  const base = typeof payload?.region_scores === "object" ? payload.region_scores
    : typeof payload?.scores === "object" ? payload.scores
      : typeof payload?.regions === "object" ? payload.regions
        : payload;
  const subValues = typeof payload?.subcortical_estimates?.values === "object"
    ? payload.subcortical_estimates.values
    : {};
  const regions: RegionMap = {};
  for (const key of ["FFA", "V4", "MT+", "PFC", "ACC", "Insula"]) {
    if (Number.isFinite(Number(base?.[key]))) regions[key] = Number(base[key]);
  }
  for (const key of ["Hippocampus", "Amygdala", "NAcc"]) {
    if (Number.isFinite(Number(base?.[key]))) regions[key] = Number(base[key]);
    else if (Number.isFinite(Number(subValues?.[key]))) regions[key] = Number(subValues[key]);
  }
  const required = ["FFA", "V4", "MT+", "Hippocampus", "PFC", "ACC", "Amygdala", "Insula", "NAcc"];
  const missing = required.filter((key) => !Number.isFinite(regions[key]));
  if (missing.length) throw new Error(`encoder response missing regions: ${missing.join(", ")}`);
  return regions;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateImage(message: string, opts: { size: string; quality: string; outputFormat: string }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const payloads = [
    { model, prompt: message, size: opts.size, quality: opts.quality, output_format: opts.outputFormat, response_format: "b64_json" },
    { model, prompt: message, size: opts.size, quality: opts.quality, response_format: "b64_json" },
    { model, prompt: message, size: opts.size, response_format: "b64_json" },
  ];
  let lastError = "";
  for (const payload of payloads) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json() as Record<string, any>;
    if (response.ok) {
      const first = data.data?.[0] || {};
      return {
        response_id: "",
        text: "Generated by the Node/TypeScript backend.",
        image_base64: first.b64_json || "",
        revised_prompt: first.revised_prompt || "",
        provider: "images",
      };
    }
    lastError = data.error?.message || JSON.stringify(data);
  }
  throw new Error(lastError || "OpenAI image generation failed");
}

async function generateAfterScreenshot(job: JobState, sourcePath: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !fs.existsSync(sourcePath)) return null;

  const model = process.env.OPENAI_AFTER_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const prompt = buildAfterImagePrompt(job);
  const generatedPath = path.join(path.dirname(sourcePath), "after-generated.png");
  const sourceBytes = await fsp.readFile(sourcePath);
  const preferredSize = imageEditSizeFor(sourceBytes);

  const formAttempts: Array<Record<string, string>> = [
    { size: preferredSize, quality: "high", input_fidelity: "high", output_format: "png" },
    { size: preferredSize, output_format: "png" },
    { size: "1024x1024" },
  ];
  for (const fields of formAttempts) {
    const path = await tryImageEditForm({ key, model, prompt, sourceBytes, generatedPath, fields });
    if (path) return path;
  }

  const imageBase64 = await fileBase64(sourcePath);
  const payloads = [
    {
      model,
      prompt,
      images: [{ image_url: `data:image/png;base64,${imageBase64}` }],
      input_fidelity: "high",
      size: "auto",
      quality: "medium",
      output_format: "png",
      n: 1,
    },
    {
      model,
      prompt,
      images: [{ image_url: `data:image/png;base64,${imageBase64}` }],
      input_fidelity: "high",
      output_format: "png",
      n: 1,
    },
    {
      model,
      prompt,
      images: [{ image_url: `data:image/png;base64,${imageBase64}` }],
      n: 1,
    },
  ];

  for (const payload of payloads) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as Record<string, any>;
      if (!response.ok) continue;

      const first = data.data?.[0] || {};
      const base64 = String(first.b64_json || first.image_base64 || "");
      if (base64) {
        await fsp.writeFile(generatedPath, Buffer.from(base64, "base64"));
        return generatedPath;
      }

      if (typeof first.url === "string" && first.url) {
        const imageResponse = await fetch(first.url);
        if (!imageResponse.ok) continue;
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        await fsp.writeFile(generatedPath, bytes);
        return generatedPath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function tryImageEditForm(args: {
  key: string;
  model: string;
  prompt: string;
  sourceBytes: Buffer;
  generatedPath: string;
  fields: Record<string, string>;
}) {
  try {
    const form = new FormData();
    form.set("model", args.model);
    form.set("prompt", args.prompt);
    const imageBytes = args.sourceBytes.buffer.slice(
      args.sourceBytes.byteOffset,
      args.sourceBytes.byteOffset + args.sourceBytes.byteLength,
    ) as ArrayBuffer;
    form.set("image", new Blob([imageBytes], { type: "image/png" }), "source.png");
    form.set("n", "1");
    for (const [key, value] of Object.entries(args.fields)) form.set(key, value);
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.key}` },
      body: form,
    });
    const data = await response.json() as Record<string, any>;
    if (!response.ok) return null;
    return await persistGeneratedImage(data, args.generatedPath);
  } catch {
    return null;
  }
}

async function persistGeneratedImage(data: Record<string, any>, generatedPath: string) {
  const first = data.data?.[0] || {};
  const base64 = String(first.b64_json || first.image_base64 || "");
  if (base64) {
    await fsp.writeFile(generatedPath, Buffer.from(base64, "base64"));
    return generatedPath;
  }

  if (typeof first.url === "string" && first.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) return null;
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    await fsp.writeFile(generatedPath, bytes);
    return generatedPath;
  }
  return null;
}

function imageEditSizeFor(sourceBytes: Buffer) {
  try {
    const png = PNG.sync.read(sourceBytes);
    const ratio = png.height / Math.max(1, png.width);
    if (ratio > 1.2) return "1024x1536";
    if (ratio < 0.8) return "1536x1024";
  } catch {
    // Default to square if the source dimensions cannot be read.
  }
  return "1024x1024";
}

function buildAfterImagePrompt(job: JobState) {
  const result = job.result || {};
  const acceptedEdits = Array.isArray(result.accepted_edits) ? result.accepted_edits : [];
  const actionTypes = acceptedEdits
    .map((edit) => {
      const record = edit as Record<string, unknown>;
      return String(record.action_type || (record.edit as Record<string, unknown> | undefined)?.action_type || "");
    })
    .filter(Boolean);
  const uniqueActions = [...new Set(actionTypes)].slice(0, 4);
  const editSummary = uniqueActions.length > 0
    ? `Focus on the accepted edit themes: ${uniqueActions.join(", ")}.`
    : "Follow the optimization intent closely.";
  const improvementPct = Number(result.improvement_pct ?? 0);
  const improvementSummary = Number.isFinite(improvementPct) && improvementPct !== 0
    ? `Preserve the page's content while making it feel like a ${improvementPct > 0 ? "clearer, more effective" : "less cluttered, more focused"} version.`
    : "Preserve the page's content while making it feel more polished and conversion-oriented.";

  return [
    "Improve this webpage screenshot while keeping the same page, brand, logo, and wording intact.",
    "Preserve readable text as much as possible; do not invent phone numbers, email addresses, dates, legal copy, or company names.",
    "Make the hierarchy clearer, spacing cleaner, and primary calls to action more visually dominant.",
    "Keep the result realistic and faithful to the original layout, like a polished web design mockup.",
    editSummary,
    improvementSummary,
  ].join(" ");
}

function parseComponents(text: string) {
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).slice(0, 20).map((block) => {
    const wc = block.split(/\s+/).filter(Boolean).length;
    const firstWords = new Set(block.split(/\s+/).slice(0, 6).map((w) => w.toLowerCase()));
    let type = "body";
    if (wc <= 10 && !block.endsWith(".")) type = "headline";
    else if (wc <= 6 && [...firstWords].some((w) => ["get", "start", "try", "join", "sign", "buy", "learn", "download", "register"].includes(w))) type = "cta";
    else if (/customer|users|clients|review|rating|trusted|testimonial/i.test(block)) type = "testimonial";
    return { id: crypto.randomUUID().slice(0, 8), type, content: block, word_count: wc, neural_contribution: 0.5 };
  });
}

function evaluateEthics(regions: RegionMap) {
  const flags: Array<Record<string, unknown>> = [];
  if ((regions.Amygdala || 0) > 0.6) flags.push({ severity: "warn", code: "amygdala_pressure", message: "High pressure/fear signal detected." });
  if ((regions.NAcc || 0) > 0.75) flags.push({ severity: "warn", code: "reward_overdrive", message: "Reward signal is high; avoid manipulative urgency." });
  if ((regions.Insula || 0) > 0.6) flags.push({ severity: "warn", code: "sensory_overload", message: "Dense or visually loud content may overload users." });
  return flags;
}

async function createGazePrediction(screenshotPath: string, overlayPath: string) {
  const saliency = await createSaliencyOverlay(screenshotPath, overlayPath);
  const orderedHotspots = [...saliency.hotspots]
    .sort((a, b) => {
      const ay = a.y + a.height / 2;
      const by = b.y + b.height / 2;
      const rowTolerance = Math.max(a.height, b.height, 80);
      if (Math.abs(ay - by) > rowTolerance) return ay - by;
      return (a.x + a.width / 2) - (b.x + b.width / 2);
    });
  const targetCount = Math.min(12, Math.max(5, Math.ceil(saliency.height / 650)));
  const pageFlow = spreadHotspotsAcrossPage(orderedHotspots, targetCount);

  const regions = pageFlow.map((hotspot, index) => {
    const x1 = Math.max(0, Math.round(hotspot.x));
    const y1 = Math.max(0, Math.round(hotspot.y));
    const x2 = Math.min(saliency.width, Math.round(hotspot.x + hotspot.width));
    const y2 = Math.min(saliency.height, Math.round(hotspot.y + hotspot.height));
    return {
      rank: index + 1,
      bbox: [x1, y1, x2, y2] as [number, number, number, number],
      peak_coords: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)] as [number, number],
      saliency_score: round4(hotspot.score),
    };
  });

  await drawScanpathOverlay(saliency.overlayPath, regions);

  return {
    overlayPath: saliency.overlayPath,
    regions,
    width: saliency.width,
    height: saliency.height,
  };
}

async function drawScanpathOverlay(imagePath: string, regions: GazeRegion[]) {
  if (regions.length === 0) return;
  const png = PNG.sync.read(await fsp.readFile(imagePath));
  const ordered = [...regions].sort((a, b) => a.rank - b.rank);

  for (let i = 1; i < ordered.length; i++) {
    const [x1, y1] = ordered[i - 1].peak_coords;
    const [x2, y2] = ordered[i].peak_coords;
    drawDashedLine(png, x1, y1, x2, y2, { r: 255, g: 255, b: 255, a: 0.46 }, 1.45);
  }

  for (const region of ordered) {
    const [cx, cy] = region.peak_coords;
    drawCircle(png, cx, cy, 18, { r: 118, g: 64, b: 218, a: 0.88 }, { r: 255, g: 255, b: 255, a: 0.92 });
    drawNumber(png, String(region.rank), cx, cy);
  }

  await fsp.writeFile(imagePath, PNG.sync.write(png));
}

function drawDashedLine(png: PNG, x1: number, y1: number, x2: number, y2: number, color: Rgba, radius: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const dash = 17;
  const gap = 10;
  for (let distance = 0; distance <= length; distance += 1.8) {
    const inDash = (distance % (dash + gap)) < dash;
    if (!inDash) continue;
    const t = distance / length;
    drawSoftDot(png, x1 + dx * t, y1 + dy * t, radius, color);
  }
}

type Rgba = { r: number; g: number; b: number; a: number };

function drawCircle(png: PNG, cx: number, cy: number, radius: number, fill: Rgba, stroke: Rgba) {
  const outer = radius + 2;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= radius - 2) {
        blendPixel(png, x, y, fill);
      } else if (dist <= radius + 1) {
        blendPixel(png, x, y, stroke);
      }
    }
  }
}

function drawSoftDot(png: PNG, cx: number, cy: number, radius: number, color: Rgba) {
  const outer = radius + 1;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > outer) continue;
      const fade = clamp01(1 - dist / outer);
      blendPixel(png, x, y, { ...color, a: color.a * (0.55 + fade * 0.45) });
    }
  }
}

const digitGlyphs: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

function drawNumber(png: PNG, text: string, cx: number, cy: number) {
  const scale = text.length > 1 ? 2 : 3;
  const glyphWidth = 3 * scale;
  const gap = scale;
  const totalWidth = text.length * glyphWidth + Math.max(0, text.length - 1) * gap;
  const totalHeight = 5 * scale;
  let x0 = Math.round(cx - totalWidth / 2);
  const y0 = Math.round(cy - totalHeight / 2);
  for (const char of text) {
    const glyph = digitGlyphs[char];
    if (!glyph) continue;
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== "1") continue;
        for (let yy = 0; yy < scale; yy++) {
          for (let xx = 0; xx < scale; xx++) {
            blendPixel(png, x0 + gx * scale + xx, y0 + gy * scale + yy, { r: 255, g: 255, b: 255, a: 0.98 });
          }
        }
      }
    }
    x0 += glyphWidth + gap;
  }
}

function blendPixel(png: PNG, x: number, y: number, color: Rgba) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
  const idx = (py * png.width + px) * 4;
  const a = clamp01(color.a);
  png.data[idx] = Math.round(png.data[idx] * (1 - a) + color.r * a);
  png.data[idx + 1] = Math.round(png.data[idx + 1] * (1 - a) + color.g * a);
  png.data[idx + 2] = Math.round(png.data[idx + 2] * (1 - a) + color.b * a);
  png.data[idx + 3] = 255;
}

function spreadHotspotsAcrossPage(hotspots: Hotspot[], targetCount: number) {
  if (hotspots.length <= targetCount) return hotspots;
  const selected: Hotspot[] = [];
  const used = new Set<number>();
  const last = hotspots.length - 1;
  for (let i = 0; i < targetCount; i++) {
    const idealIndex = Math.round((i * last) / Math.max(1, targetCount - 1));
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset <= last; offset++) {
      for (const candidateIndex of [idealIndex - offset, idealIndex + offset]) {
        if (candidateIndex < 0 || candidateIndex > last || used.has(candidateIndex)) continue;
        const distance = Math.abs(candidateIndex - idealIndex);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = candidateIndex;
        }
      }
      if (bestIndex !== -1) break;
    }
    if (bestIndex !== -1) {
      used.add(bestIndex);
      selected.push(hotspots[bestIndex]);
    }
  }
  return selected.sort((a, b) => {
    const ay = a.y + a.height / 2;
    const by = b.y + b.height / 2;
    const rowTolerance = Math.max(a.height, b.height, 90);
    if (Math.abs(ay - by) > rowTolerance) return ay - by;
    return (a.x + a.width / 2) - (b.x + b.width / 2);
  });
}

function exportHtml(components: Array<Record<string, unknown>>) {
  const body = components.map((comp) => {
    const content = escapeHtml(String(comp.content || ""));
    const type = String(comp.type || "body");
    if (type === "headline") return `<h1>${content}</h1>`;
    if (type === "cta") return `<p><button>${content}</button></p>`;
    if (type === "testimonial") return `<blockquote>${content}</blockquote>`;
    return `<p>${content}</p>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual Cortex Flow Export</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:0 auto;padding:2rem;line-height:1.65;color:#111827}button{background:#6d28d9;color:white;border:0;border-radius:8px;padding:.8rem 1.2rem;font-weight:700}</style></head><body>${body}</body></html>`;
}

function createJob(url: string, maxIterations: number): JobState {
  const job: JobState = {
    job_id: crypto.randomUUID(),
    url,
    status: "running",
    max_iterations: maxIterations,
    current_iteration: 0,
    events: [],
    clients: new Set(),
    iterationScreenshots: {},
  };
  jobs.set(job.job_id, job);
  return job;
}

function emit(job: JobState, type: string, data: Record<string, unknown>) {
  const event = { type, data };
  job.events.push(event);
  for (const client of job.clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function waitForDecision(job: JobState, iteration: number, defaultAccept: boolean): Promise<boolean> {
  if (job.status !== "running") return Promise.resolve(defaultAccept);
  const timeoutSeconds = clampInt(process.env.DECISION_TIMEOUT_SECONDS, 30, 1800, 600);
  return new Promise((resolve) => {
    if (job.pendingDecision) {
      clearTimeout(job.pendingDecision.timeout);
      job.pendingDecision.resolve(defaultAccept);
    }
    const timeout = setTimeout(() => {
      if (job.pendingDecision?.iteration !== iteration) return;
      job.pendingDecision = undefined;
      emit(job, "progress", {
        status: "decision_timeout",
        message: `No decision received for iteration ${iteration}; using ${defaultAccept ? "accept" : "reject"}.`,
        iteration_count: iteration,
        accept: defaultAccept,
      });
      resolve(defaultAccept);
    }, timeoutSeconds * 1000);
    job.pendingDecision = { iteration, resolve, timeout };
  });
}

function completeJob(job: JobState, result: Record<string, unknown>) {
  if (job.pendingDecision) {
    clearTimeout(job.pendingDecision.timeout);
    job.pendingDecision = undefined;
  }
  const experience = buildJobMemoryExperience(job, result);
  memoryState.experiences.push(experience);
  memoryState.patterns = rebuildLearnedPatterns(memoryState.experiences);
  result.memory_count = memoryState.patterns.length;
  result.discovered_patterns = memoryState.patterns.length;
  result.experience_count = memoryState.experiences.length;
  persistMemoryState();
  job.status = "complete";
  job.result = result;
  emit(job, "complete", result);
  closeClients(job);
}

function failJob(job: JobState, err: unknown) {
  if (job.pendingDecision) {
    clearTimeout(job.pendingDecision.timeout);
    job.pendingDecision = undefined;
  }
  job.status = "error";
  job.error = err instanceof Error ? err.message : String(err);
  emit(job, "error", { message: job.error });
  closeClients(job);
}

function closeClients(job: JobState) {
  for (const client of job.clients) client.end();
  job.clients.clear();
}

async function sendJobImage(req: Request, res: Response, which: "before" | "after") {
  const job = jobs.get(req.params.id);
  let file = which === "before" ? job?.beforeScreenshot : job?.generatedAfterScreenshot || job?.afterScreenshot;
  if (which === "after" && !job?.generatedAfterScreenshot && job?.afterScreenshot && fs.existsSync(job.afterScreenshot)) {
    const generatedPath = await generateAfterScreenshot(job, job.afterScreenshot);
    if (generatedPath) {
      job.generatedAfterScreenshot = generatedPath;
      if (job.result && typeof job.result === "object") {
        job.result.generated_after_screenshot = generatedPath;
      }
      file = generatedPath;
    } else {
      file = job.afterScreenshot;
    }
  }
  if (!file || !fs.existsSync(file)) {
    res.status(404).json({ detail: "Screenshot not available" });
    return;
  }
  res.type("png").sendFile(file);
}

async function makeRunDir(name: string) {
  const dir = path.join(runsDir, name);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function fileBase64(file: string) {
  return (await fsp.readFile(file)).toString("base64");
}

function decodeBuffer(buffer: Buffer) {
  return buffer.toString("utf8");
}

function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("url is required");
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!url.includes(".")) throw new Error(`Invalid URL: ${raw}`);
  return url;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envBool(key: string, fallback: boolean) {
  const value = process.env[key];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
}

const port = Number(process.env.PORT || 8080);
app.listen(port, "127.0.0.1", () => {
  console.log(`Visual Cortex Flow Node backend listening on http://127.0.0.1:${port}`);
});
