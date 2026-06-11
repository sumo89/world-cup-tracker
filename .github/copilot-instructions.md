- [x] Verify that the copilot-instructions.md file in the .github directory is created.
- [x] Clarify project requirements.
- [x] Scaffold the project.
- [x] Customize the project.
- [x] Install required extensions (none needed).
- [x] Compile the project.
- [x] Create and run task (not required).
- [x] Launch the project (deferred; user can run npm run dev).
- [x] Ensure documentation is complete.

Project notes:
- Vite React + TypeScript app for 2026 World Cup matches and predictions.
- Fixtures are generated into public/data via scripts/fetch-world-cup-data.mjs.
- API key is never used in client code; use GitHub secret API_FOOTBALL_KEY.
- Deploys to GitHub Pages via .github/workflows/deploy-pages.yml.
