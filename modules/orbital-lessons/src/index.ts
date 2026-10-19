import { ORBITAL_COURSE, type AcademyPractice, type ModuleInitializationV2, type OrbitalCourse, type OrbitalLesson,
  type TutorialCondition, type TutorialStep } from '@space-sim/game-api';

const eq = (field: string, value: string | number | boolean): TutorialCondition => ({ field, operator: 'eq', value });
const ge = (field: string, value: number): TutorialCondition => ({ field, operator: 'gte', value });
const le = (field: string, value: number): TutorialCondition => ({ field, operator: 'lte', value });
const ratio = (field: string, value: number, higher = true): TutorialCondition => ({ field, operator: higher ? 'ratio-gte' : 'ratio-lte', value });
const coast = [eq('coasting', true), eq('safe', true)];
const quiz = (title: string, instruction: string, choices: readonly string[], correct: number, explanation: string): TutorialStep =>
  ({ title, instruction, hint: explanation, question: { choices, correct, explanation } });
const task = (title: string, instruction: string, hint: string, conditions: readonly TutorialCondition[], holdSeconds = 0): TutorialStep =>
  ({ title, instruction, hint, conditions, holdSeconds });
const toolTask = (title: string, instruction: string, hint: string, conditions: readonly TutorialCondition[]): TutorialStep =>
  ({ ...task(title, instruction, hint, conditions), allowPaused: true });
const circle: AcademyPractice = { kind: 'circle', bodyId: 'planet', low: 2, high: 2 };
const ellipse: AcademyPractice = { kind: 'ellipse', bodyId: 'planet', low: 2, high: 5, at: 'apoapsis' };
const pad: AcademyPractice = { kind: 'pad', bodyId: 'planet', low: 1, high: 1 };
const moon: AcademyPractice = { kind: 'circle', bodyId: 'moon', low: 2, high: 2 };
const lesson = (id: string, title: string, level: OrbitalLesson['level'], introduction: string, deeper: string,
  practice: AcademyPractice, steps: readonly TutorialStep[], low?: number, high = low): OrbitalLesson =>
  ({ id, version: 1, title, level, introduction, deeper, practice, steps, ...(low === undefined ? {} : { target: { low, high: high! } }) });

export const course: OrbitalCourse = {
  id: 'spacelab.orbital-academy', version: 1, title: 'Orbital Academy', lessons: [
    lesson('launch', '01 · Lift off, then coast', 'First flights',
      'Your engine changes your motion. Gravity keeps working after you switch it off. Start with a short hop from the Primus pad.',
      'Acceleration and velocity are different. Engine acceleration is thrust per unit mass; gravity near Primus is μ/r². A vertical hop returns to the surface. The trainer has no simulated fuel budget.', pad, [
        task('Leave the pad', 'Raise the throttle gently and climb to 80 m clearance. Keep the nose pointing away from the ground.', 'Half power lifts the default Primus trainer gently. The controls below show your current bindings. Build some height before cutting thrust.', [eq('flying', true), ge('clearance', 80)]),
        task('Switch the engine off', 'Cut the engine and watch the ship keep moving for one second. You can restart practice after a crash.', 'Cut thrust when you have some height. Coasting means the engine is off; it does not mean you stopped moving.', [eq('flying', true), eq('coasting', true), ge('clearance', 10)], 1),
        quiz('What keeps moving?', 'What happens when an orbiting ship cuts its engine?', ['It stops in space.', 'It keeps moving while gravity bends its path.', 'Gravity switches off.'], 1, 'Inertia carries the ship onward. Gravity changes its velocity even while coasting.'),
      ]),
    lesson('first-orbit', '02 · Make your first orbit', 'First flights',
      'An orbit is a fall that keeps missing the ground. On Primus, begin turning at roughly 20–40 m clearance and keep building sideways speed as you climb. The guide ring is a possible orbit, not a commanded route.',
      'A safe bound orbit needs a periapsis above the full terrain/sea envelope. Height alone is insufficient. Not every speed below local circular speed leads to impact: an ellipse can also clear the ground. Circular speed is √(μ/r).', pad, [
        task('Climb and turn', 'Lift off, begin turning at 20–40 m clearance and climb past 100 m while building sideways speed.', 'Use about half power. Begin the turn early: waiting until 100 m to start turning makes the launch much harder. Steer toward the horizon while keeping the low side above the ground.', [eq('flying', true), ge('clearance', 100)]),
        task('Make the whole orbit safe', 'Build sideways speed until both sides of your orbit clear the surface. Cut thrust and coast for three seconds.', 'Watch periapsis, the low side. Near the top, aim along the horizon and add prograde thrust. If the orbit is too large, brake gently.', coast, 3),
      ], 1.5),
    lesson('coasting', '03 · Stay in orbit without thrust', 'First flights',
      'Load a safe circular orbit. Watch gravity turn your velocity as you travel. You do not need to keep the engine running.',
      'For an ideal two-body circle, T = 2π√(r³/μ). A complete orbit returns to the same position and velocity in the same inertial frame. Time warp accelerates simulation time, not the orbital physics.', circle, [
        task('Observe an engine-off orbit', 'Coast in a safe orbit for five simulation seconds. Watch the prograde marker change direction around the planet.', 'The trainer is already moving sideways in this setup. Leave the engine off.', coast, 5),
        quiz('What provides the turn?', 'Why does the ship follow a curved path with its engine off?', ['Gravity continually changes its velocity.', 'An orbit needs a hidden engine.', 'There is no acceleration in orbit.'], 0, 'An orbiting body accelerates under gravity even when its speed is constant.'),
      ], 2),
    lesson('vectors', '04 · Read the orbital directions', 'First flights',
      'Prograde follows your motion; retrograde points against it. Radial-out points away from the body and radial-in points toward it. The nose can point somewhere different from your motion.',
      'These directions depend on the chosen reference frame. Body-relative inertial velocity differs from motion over a rotating surface. The surface frame is useful for landing; use the orbital frame to reason about coast trajectories.', circle, [
        quiz('Pointing and moving', 'The nose turns while the engine is off. What happens to the coast orbit?', ['It rotates with the nose.', 'It stays the same.', 'The ship immediately reverses.'], 1, 'The trainer can turn its attitude without changing translational motion while coasting.'),
        task('Find your coast path', 'Keep the engine off and compare the nose, prograde marker and coast path for two seconds.', 'Use the Navball section of the Manual if you need to change its reference frame.', coast, 2),
      ], 2),
    lesson('raise', '05 · Raise the far side', 'Orbital skills',
      'A short prograde burn increases orbital energy. Starting from a circular orbit, it raises the opposite side much more than the side where you burn.',
      'The burn changes velocity at its location. The new conic must still pass through that location. For a tangential impulse from a circle, the burn point becomes periapsis. Real burns last for a finite time, so use short controlled pulses.', circle, [
        task('Raise apoapsis', 'Burn along your motion until apoapsis reaches at least 1.4 times its starting radius. Cut thrust and coast safely for one second.', 'Aim prograde, use low throttle and watch the far side grow. The guide ellipse shows a larger example orbit.', [...coast, ratio('apoapsis', 1.4)], 1),
      ], 2, 4),
    lesson('lower', '06 · Lower the far side', 'Orbital skills',
      'A retrograde burn removes energy. It lowers the opposite side of a circular orbit. Leave enough room above terrain.',
      'At the burn location, a short tangential retrograde impulse makes that point apoapsis. Too much braking makes periapsis intersect the body; the ship then follows an impact trajectory.', { ...circle, low: 4, high: 4 }, [
        task('Lower periapsis safely', 'Turn retrograde and gently reduce periapsis below 80% of its starting radius. Cut thrust and keep the low side safely above the surface.', 'Do not aim toward the ground. Brake against your current motion and watch the opposite side descend.', [...coast, ratio('periapsis', .8, false)], 1),
      ], 2.5, 4),
    lesson('circularize', '07 · Make an ellipse round', 'Orbital skills',
      'The setup starts at the high side of an ellipse. Add prograde speed there to raise the low side and make the orbit nearly circular.',
      'At apoapsis the radial velocity is zero. The circular target speed there is √(μ/r), greater than the ellipse’s current speed at apoapsis. Circularization at periapsis instead requires a retrograde burn to lower the high side.', ellipse, [
        task('Circularize near apoapsis', 'At the high side, burn prograde in small amounts. Reach eccentricity below 0.08, cut thrust and coast safely for two seconds.', 'The practice starts exactly at apoapsis. If you miss it, coast to the next high-side pass. Watch both apsides approach the guide ring.', [...coast, le('eccentricity', .08)], 2),
      ], 5),
    lesson('ellipses', '08 · Eccentricity and the two apsides', 'Orbital skills',
      'An ellipse has a low point, periapsis, and a high point, apoapsis. Eccentricity describes how stretched it is.',
      'For a non-degenerate ellipse, a = (rₐ + rₚ)/2 and e = (rₐ − rₚ)/(rₐ + rₚ). The body sits at a focus, not the geometric centre. e = 0 is circular; e approaches 1 as an ellipse becomes very elongated.', ellipse, [
        task('Watch the radius change', 'Coast from the high side until your distance to the body falls below 85% of its starting value.', 'Leave the engine off. The changing distance comes from the existing elliptical trajectory.', [eq('coasting', true), eq('safe', true), ratio('radius', .85, false)]),
        quiz('Where is the planet?', 'Where is the gravitating body in an ideal Kepler ellipse?', ['At the centre.', 'At one focus.', 'At apoapsis.'], 1, 'The body is at one focus. Equal-area motion is measured from that focus.'),
      ], 2, 5),
    lesson('speed', '09 · Fast near the body, slow far away', 'Orbital skills',
      'Start at the high side and coast inward. Speed rises as distance falls, even with the engine off.',
      'Vis-viva gives v² = μ(2/r − 1/a). For a fixed ellipse, a and total specific energy stay constant. Gravitational potential energy becomes kinetic energy on the inward leg and reverses on the outward leg.', ellipse, [
        task('Measure the speed increase', 'Coast until speed exceeds 120% of its starting value while the orbit stays safe.', 'Watch the speed and radius readouts together. A burn would change the experiment, so keep thrust off.', [...coast, ratio('speed', 1.2)]),
        quiz('What supplied the speed?', 'Why did the coasting ship speed up on the inward leg?', ['Its mass increased.', 'Gravity converted potential energy into kinetic energy.', 'It used fuel automatically.'], 1, 'In this two-body coast, specific orbital energy is conserved.'),
      ], 2, 5),
    lesson('radial', '10 · Radial burns reshape an orbit', 'Orbital skills',
      'A burn toward or away from the body changes radial motion. It can rotate and reshape an orbit, rather than simply lifting the far side.',
      'In 2D, specific angular momentum is h = x vᵧ − y vₓ. A purely radial impulse changes no h at that instant, but can change energy and eccentricity. Real finite burns move while thrusting, so they are not ideal impulses.', circle, [
        quiz('Radial or prograde?', 'Which direction points straight away from the current gravitating body?', ['Prograde.', 'Radial-out.', 'Retrograde.'], 1, 'Radial-out follows the radius vector, which is generally different from the velocity direction.'),
        task('Try a small radial-out pulse', 'Point away from the body, give a small pulse and coast. Make eccentricity at least 0.1 while keeping a safe orbit.', 'Use low power and cut early. Compare the new ellipse with the guide ring; radial pulses are not efficient circularization burns.', [...coast, ge('eccentricity', .1)], 1),
      ], 2),
    lesson('period', '11 · Higher orbits take longer', 'Orbital skills',
      'Raise your orbit and compare its period with the starting circle. Greater altitude does not mean you complete a lap faster.',
      'Kepler’s third law is T² = 4π²a³/μ for the selected two-body approximation. The semimajor axis determines an ellipse’s period; its current radius alone does not.', circle, [
        task('Lengthen the period', 'Use prograde thrust to increase the orbital period by at least 30%, then coast safely.', 'A short burn that raises apoapsis also raises the semimajor axis. You do not need to circularize first.', [...coast, ratio('period', 1.3)], 1),
        quiz('Compare circular orbits', 'Which circular orbit takes longer around the same body?', ['The larger orbit.', 'The smaller orbit.', 'Both have the same period.'], 0, 'The larger circular orbit moves more slowly and has a longer path.'),
      ], 2, 3.5),
    lesson('transfer', '12 · Fly a two-burn transfer', 'Orbital skills',
      'Move from a circle at twice the body radius to one at four times the radius. Burn once to raise the high side, coast, then burn there to raise the low side.',
      'A coplanar Hohmann transfer connects circular orbits with a half-ellipse: aₜ = (r₁ + r₂)/2, coast time π√(aₜ³/μ). It is a useful efficient two-impulse option; it is not universally optimal for every destination or flight-time constraint.', circle, [
        task('Shape the transfer ellipse', 'Raise apoapsis to between 3.7 and 4.3 body radii. Keep periapsis safe and cut thrust.', 'Aim prograde from the starting circle. Watch apoapsis, not your current altitude.', [...coast, ge('apoapsisRatio', 3.7), le('apoapsisRatio', 4.3)], .5),
        task('Circularize at the far side', 'Coast to apoapsis, then burn prograde until both apsides lie between 3.6 and 4.4 body radii. Cut and coast for two seconds.', 'The second burn raises periapsis. Use low power near apoapsis and leave room for the burn’s duration.', [...coast, ge('periapsisRatio', 3.6), le('apoapsisRatio', 4.4), le('eccentricity', .1)], 2),
      ], 2, 4),
    lesson('planner', '13 · Preview a maneuver before flying', 'Orbital skills',
      'The maneuver planner shows the consequences of a proposed velocity change. Planning is separate from firing the engine.',
      'A node is an impulsive Δv estimate at a chosen epoch. The live vehicle accelerates for a finite time, so a preview is an estimate rather than a guaranteed outcome. After each real burn, review the remaining plan against actual flight.', circle, [
        toolTask('Make a nonzero preview', 'Click the coast path to place a node, then edit its prograde or radial Δv above 1 m/s. Leave the real engine off.', 'Close the academy window if it covers the orbit. Reopen it from the Academy dock button. The Maneuver window owns the editable preview.', [ge('nodeDv', 1), eq('coasting', true)]),
        quiz('Did the plan burn?', 'Does editing a maneuver node fire the engine?', ['Yes, immediately.', 'Only if you choose an explicit execution action or fly the burn.', 'It changes gravity.'], 1, 'Plans remain inert until an explicit execution action; you can also fly them manually.'),
      ]),
    lesson('transfer-options', '14 · Generate a two-node transfer plan', 'Orbital skills',
      'Compare efficient and faster transfer options before flying. Keep departure and arrival in one reviewable plan, and use the planner’s save tools to preserve it.',
      'The delivered generator supports same-body circular and elliptical starts and targets. Efficient and faster options trade time against Δv. Review wait time, travel time, finite-burn duration and both nodes. Saving or adopting a plan does not arm either burn. Interbody generation is separate from the manually flown moon lessons.', circle, [
        toolTask('Adopt a generated departure and arrival', 'Open Maneuver, choose a higher orbit around the current body in Transfer window, find options and use one. Leave thrust off.', 'Place a node to open Maneuver. Choose Primus as destination, enter safe target altitudes, compare the options and choose Use option. Look for both departure and arrival nodes.', [ge('nodeCount', 2), eq('coasting', true)]),
        quiz('Review each real burn', 'After the departure burn, why should you review the arrival node again?', ['The actual finite burn may differ from the impulsive estimate.', 'Saving a plan already guarantees capture.', 'The arrival node is automatically armed.'], 0, 'Plans preserve intent. The real trajectory after a finite burn determines whether the remaining nodes are still appropriate.'),
      ]),
    lesson('alarms', '15 · Plan a coast and set a reminder', 'Orbital skills',
      'Use a burn reminder to leave time warp before a node. A reminder can notify and optionally pause without igniting an engine.',
      'Alarms compare simulation epochs. Pausing stops simulation-time countdowns; warp can cross them quickly. A reminder and an armed maneuver are separate actions.', circle, [
        toolTask('Review a node and its reminder', 'Place a future node and enable a burn alarm in Maneuver. Keep thrust off.', 'Open Maneuver → Burn alarm, choose a lead time and review its pending entry in Alarms.', [ge('nodeCount', 1), ge('alarmCount', 1), eq('coasting', true)]),
        quiz('What does the reminder do?', 'What should a burn alarm do by itself?', ['Fire the engine.', 'Remind you and exit warp, with optional pause.', 'Guarantee a perfect arrival.'], 1, 'A reminder helps preparation. It does not arm or execute a burn.'),
      ]),
    lesson('escape', '16 · Escape and orbital energy', 'Advanced',
      'Increase speed until the orbit is unbound. An escape from Primus can still leave you orbiting Lumen.',
      'Specific two-body energy is ε = v²/2 − μ/r. ε < 0 gives a bound ellipse; ε = 0 is the ideal parabolic boundary; ε > 0 is hyperbolic. Local escape speed is √(2μ/r). The patched-conic game changes the active frame at an SOI boundary.', circle, [
        task('Create an escape trajectory', 'Burn prograde until specific energy is positive. Cut thrust before leaving the body’s SOI.', 'Watch energy and the high side becoming unbounded. Escape speed is about 1.414 times circular speed at the same radius.', [eq('flying', true), eq('coasting', true), ge('energy', 1)], .5),
        quiz('Escape from where?', 'Positive energy relative to Primus means…', ['You escaped the entire universe.', 'Your Primus two-body orbit is unbound.', 'You cannot hit another body.'], 1, 'Energy is frame-specific. Check the new reference body after an SOI transition.'),
      ]),
    lesson('angular-momentum', '17 · Angular momentum and equal areas', 'Advanced',
      'A coasting ellipse sweeps equal areas in equal times. Close to the body, the radius is shorter and the angular motion is faster.',
      'Specific angular momentum h = r × v is conserved under a central force. Swept area rate is |h|/2. A tangential burn changes h; an ideal instantaneous radial impulse does not. The 2D simulation uses the out-of-plane signed scalar.', ellipse, [
        task('Observe the inward coast', 'Coast safely to a radius below 80% of the starting radius and watch speed increase.', 'Compare the h readout while coasting. Minor display rounding is expected; do not fire the engine.', [...coast, ratio('radius', .8, false)]),
        quiz('Equal areas', 'During equal time intervals, an ideal coasting ellipse sweeps…', ['Equal angles.', 'Equal areas about the focus.', 'Equal distances.'], 1, 'Equal area rate follows from conserved angular momentum.'),
      ], 2, 5),
    lesson('oberth', '18 · Why burn near periapsis?', 'Advanced',
      'A prograde velocity change adds more specific energy when the ship is already moving fast. Compare this with the speed changes you observed on an ellipse.',
      'For an impulsive burn, Δε = v · Δv + |Δv|²/2. The dot product makes a prograde Δv more effective in energy at higher speed. This does not create energy for free or make all low-altitude burns safe. Finite thrust and contact limits matter.', ellipse, [
        quiz('Same prograde Δv', 'On the same ellipse, where does an equal short prograde Δv add more specific energy?', ['Near periapsis.', 'Near apoapsis.', 'Always the same.'], 0, 'The velocity-dot-Δv term is larger near periapsis, where the ship is faster.'),
        task('Prepare a periapsis experiment', 'Coast into the faster part of the orbit until speed exceeds 140% of the starting value.', 'Do not burn during this observation. You can restart and compare maneuver previews at the low and high sides.', [...coast, ratio('speed', 1.4)]),
      ], 2, 5),
    lesson('phasing', '19 · Phasing and rendezvous timing', 'Advanced',
      'Meeting a target requires arriving at the same place at the same time, with a small relative velocity. A lower orbit can gain phase on a target in a higher orbit.',
      'Mean motion is n = 2π/T. Relative phase evolves from the difference in mean motions. Rendezvous requires position and velocity matching; an orbit crossing alone is insufficient. This trainer does not simulate docking hardware or 3D plane changes.', { ...circle, low: 4, high: 4 }, [
        task('Make a faster phasing orbit', 'Brake to reduce the period below 85% of its starting value while keeping a safe bound orbit. Coast for one second.', 'A retrograde pulse lowers the opposite side and shortens the period. You can later restore the target orbit after gaining phase.', [...coast, ratio('period', .85, false)], 1),
        quiz('What completes rendezvous?', 'Two paths cross. What else must be matched?', ['Only the ships’ colours.', 'Arrival time and velocity.', 'Nothing else.'], 1, 'An intercept at high relative speed is a flyby, not rendezvous.'),
      ], 2.5, 4),
    lesson('encounter', '20 · Meet a moving moon', 'Advanced',
      'This practice places you on a transfer aimed at where Parvus will be later. Coast and watch the moving-body preview. Entering its SOI changes the active frame.',
      'The setup uses a two-body transfer estimate and the selected future body ephemeris. The actual world predictor handles moving SOI boundaries. A guide ellipse alone cannot promise an encounter or capture. Search tools for automatic interbody transfers remain separate work in 0.6.4dev.', { kind: 'encounter', bodyId: 'planet', low: 2, high: 30 }, [
        quiz('Aim at which position?', 'Should a moon transfer aim at the moon’s current location or its future encounter location?', ['Its current location.', 'Its future encounter location.', 'Always straight away from the planet.'], 1, 'The destination moves while you coast. Transfer timing and phase must agree.'),
        task('Cross into the moon’s frame', 'Coast along the prepared transfer until the active body becomes Parvus. Use coast warp if desired; watch the encounter timing.', 'The practice is already on a transfer, so leave thrust off. SOI entry is an encounter; capture needs a separate braking burn.', [eq('bodyId', 'moon'), eq('coasting', true), eq('flying', true)]),
      ], 2, 30),
    lesson('capture', '21 · Brake for lunar capture', 'Advanced',
      'The setup starts on an unbound approach inside Parvus’s SOI. Slow down relative to Parvus to become bound without hitting the surface.',
      'Capture changes the moon-relative energy from positive to negative. A useful captured orbit also clears terrain and stays within the moon’s SOI. Brake near the low point for energy efficiency, and review actual apoapsis after the finite burn.', { kind: 'approach', bodyId: 'moon', low: 2, high: 6 }, [
        task('Capture safely', 'Aim retrograde in the orbital frame and brake. Make a safe bound orbit inside Parvus’s SOI, cut thrust and coast for two seconds.', 'Use low throttle. Negative energy alone is insufficient if periapsis intersects the moon or apoapsis reaches beyond its SOI.', [...coast, eq('bodyId', 'moon')], 2),
      ], 2, 6),
    lesson('return', '22 · Leave a moon and return to its parent', 'Advanced',
      'Escape Parvus to rejoin the Primus frame. The velocity you carry out combines with the moon’s motion around Primus.',
      'SOI transitions transform position and velocity between moving frames. Parent-relative energy depends on the escape direction and the moon’s orbital motion. Leaving a moon is not automatically a landing trajectory on its parent.', moon, [
        task('Leave Parvus', 'Burn to escape the moon, then coast until the active body is Primus. Inspect your new parent-relative orbit before making another burn.', 'First make the moon-relative energy positive. Coast warp can speed the trip to its SOI boundary. Use the predictor to inspect your parent orbit.', [eq('bodyId', 'planet'), eq('coasting', true), eq('flying', true)]),
        quiz('Did escape guarantee landing?', 'After leaving Parvus, what should you check?', ['The parent-relative trajectory and periapsis.', 'Only the moon’s old energy.', 'Nothing; landing is automatic.'], 0, 'Review the new frame’s trajectory, then plan safe approach, braking and landing.'),
      ]),
    lesson('landing', '23 · Deorbit and land gently', 'Advanced',
      'Lower your trajectory toward the surface, then remove speed before touchdown. Surface-relative motion matters on a rotating body.',
      'This game has terrain, contact and water but no general aerodynamic reentry model. The trainer’s contact limits govern landing; an atmosphere drawn on screen does not imply drag. Brake in the surface frame and align for the local surface normal.', moon, [
        task('Lower the low side', 'Brake from Parvus orbit until periapsis is below the moon’s reference radius. Keep flying while you prepare the landing burn.', 'A short retrograde burn initiates descent. Cut once the low side reaches the body, then prepare to brake before contact.', [eq('bodyId', 'moon'), eq('flying', true), le('periapsisRatio', .98)]),
        task('Touch down', 'Reduce surface-relative speed and land without crashing. Restart practice if you hit too hard.', 'Use low, controlled thrust. Near the ground, point away from the surface and brake the remaining descent. Watch terrain clearance.', [eq('bodyId', 'moon'), eq('landed', true)]),
      ]),
    lesson('challenge', '24 · Design your own flight', 'Advanced',
      'Choose a safe orbit, change it, then coast with the engine off. Use the Manual, planner, alarms and live values to explain what each burn changed.',
      'The supported model is 2D patched-conic flight with finite trainer thrust, moving body ephemerides and surface contact. Out-of-plane inclination changes, Lagrange-point dynamics, relativistic effects, real engine fuel accounting and aerodynamic reentry need other physics modules; they are not simulated by this course.', circle, [
        task('Build an elongated safe orbit', 'Make eccentricity between 0.2 and 0.6, then coast safely for three seconds.', 'Use a moderate tangential pulse, inspect both apsides and cut thrust before escape. You choose the direction and timing.', [...coast, ge('eccentricity', .2), le('eccentricity', .6)], 3),
        quiz('Know the model', 'Which maneuver is outside this 2D course’s current flight model?', ['Raising apoapsis.', 'Changing a 3D orbital inclination.', 'Capturing at a moon.'], 1, 'This flight world is planar. The course describes its physical limits explicitly.'),
      ], 2, 4),
  ],
};

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(ORBITAL_COURSE, course);
  context.contributeGuide({ id: 'academy', audience: 'players', title: 'Orbital Academy course', summary: 'Beginner flights, advanced orbital experiments and explicit practice setups.', asset: 'docs/players/course.json' });
  context.contributeGuide({ id: 'lessons', audience: 'creators', title: 'Edit the orbital course', summary: 'Independent lesson content and simulation-checked objectives.', asset: 'docs/creators/usage.json' });
}
