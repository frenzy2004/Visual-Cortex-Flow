# Visual Cortex Flow

Visual Cortex Flow is an attention-aware web optimization lab. It renders a target page, builds a visual saliency map, simulates an optimizer reviewing page changes, and gives you a before/after workspace for improving copy, hierarchy, and layout.

It is built for fast demos and hackathon workflows: paste a screenshot, analyze a live website, upload HTML, inspect gaze-style heatmaps, approve or reject optimization proposals, and export the improved page.

## What It Does

- **URL optimization**: render any reachable webpage with Playwright and run iterative scoring passes.
- **HTML optimization**: upload a local HTML file, render it, score it, and export the optimized result.
- **Visual saliency overlays**: generate heatmaps, scan paths, contour-like hotspots, and ranked attention regions.
- **Screenshot chat**: paste or upload a screenshot and ask the vision assistant what stands out.
- **Optimizer view**: watch the run stream, score chart, gaze events, and cortex-region estimates while other tabs stay usable.
- **Build workspace**: parse a page into editable blocks, score the layout, optimize individual sections, and export HTML.
- **Pattern memory**: learn simple correlations from accepted/rejected edits and expose them in the Patterns tab.

## App Screens

| Area | Purpose |
| --- | --- |
| Optimize | Run URL or HTML optimization and review proposed edits. |
| Screenshot Chat | Paste screenshots and receive visual, saliency, and UX feedback. |
| Build | Compose or parse blocks, score layout, and export a generated page. |
| Patterns | Inspect learned optimization patterns from previous runs. |
| Optimizer View | Keep the perception stream pinned beside any workflow. |

## Stack

- **Frontend**: React, Vite, Recharts, Lucide icons
- **Backend**: Node.js, TypeScript, Express
- **Rendering**: Playwright Chromium
- **Image processing**: PNGJS-based saliency overlays
- **AI hooks**: OpenAI-compatible chat, vision, and image endpoints
- **Persistence**: local JSON memory under `backend/runs/`

## Repository Layout

```text
.
+-- backend/
|   +-- src/server.ts          # API, optimizer loop, rendering, saliency, memory
|   +-- .env.example           # Safe environment template
|   +-- package.json
+-- frontend/
|   +-- src/
|   |   +-- VisualCortexFlow.jsx
|   |   +-- FlowBuilder.jsx
|   |   +-- PerceptionTheater.jsx
|   |   +-- CortexRegions.jsx
|   |   +-- SnapshotDialogue.jsx
|   +-- vite.config.js
|   +-- package.json
+-- notebooks/
|   +-- Tribe_Version_2_X_IH_.ipynb
+-- demo.html                  # Local demo page for HTML upload tests
+-- package.json               # Root helper scripts
```

## Notebook

The `notebooks/Tribe_Version_2_X_IH_.ipynb` notebook contains the TRIBE encoder experiment used for local reference. The committed notebook keeps its executed-cell outputs so reviewers can see the setup logs, endpoint printouts, and debugging workflow.

## Quick Start

Install dependencies:

```bash
npm run install:all
```

Install the Chromium runtime used by Playwright:

```bash
npx --prefix backend playwright install chromium
```

Create your backend environment file:

```bash
cp backend/.env.example backend/.env
```

Set at least:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_LIVE=true
```

Start the backend:

```bash
npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

Open:

```text
http://127.0.0.1:5173
```

## Environment Variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | No | Backend port. Defaults to `8080`. |
| `OPENAI_API_KEY` | Yes for live AI | Keep this in `backend/.env`; never commit it. |
| `OPENAI_LIVE` | No | Set `true` for live OpenAI calls, `false` for local fallbacks. |
| `OPENAI_MODEL` | No | General model name used by the backend. |
| `OPENAI_CHAT_MODEL` | No | Chat model for screenshot analysis. |
| `OPENAI_VISION_MODEL` | No | Vision model for screenshot understanding. |
| `OPENAI_IMAGE_MODEL` | No | Image model for generated after previews. |
| `NEURAL_ENCODER_ENDPOINT` | No | Optional external encoder endpoint. Local saliency remains available without it. |
| `GAZE_LIVE` | No | Enables remote gaze-style signal when configured. |

## Scripts

```bash
npm run install:all      # install backend and frontend dependencies
npm run dev:backend      # start Express/TypeScript backend on 127.0.0.1:8080
npm run dev:frontend     # start Vite frontend on 127.0.0.1:5173
npm run build            # compile backend and build frontend
```

## Core API

| Route | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Runtime and model health. |
| `/optimize` | `POST` | Start URL optimization. |
| `/optimize-html` | `POST` | Start uploaded HTML optimization. |
| `/job/:id/stream` | `GET` | Server-sent optimizer events. |
| `/job/:id/decision` | `POST` | Accept or reject a paused proposal. |
| `/job/:id/before-screenshot` | `GET` | Baseline screenshot. |
| `/job/:id/after-screenshot` | `GET` | Optimized/generated after screenshot. |
| `/upload-html` | `POST` | Render and score uploaded HTML. |
| `/vision-chat` | `POST` | Screenshot chat with saliency analysis. |
| `/parse-page` | `POST` | Extract editable blocks for Build mode. |
| `/score-layout` | `POST` | Score Build mode blocks. |
| `/optimize-block` | `POST` | Suggest a local block edit. |
| `/gaze-analysis` | `POST` | Generate saliency regions and heatmap overlay. |
| `/patterns` | `GET` | Return learned pattern memory. |
| `/export` | `POST` | Export Build mode content as HTML. |

## Demo Flow

1. Open the Optimize tab.
2. Enter a URL or upload `demo.html`.
3. Choose iteration count and intent.
4. Start optimization.
5. Review each proposed edit in the decision dock.
6. Watch the saliency heatmap, scan path, chart, and region estimates update.
7. Export the improved HTML or compare before/after screenshots.
