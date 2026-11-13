# Lead decisions for task-24

Exact launch/diagnostics scopes remain those in your initial prompt. ./diagnostics package export has already been added to packages/ellan-ui/package.json. Generated dist/node/original-diagnostics.cjs output is approved for your build script; please build and run isolated tests.

Core offline x://dev does not implement a local Yggdrasil server. Lead has set actual compatibility Settings.globalDisableAuthlibInjector=true by default in core/src/ellan/reads.ts, unless explicitly saved otherwise. Do not fabricate dev-agent URL/readiness; reject explicit x://dev-agent requests. Real external HTTP(S) authorities can use the real backend auth agent.

Lead owns runtime/feature-plan.ts and spawn-game.ts, and will integrate prepareOriginalLaunch/originalProcessEnvironment/observeOriginalProcess plus exact dependency list after your files exist. Please report exact exports; you need not wait for a board reply.
