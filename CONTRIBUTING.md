# Contributing to Marventa AI

Thanks for helping make AI marketing workflows more accessible.

## How to contribute

- Use GitHub Discussions or an issue to propose substantial changes first.
- Keep pull requests focused and include tests for behavior changes.
- Never commit API keys, customer content, browser profiles, cookies, or platform login states.
- Run the backend tests and frontend lint, type, unit-test, and build checks before opening a pull request.
- Keep legacy database migrations, public compatibility exports, framework entry points, and dynamically selected resources unless their removal is explicitly intended. A missing static reference alone is not proof that code is unused.

From the repository root, using the backend virtual environment created by the startup script:

```bash
cd backend
.venv/bin/python -m unittest discover tests
```

Frontend unit tests use Node's built-in TypeScript support and require Node.js 22.18+:

```bash
cd frontend
npm run lint
npx tsc --noEmit --allowImportingTsExtensions
node --test $(find src -name '*.test.ts' -type f | sort)
npm run build
```

By contributing, you agree that your contribution is licensed under the MIT License.
