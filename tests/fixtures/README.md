# Orbital fixtures

`orbits.json` contains 52 independent two-body RK4 fixtures, generated with Python's
standard library by `python3 scripts/generate_orbit_fixtures.py` from the project root.
Three normalized step sizes (.0005, .00025, .000125) check refinement before
Richardson extrapolation. The generator imports no production code. JSON records
SI units, ideal-two-body model ID, generator SHA-256, input/expected r/v, scale factors,
refinement differences and tolerances. `npm run measure:orbits` measures production
errors against those fixtures.

Future milestones add independent JSON cases for burns, frame
transforms, impacts, moving-moon encounters, warp partitions and camera transitions.
Each fixture needs units, model ID/version, generator provenance, expected values
and explicit tolerances. Do not copy production output and call it an oracle.

The scenario data is a seed for
fixture generation; it is not a numerical accuracy test by itself.

## Surface contact

`surface-contact.json` contains independently authored analytic straight-drift
contacts for `space-sim-linear-polar-drift-contact/1`. Units, crossing tolerance
and the grazing tolerance rule are recorded in the file. Circle expectations
solve x²+y²=R²; cardinal relief contacts use the authored sample radii, including
crater floors below the reference radius. No production generator or collision
solver produced these expected values.

`tests/unit/surface-contact.test.ts` adds analytic narrow-peak, sloped-tangency,
seam/corner and scale cases, plus a separate slow dense-sampling/bisection oracle
that interpolates authored samples directly. Its seeded robust-crossing cases
complement the analytic tangency fixtures: finite dense sampling alone cannot
prove absence of contact. `surfaces.json` covers independent polar geometry;
`surface-generator-v1.json` is a frozen procedural regression, not an oracle.
