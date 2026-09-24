<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### Turn marketing knowledge into work your team can build on.

An open-source workspace for research, insight, content creation, and reusable marketing deliverables.

**English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Product](#product) · [Workflow](#workflow) · [Capabilities](#capabilities) · [Quick start](#quick-start) · [Configuration](#ai-configuration)

</div>

---

## Product

Marketing work rarely begins with a lack of ideas. It begins with scattered context:

- product knowledge lives across documents and repositories;
- useful examples disappear into bookmarks and chat threads;
- each campaign starts from another blank prompt;
- generated copy is difficult to review, organize, and reuse.

Marventa AI brings that context into a project-centered workspace.

Research becomes structured market insight. Cases become reusable references. Conversations become editable content cards. Final decisions become bilingual reports that remain connected to the project, the people, and the source material behind them.

```text
Research → Understand → Create → Review → Reuse
```

The result is not another isolated AI response. It is a growing body of marketing knowledge your team can return to.

## Workflow

### Organize

Create a project, invite collaborators, and keep research, media, cases, creations, and finished work in one place.

### Understand

Import product material from Markdown, PDF, Word, or a repository. Turn it into structured positioning, audience, competitor, use-case, and marketing-angle analysis.

### Learn from examples

Build a project case library from uploads and supported public links. Analyze hooks, content structure, audience, reusable lessons, strengths, and improvement opportunities.

### Create with context

Reference completed insights and analyzed cases inside Content Studio. Choose a channel and format, then generate a consistent set of plans, headlines, copy, hashtags, and visual direction.

### Refine and deliver

Continue the conversation, edit individual cards, restore earlier versions, and turn approved content into a formal bilingual report with preview and PDF export.

## Capabilities

### Project workspaces

- Explicit project membership and roles
- Project-bound insights, cases, creations, media, and portfolio work
- Creator attribution and project-aware permissions
- Searchable project navigation across the core workflow

### Market Insight

- Markdown, PDF, DOCX, and repository parsing
- Structured product and market analysis
- Background processing with clear completion and failure states
- Direct use of completed insights as creative context

### Case Library

- Image, video, text, and supported public-link imports
- Background enrichment of publicly available metadata
- On-demand structured AI analysis
- Project-scoped favorites and creative references

### Content Studio

- Guided conversations grounded in project knowledge
- Independent insight and case reference flows
- Short-video and image-text planning
- Five structured content cards for every generation
- Card-level editing, activity history, versioning, and rollback
- Live presence for collaborators viewing the same creation

### Portfolio

- Dedicated work list and report detail views
- Background generation states
- Complete Chinese and English report versions
- Seven substantive strategy sections
- Modular editing, preview, and PDF export

### Team collaboration

- Personal and custom organizations
- Organization and project roles with separate permission boundaries
- Persistent invitation and role-change notifications
- Stable account identities and profile images

## Permissions

Project access is deliberate and independent from organization role.

| Capability | Project member | Asset creator | Project admin / owner |
| --- | ---: | ---: | ---: |
| View project assets | Yes | Yes | Yes |
| Manage an insight, case, or creation | — | Own work | All project work |
| Manage project membership and media | — | — | Yes |

Organization administrators do not automatically inherit project-management access.

## Designed for self-hosting

Marventa stores business data in SQLite and feature-specific uploaded files on the local filesystem. AI services are connected through your own OpenAI-compatible credentials.

This gives teams control over:

- where project data is stored;
- which model provider is used for each AI task;
- how backups and access policies are managed;
- when material is sent to an external model service.

AI requests still send the relevant input to the configured provider. Review the provider's privacy and retention terms before processing sensitive material.

## Architecture

```text
Next.js 16 / React 19
          │
          │ HTTP JSON API
          ▼
FastAPI
          │
          ├── Market Insight
          ├── Case Library
          ├── Content Studio
          ├── Portfolio
          └── Organization and project access
          │
          ├── SQLite + local media
          └── OpenAI-compatible providers
```

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11+, Pydantic |
| Storage | SQLite and local media files |
| AI | OpenAI-compatible Chat Completions endpoints |
| Browser extraction | Playwright Chromium for supported fallback flows |

## Quick start

### Requirements

- Python 3.11+
- Node.js 22.18+
- npm 10+

### 1. Clone and configure

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set a long random `JWT_SECRET` in `backend/.env`. AI credentials can be added immediately or later; the workspace can start and manage existing content without them.

### 2. Start

macOS or Linux:

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

The startup scripts prepare the Python environment, install dependencies, download Playwright Chromium, and start both services.

- Web application: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8765](http://localhost:8765)
- API documentation: [http://localhost:8765/docs](http://localhost:8765/docs), when `DEBUG=true`

### 3. Stop

Press `Ctrl+C` in the macOS/Linux startup terminal, or run:

```bash
bash scripts/stop-local.sh
```

Windows:

```powershell
.\scripts\stop-local.ps1
```

## AI configuration

```env
CASE_AI_API_KEY=your-api-key
CASE_AI_BASE_URL=https://your-provider.example/v1
CASE_AI_MODEL=your-chat-model

CASE_ANALYSIS_AI_API_KEY=your-api-key
CASE_ANALYSIS_AI_BASE_URL=https://your-provider.example/v1
CASE_ANALYSIS_AI_MODEL=your-vision-capable-model

# Optional. Empty values inherit CASE_AI_*.
MODIFY_CARD_AI_API_KEY=
MODIFY_CARD_AI_BASE_URL=
MODIFY_CARD_AI_MODEL=

JWT_SECRET=replace-with-a-long-random-string
```

| Configuration | Purpose |
| --- | --- |
| `CASE_AI_*` | Market insight, conversation, content cards, and reports |
| `CASE_ANALYSIS_AI_*` | Structured case analysis, including image inputs |
| `MODIFY_CARD_AI_*` | Optional separate provider for card editing |

Use an OpenAI-compatible API base URL rather than the full `/chat/completions` path. Models must support the request parameters and structured JSON used by the selected feature. Image analysis additionally requires `image_url` input support.

## Repository layout

```text
Marventa-AI/
├── backend/
│   ├── app/                 # API, authentication, storage, and engines
│   ├── scripts/             # Storage integrity, backup, and audit tools
│   └── tests/               # Backend regression tests
├── frontend/
│   ├── public/              # Local interface assets
│   └── src/                 # Next.js application
└── scripts/                 # Cross-platform development scripts
```

Runtime databases, uploads, logs, browser state, and environment files are excluded from version control.

## Development

Backend:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests
backend/.venv/bin/python -m ruff check --select F,RUF100,B012,B018 backend/app backend/tests
backend/.venv/bin/python -m vulture backend/app --min-confidence 80
backend/.venv/bin/python -m pip check
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npx tsc --noEmit
node --test $(find src -name '*.test.ts' -type f | sort)
npm run build
```

## Security

Do not commit environment files, API keys, browser profiles, cookies, customer material, or production logs. Public deployments should use a strong `JWT_SECRET`, `DEBUG=false`, HTTPS, appropriate access controls, and a tested backup policy.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Contributing

Focused issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

Marventa AI is released under the [MIT License](LICENSE).
