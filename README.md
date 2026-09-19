<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

**An open-source AI marketing workspace—from market insight to content publishing.**

🌐 **English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Overview](#what-is-marventa-ai) · [Features](#features) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md)

</div>

## Release improvements

| Release | Improvements |
| --- | --- |
| **v0.1.0** | First public release of the self-hosted, organization-aware AI marketing workspace. |

## What is Marventa AI?

Marventa AI is an open-source workspace for small businesses, creators, and marketing teams. It turns scattered product material into structured market insight, reusable examples, campaign-ready content, and trackable publishing work.

Most AI writing tools begin with an empty prompt and end with isolated copy. Marventa keeps the full marketing context together: what you sell, who it is for, what has worked before, what needs to be created, and where it will be published.

The result is one continuous workflow:

```text
Research → Understand → Create → Organize → Publish → Learn
```

## Why Marventa?

| Marketing challenge | Marventa's approach |
| --- | --- |
| Product knowledge is scattered across files and links | Import Markdown, PDF, Word, or a GitHub repository into one structured analysis |
| Every new campaign starts from a blank page | Reuse product insight and proven examples as generation context |
| AI output is difficult to review and organize | Save, edit, preview, and export content as durable portfolio assets |
| Publishing work lives in spreadsheets and chat messages | Manage content projects, assets, accounts, tasks, and retrospectives together |
| Teams are locked into one model provider | Connect any OpenAI-compatible model service with your own API key |

## Features

- **Market Insight** — analyze product material into positioning, audiences, competitors, and actionable marketing recommendations.
- **Case Library** — collect internal and public examples, manage media, save favorites, and run AI-assisted content breakdowns.
- **AI Content Studio** — generate titles, scripts, posts, hashtags, visual direction, and complete campaign plans through a guided conversation.
- **Portfolio** — keep generated work editable, previewable, exportable, and easy to reuse.
- **Publishing Workspace** — organize projects, media assets, account memory, publishing tasks, and performance notes.
- **Self-hosted by design** — run locally with SQLite and bring your preferred OpenAI-compatible model provider.

## Architecture

```text
Next.js / React frontend
          │
          │ HTTP JSON API
          ▼
FastAPI application
          │
          ├── Market insight engine
          ├── Case library engine
          ├── Content generation engine
          ├── Portfolio engine
          └── Publishing workspace
          │
          ├── SQLite + local media storage
          └── OpenAI-compatible model providers
```

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** FastAPI, Python 3.11+
- **Storage:** SQLite with organization-scoped business data and local file storage
- **AI:** OpenAI-compatible Chat Completions APIs
- **Browser automation:** Playwright

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20.9+
- npm 10+

Model API keys are required only for AI features. You can start the application, register, and sign in without them.

### 1. Clone and configure

```bash
git clone https://github.com/xiaoninemao/marventa-ai.git
cd marventa-ai
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Edit `backend/.env`, set a long, random `JWT_SECRET`, and configure the model services you want to use. Leave the API keys empty if you only want to explore the interface:

```env
CASE_AI_API_KEY=your-api-key
CASE_AI_BASE_URL=https://api.deepseek.com
CASE_AI_MODEL=deepseek-v4-flash

CASE_ANALYSIS_AI_API_KEY=your-api-key
CASE_ANALYSIS_AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
CASE_ANALYSIS_AI_MODEL=qwen3.6-flash

# Optional: leave empty to reuse CASE_AI_*.
MODIFY_CARD_AI_API_KEY=
MODIFY_CARD_AI_BASE_URL=
MODIFY_CARD_AI_MODEL=

JWT_SECRET=replace-with-a-long-random-string
```

| Configuration | Used for | When to configure |
| --- | --- | --- |
| `CASE_AI_*` | AI market insight and content generation | Required for these AI features |
| `CASE_ANALYSIS_AI_*` | AI case analysis, including analysis during case imports | Required for these AI features |
| `MODIFY_CARD_AI_*` | AI editing of generated content cards | Optional; each empty value inherits the corresponding `CASE_AI_*` value |

Each group contains an API key, a base URL, and a model name. The names describe their purpose rather than a required model vendor. The first two groups are independent and do not automatically inherit each other's settings; they can use the same provider if configured explicitly.

Use an OpenAI-compatible Chat Completions endpoint. Set `BASE_URL` to the provider's API base address, not the full `/chat/completions` URL. Choose a model that accepts the request parameters and can return structured JSON. Image analysis additionally requires support for `image_url` inputs.

The addresses and model names above are configuration examples, not a vendor restriction or a guarantee that every model is compatible. When switching providers, update the key, address, and model together. Restart the backend after changing the configuration.

The open-source software has no subscription fee. Model API usage and hosting resources may incur separate charges.

### 2. Start Marventa

Run the startup command from the repository root. On first launch, the scripts create a Python virtual environment, install Python and frontend dependencies, and download Playwright Chromium. This requires network access and may take several minutes.

macOS or Linux:

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

On macOS/Linux, keep the startup terminal open while using the application. The Windows script launches services separately and writes logs to `logs/`.

Open:

- Web app: [http://localhost:3000](http://localhost:3000)
- API documentation: [http://localhost:8765/docs](http://localhost:8765/docs) (available when `DEBUG=true`)

Create your account from the sign-in screen using a valid email address and a password of at least six characters. Your initial display name is derived from the email address and can be edited in settings. A demo account is disabled by default; local maintainers can explicitly enable one through `backend/.env`.

Authentication uses email addresses and local passwords; third-party sign-in is not supported. Existing installations retain server-side compatibility for legacy username sign-in.

Each user owns a separate default organization named from their email prefix—for example, `alex@example.com` receives **alex's Organization** in English and **alex的组织** in Chinese. Existing users receive one automatically, with the legacy username used when no email is stored, and new users receive one during registration. Use the selector at the top of the sidebar to switch between organizations you belong to; the selection is saved to your account and restored after signing in again. **Organizations**, above **Settings**, lets you create organizations and open an organization detail page. Organization owners can rename the organization, add registered users by email, and assign administrator or member access. Custom organization names are displayed as entered.

Organization switching currently changes your selected organization only. It does not move or share existing business data, and existing access rules remain unchanged. Invitations add an existing registered account immediately; pending email invitations, organization-wide data sharing, and organization deletion are not yet available.

Choose **English** or **简体中文** using the language selector in the public homepage header or the sign-in/sign-up panel. After signing in, the same preference is available under **Settings → Interface language**. The website and workspace default to Simplified Chinese and share your selection, which takes effect immediately and is saved in the current browser. User-entered content, saved work, and AI-generated results retain their original language. The README language switch is independent.

### 3. Stop Marventa

On macOS/Linux, press `Ctrl+C` in the startup terminal. You can also run the stop script from the repository root:

```bash
bash scripts/stop-local.sh
```

Windows PowerShell:

```powershell
.\scripts\stop-local.ps1
```

Both start and stop scripts can terminate processes using the configured ports (frontend `3000`, backend `8765` by default). Ensure these ports are dedicated to this project. If you customize `FRONTEND_PORT` or `BACKEND_PORT`, use the same values when stopping.

### Deployment note

These scripts start a local development environment, not a production deployment. Before exposing the application publicly, set a strong `JWT_SECRET`, disable debug mode with `DEBUG=false`, and review HTTPS, access controls, data backups, and deployment security. Changing these settings alone does not make a deployment production-ready.

Self-hosting stores the database and media in your environment. AI requests still send relevant inputs to the configured model provider; review that provider's data policy before using sensitive material.

## Repository Layout

```text
marventa-ai/
├── backend/
│   ├── app/                 # FastAPI APIs, auth, and business engines
│   ├── scripts/             # Local data import utilities
│   └── tests/               # Backend tests
├── frontend/
│   ├── public/              # Product and interface assets
│   └── src/                 # Next.js application
└── scripts/                 # Cross-platform local start and stop commands
```

Runtime databases, uploads, browser sessions, cookies, logs, and environment files are intentionally excluded from the repository.

## Development

The backend test commands use the virtual environment created by the startup script. Run each command block below from the repository root.

Storage integrity and online backups can be managed from `backend/`:

```bash
.venv/bin/python scripts/storage_admin.py check
.venv/bin/python scripts/storage_admin.py backup
```

Backend tests on macOS/Linux:

```bash
cd backend
.venv/bin/python -m unittest discover tests
```

Backend tests on Windows PowerShell:

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover tests
```

Run frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

## Roadmap

- Pluggable publishing connectors
- Team workspaces and approval flows
- Brand knowledge and reusable voice profiles
- More model providers and deployment presets
- Evaluation and campaign feedback loops

Ideas and implementation proposals are welcome in GitHub Issues.

## Contributing

Bug reports, feature ideas, documentation, translations, and code contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please read our [Code of Conduct](CODE_OF_CONDUCT.md).

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

Marventa AI Community is available under the [MIT License](LICENSE).

## Trademarks

The Marventa name and logo identify the original project. The MIT License covers the software source code, but does not grant rights to imply endorsement by the project maintainers. Third-party names and logos remain the property of their respective owners.

## Acknowledgements

Marventa AI is built on the open-source work of Next.js, React, FastAPI, Playwright, SQLite, and the wider Python and TypeScript communities.
