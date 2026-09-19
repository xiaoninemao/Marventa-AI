<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

**从市场洞察到内容发布的一站式开源 AI 营销工作台。**

🌐 [English](README.md) · **简体中文**

[![Website](https://img.shields.io/badge/官网-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/许可证-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)
[![PRs Welcome](https://img.shields.io/badge/欢迎提交-PR-brightgreen.svg)](CONTRIBUTING.md)

[项目介绍](#marventa-ai-是什么) · [核心功能](#核心功能) · [快速开始](#快速开始) · [技术架构](#技术架构) · [参与贡献](#参与贡献)

</div>

## Release 优化记录

| 版本 | 优化内容 |
| --- | --- |
| **v0.1.2** | 新增持久化协作通知、组织头像，以及采用全局顶部栏和悬浮展开导航的新版工作区框架。 |
| **v0.1.1** | 新增组织内协作、角色权限、租户存储加固、平台状态加密和存储运维能力。 |
| **v0.1.0** | 首个公开版本：支持自托管与组织协作的 AI 营销工作台。 |

## Marventa AI 是什么？

Marventa AI 是面向小型企业、内容创作者和营销团队的开源工作台。它可以将分散的产品资料整理为结构化市场洞察、可复用案例、可直接用于营销活动的内容，以及可持续跟踪的发布任务。

大多数 AI 写作工具从空白提示词开始，最终只留下相互孤立的文案。Marventa 将完整营销上下文集中在一个工作空间中，包括你在销售什么、目标用户是谁、过去哪些内容有效、接下来需要创作什么，以及内容将发布到哪些渠道。

整个工作流可以概括为：

```text
研究 → 理解 → 创作 → 整理 → 发布 → 复盘
```

## 为什么选择 Marventa？

| 营销问题 | Marventa 的解决方式 |
| --- | --- |
| 产品知识散落在文件和链接中 | 导入 Markdown、PDF、Word 或 GitHub 仓库并生成结构化分析 |
| 每次营销活动都要从空白开始 | 将产品洞察和优秀案例作为内容生成上下文重复利用 |
| AI 生成结果难以审核和整理 | 保存、编辑、预览和导出内容，形成长期可复用的作品资产 |
| 发布任务分散在表格和聊天记录中 | 统一管理内容项目、素材、账号、发布任务和复盘记录 |
| 团队被单一模型服务商绑定 | 使用自己的 API Key 接入任意 OpenAI 兼容模型服务 |

## 核心功能

- **市场洞察**：分析产品资料，提炼市场定位、目标受众、竞争对手和可执行的营销建议。
- **案例库**：收集内部或公开案例，管理媒体素材、收藏内容，并使用 AI 进行内容拆解。
- **AI 智能创作**：通过引导式对话生成标题、脚本、帖子、话题标签、视觉方向和完整营销方案。
- **作品集**：集中保存生成结果，支持编辑、预览、导出和再次使用。
- **发布工作台**：管理内容项目、媒体素材、账号记忆、发布任务和效果复盘。
- **面向自托管设计**：本地使用 SQLite 存储数据，并可自由选择 OpenAI 兼容模型服务。

## 技术架构

```text
Next.js / React 前端
          │
          │ HTTP JSON API
          ▼
FastAPI 应用
          │
          ├── 市场洞察引擎
          ├── 案例库引擎
          ├── 内容生成引擎
          ├── 作品集引擎
          └── 发布工作台
          │
          ├── SQLite + 本地媒体存储
          └── OpenAI 兼容模型服务
```

- **前端：** Next.js 16、React 19、TypeScript、Tailwind CSS
- **后端：** FastAPI、Python 3.11+
- **存储：** 按组织隔离业务数据的 SQLite 与本地文件存储
- **AI：** OpenAI 兼容的 Chat Completions API
- **浏览器自动化：** Playwright

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 20.9+
- npm 10+

只有 AI 功能需要模型服务的 API Key。未配置 Key 时，仍可启动应用、注册和登录。

### 1. 克隆并配置项目

```bash
git clone https://github.com/xiaoninemao/marventa-ai.git
cd marventa-ai
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

编辑 `backend/.env`，将 `JWT_SECRET` 设置为足够长的随机字符串，并配置需要使用的模型服务。如果只想先体验界面，可以将 API Key 留空：

```env
CASE_AI_API_KEY=your-api-key
CASE_AI_BASE_URL=https://api.deepseek.com
CASE_AI_MODEL=deepseek-v4-flash

CASE_ANALYSIS_AI_API_KEY=your-api-key
CASE_ANALYSIS_AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
CASE_ANALYSIS_AI_MODEL=qwen3.6-flash

# 可选：留空时沿用 CASE_AI_*。
MODIFY_CARD_AI_API_KEY=
MODIFY_CARD_AI_BASE_URL=
MODIFY_CARD_AI_MODEL=

JWT_SECRET=replace-with-a-long-random-string
```

| 配置项 | 用途 | 配置要求 |
| --- | --- | --- |
| `CASE_AI_*` | AI 市场洞察与内容生成 | 使用这些 AI 功能时需要配置 |
| `CASE_ANALYSIS_AI_*` | AI 案例分析，包括案例导入时的分析 | 使用这些 AI 功能时需要配置 |
| `MODIFY_CARD_AI_*` | 对生成的内容卡片进行 AI 修改 | 可选；每项留空时沿用对应的 `CASE_AI_*` 值 |

每组包含 API Key、接口基础地址和模型名称，按功能命名，不限定模型厂商。前两组配置相互独立，不会自动继承；如需使用同一家服务，可以分别填写相同的配置。

服务需兼容 OpenAI Chat Completions 接口。`BASE_URL` 填写服务商提供的接口基础地址，不要填写完整的 `/chat/completions` 地址。模型需支持当前请求参数和结构化 JSON 输出；涉及图片分析时，还需支持 `image_url` 输入。

上面的地址和模型名是配置示例，不代表绑定厂商，也不保证所有模型都兼容。切换服务商时，请同时调整密钥、地址和模型，修改后重启后端。

开源软件不收取订阅费，模型 API 调用和部署资源可能产生额外费用。

### 2. 启动 Marventa

从项目根目录执行启动命令。首次启动时，脚本会创建 Python 虚拟环境、安装 Python 和前端依赖，并下载 Playwright Chromium，需要网络连接，可能耗时数分钟。

macOS 或 Linux：

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell：

```powershell
.\scripts\start-local.ps1
```

macOS/Linux 用户使用期间需保持启动终端开启。Windows 脚本会单独启动服务，并将日志写入 `logs/`。

启动后访问：

- Web 应用：[http://localhost:3000](http://localhost:3000)
- API 文档：[http://localhost:8765/docs](http://localhost:8765/docs)（`DEBUG=true` 时可用）

你可以直接从登录界面创建账号，需要填写有效邮箱和至少 6 个字符的密码。显示昵称默认取邮箱前缀，之后可在设置中修改。演示账号默认关闭，本地维护者可以在 `backend/.env` 中明确启用。

身份认证使用邮箱和本地密码，不支持第三方登录。已有部署仍在服务端兼容旧账号名登录。

每位用户均拥有独立的默认组织，名称取自邮箱前缀，例如 `alex@example.com` 的默认组织中文显示为 **alex的组织**，英文显示为 **alex's Organization**。已有用户会自动补齐；未保存邮箱的旧账号使用账号名作为回退，新用户注册时同步创建。点击工作区 Header 中的组织切换器，可选择自己所属的组织；选择保存在账号中，重新登录后仍保留。**设置** 上方的 **组织管理** 支持创建组织并进入组织详情页。组织所有者可以修改组织名称、通过邮箱添加已注册用户，并设置管理员或成员权限。自定义组织名称保持原文显示。

当前组织切换仅改变选中的组织，不会迁移或共享现有业务资料，现有访问权限保持不变。当前邀请会让已有注册账号立即加入组织；组织邀请和角色变更会进入持久化通知中心，并显示未读数量，支持单条或全部标记已读。待确认的邮件邀请、组织间数据共享和组织删除暂未开放。

可通过官网顶部或登录/注册面板的语言选择器切换 **简体中文** 和 **English**，登录后也可在 **设置 → 界面语言** 中调整。官网与系统默认使用简体中文，共用同一语言偏好，切换立即生效并保存在当前浏览器中。用户输入、已保存的作品和 AI 生成结果保持原文；README 的语言切换保持独立。

### 3. 停止 Marventa

macOS/Linux 用户可在启动终端按 `Ctrl+C`，也可以从项目根目录运行停止脚本：

```bash
bash scripts/stop-local.sh
```

Windows PowerShell：

```powershell
.\scripts\stop-local.ps1
```

启动和停止脚本可能终止占用指定端口的进程（默认前端为 `3000`，后端为 `8765`），请确保这些端口仅用于本项目。如果自定义了 `FRONTEND_PORT` 或 `BACKEND_PORT`，停止时需使用相同的值。

### 部署说明

这些脚本启动的是本地开发环境，不是生产部署方案。对公网开放前，需要设置强随机 `JWT_SECRET`、通过 `DEBUG=false` 关闭调试模式，并评估 HTTPS、访问控制、数据备份和部署安全。仅修改这些配置并不代表已经满足生产部署要求。

自托管会将数据库和媒体保存在你的环境中，但 AI 请求仍会将相关输入发送到配置的模型服务商。使用敏感资料前，请确认该服务商的数据政策。

## 仓库结构

```text
marventa-ai/
├── backend/
│   ├── app/                 # FastAPI 接口、认证和业务引擎
│   ├── scripts/             # 本地数据导入工具
│   └── tests/               # 后端测试
├── frontend/
│   ├── public/              # 产品和界面资源
│   └── src/                 # Next.js 应用
└── scripts/                 # 跨平台本地启动和停止脚本
```

运行时数据库、上传文件、浏览器会话、Cookie、日志和环境配置文件均不会提交到仓库。

## 开发

后端测试命令使用启动脚本创建的虚拟环境。以下每个命令块均从项目根目录开始执行。

可在 `backend/` 目录检查存储完整性并创建在线备份：

```bash
.venv/bin/python scripts/storage_admin.py check
.venv/bin/python scripts/storage_admin.py backup
```

macOS/Linux 后端测试：

```bash
cd backend
.venv/bin/python -m unittest discover tests
```

Windows PowerShell 后端测试：

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover tests
```

运行前端检查：

```bash
cd frontend
npm ci
npm run lint
npm run build
```

## 路线图

- 可插拔的内容发布连接器
- 团队工作空间和审批流程
- 品牌知识库与可复用语气配置
- 更多模型服务和部署模板
- 营销效果评估与活动反馈闭环

欢迎通过 GitHub Issues 提交想法和实现建议。

## 参与贡献

欢迎提交错误报告、功能建议、文档、翻译和代码贡献。请先阅读 [贡献指南](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。

如果你发现安全漏洞，请按照 [安全政策](SECURITY.md) 中的方式报告，不要直接创建公开 Issue。

## 许可证

Marventa AI Community 基于 [MIT 许可证](LICENSE) 开源。

## 商标

Marventa 名称和 Logo 用于标识原始项目。MIT 许可证适用于软件源代码，但不授予任何暗示项目维护者认可或背书的权利。第三方名称和 Logo 归各自权利人所有。

## 致谢

Marventa AI 基于 Next.js、React、FastAPI、Playwright、SQLite 以及更广泛的开源社区成果构建。
