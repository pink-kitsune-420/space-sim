# Browser application

Space Sim's page owns lifecycle, keyboard/pointer controls, rendering cadence,
pause/reset, camera selection, HUD and budgeted sampled coast previews. Prediction
work is capped at 2 ms per render callback (plus one iterator step). Storage and
worker communication are future milestones.

Run `npm run dev` from the project root; `npm run build` writes the static page to
`dist/`. The production page is exercised by `npm run test:browser`.
See [M1 in the action plan](../../ACTION_PLAN.md). No hosted game is deployed.
