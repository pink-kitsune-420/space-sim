/** In-game Manual text. Two audiences only: players and creators.
 *
 * Writing style: short plain sentences a beginner can follow, then an optional
 * `<details class="manual-deeper">` section with the maths and detail for readers who want more.
 * Define a term the first time it appears. Avoid stock phrasing ("it's not X, it's Y", "the secret is").
 *
 * Pages are trusted first-party HTML. Tokens the Manual expands when a page opens:
 * - `{{key:<actionId>}}` player 1's mapped keyboard and controller inputs;
 * - `<div data-manual-controls></div>` the full live keybinding table;
 * - `<a data-page="<id>">` a link to another page in the same audience.
 * Keep button names exactly as they appear on screen, and update a page whenever its feature changes. */

export type ManualAudience = 'players' | 'creators';

export interface ManualPage {
  readonly id: string;
  readonly title: string;
  /** One line shown in the topic list and used by search. */
  readonly summary: string;
  readonly html: string;
}

export interface ManualSection {
  readonly label: string;
  readonly intro: string;
  readonly pages: readonly ManualPage[];
}

const deeper = (title: string, body: string): string =>
  `<details class="manual-deeper"><summary>Go deeper: ${title}</summary>${body}</details>`;

const PLAYERS: readonly ManualPage[] = [
  {
    id: 'welcome',
    title: 'Welcome to Space Sim',
    summary: 'Start here: learn to fly, then explore the tools',
    html: `
<p>Fly a ship in a 2D planetary system. Your engine pushes in the direction of the ship’s nose.
Gravity bends your path. Build enough sideways speed and you keep falling around the planet: an <b>orbit</b>.</p>
<h3>Your first few flights</h3>
<ol>
  <li>Look over <a data-page="controls">Controls</a>. Hold {{key:engine}} for a short burn and steer with {{key:turnLeft}} / {{key:turnRight}}.</li>
  <li>Follow <a data-page="first-orbit">Your first orbit</a> from the default Primus launch pad.</li>
  <li>Try <a data-page="change-orbit">Changing your orbit</a> to see what a short burn does.</li>
  <li>Use <a data-page="maneuvers">Planning a maneuver</a>, then try a generated <a data-page="transfers">transfer plan</a>.</li>
</ol>
<p>These lessons use the default universe and Orbit trainer. Custom games can change the ship, physics and available tools.
Open <b>Go deeper</b> sections for explanations and maths; you can fly the lessons without them.</p>
<h3>Find what you need</h3>
<ul>
  <li><b>Setup</b>: choose a world and starting point, or reset a flight.</li>
  <li><b>Instruments</b>, <b>Trajectory</b> and <b>Telemetry</b>: turn on flight aids and read your path. Start with <a data-page="flight-view">Reading the flight view</a>.</li>
  <li><b>Fleet</b>: switch ships and <a data-page="fleet">save your progress</a>. <b>Online</b>: <a data-page="multiplayer">fly with friends</a>.</li>
  <li><b>Settings</b>: controls, sound and display. <b>Tools</b>: planet and shader editors. <b>ModMenu</b>: games and plugins.</li>
</ul>
<p>Press {{key:pause}} to pause. Pin this window to keep a lesson open while flying.
Search finds text inside collapsed sections too.</p>
${deeper('arranging windows and the HUD', `
<p>Click a dock button again or press <kbd>Esc</kbd> to close its window. The pin keeps it open while you fly.
Drag a title bar to move a window, or an edge or corner to resize it. The <b>□</b> button maximizes and restores it.
Focus a resize grip and use arrow keys for small adjustments; hold Shift for larger steps.</p>
<p>Open <b>Settings → Edit HUD layout</b> to move the dock, flight controls, clock, status, readings and hints.
Drag their grips, or focus a grip and use arrow keys. Navballs can be dragged directly while editing, even when pinned.
Each local player has a separate throttle lever position. Choose <b>Done</b> when finished.
Outside the editor, unpin a navball before moving it.</p>
<p><b>Settings → HUD visibility</b> controls individual HUD elements, including navballs, touch controls, labels,
planet orbit lines and chat. Planet orbits and ship trajectories have separate switches. The dock stays available.
Reopen hidden chat from the dock or with Enter. <b>Restore HUD visibility</b> restores visibility defaults;
<b>Reset HUD layout</b> restores positions and window sizes. These preferences stay on this device.</p>`)}
<p class="manual-note">Space Sim works offline and needs no account. The Creators tab explains how to make worlds, shaders and modules.</p>`,
  },  {
    id: 'controls',
    title: 'Controls',
    summary: 'Steer, burn, coast and find your live mappings',
    html: `
<div data-manual-configure></div>
<h3>The controls you need first</h3>
<ul>
  <li><b>Steer:</b> {{key:turnLeft}} / {{key:turnRight}} turn the nose. The engine pushes along the nose; turning alone leaves your orbit unchanged.</li>
  <li><b>Short burn:</b> hold {{key:engine}} or the on-screen burn button. Release to stop.</li>
  <li><b>Continuous thrust:</b> drag the throttle lever beside the navball, or use {{key:throttleUp}} / {{key:throttleDown}}.
    Releasing keeps this burn running. Press {{key:throttleCut}} or move the lever to 0% to coast.</li>
  <li><b>Pause / retry:</b> {{key:pause}} pauses; {{key:reset}} resets your selected ship to the chosen starting scenario.</li>
  <li><b>Look around:</b> drag to pan, wheel or pinch to zoom. Camera movement does not steer the ship.</li>
</ul>
<p>A held burn temporarily overrides persistent thrust; releasing it stops the burn.
Pausing, losing focus or opening a window clears persistent thrust. Check the lever before resuming.</p>
<h3>Your current mappings</h3>
<p>This table and the lesson hints use player 1’s current bindings. Choose <b>Configure controls…</b> at the top of this page,
or <b>Settings → Controls &amp; keybindings…</b>, to change them. A dash means unbound, disabled or assigned elsewhere.
Controller buttons use the connected controller’s names; disconnected controllers use Xbox labels.
For several pilots, see <a data-page="local-players">Playing on one screen</a>.</p>
<div data-manual-controls></div>
${deeper('fine thrust and remembered power', `
<p>Tap {{key:throttleUp}} / {{key:throttleDown}} for 1% adjustments, or hold to ramp active thrust.
Hold {{key:throttleFine}} for 0.2% taps and a slower ramp. Normal ramp speed rises from 20 to 30 percentage points per second over one second;
fine mode rises from 4 to 6. Releasing, reversing direction or changing fine mode restarts that ramp.</p>
<p>{{key:throttleRemember}} remembers the current active power without changing the burn.
{{key:throttleRecall}} starts a persistent burn at that activation level; {{key:throttleCut}} cuts power.
In Settings, the throttle slider also remembers its level. Choose a player to edit <b>Activation throttle (%)</b>,
or choose <b>Reset activation level</b> for the world’s default, normally 50%.</p>
<p>The lever shows active thrust and can reach 100%. Held engine or throttle inputs lock the lever and cancel a drag (<b>LOCK</b>).
Cut overrides held controls until you release them. Enable the lever with <b>Instruments → Throttle</b>;
move its separate grip in <b>Settings → Edit HUD layout</b>.</p>`)}
${deeper('connecting and tuning a controller', `
<p>Connect a controller and press a button so the browser can detect it. Common Xbox, PlayStation, Steam Deck and joystick layouts are supported.
With default bindings, left-stick vertical or D-pad up/down ramps thrust, LT/L2 gives fine adjustment,
R3 cuts, A/Cross recalls power, and RT/R2 is a held burn. Your live table above is authoritative after remapping.</p>
<p>Open <b>Settings → Controls &amp; keybindings… → Controllers</b>, choose the player, and set axes,
inversion, dead zone and buttons. The <b>dead zone</b> ignores small stick movement; increase it if steering drifts at rest.
Choose <b>+</b> beside an action and press a button to bind it. Throw has no default controller button.
Flight input is blocked while configuring controls.</p>`)}
`,
  },  {
    id: 'first-orbit',
    title: 'Your first orbit',
    summary: 'Launch from Primus and coast with the engine off',
    html: `
<p><b>Goal:</b> fly one lap with the engine off and the whole orbit above the ground.</p>
<p>In <b>Setup</b>, select <b>Primus System</b> in the default universe, then <b>North pad · ready to launch</b>.
Open <b>Instruments</b> and enable <b>Orbit markers</b>, <b>Velocity</b> and <b>Navball</b>.
Pin the <b>Trajectory</b> window so you can read the path while flying. Keep time at 1×.</p>
<ol>
  <li><b>Lift off.</b> Drag the throttle lever to 100%, or hold {{key:throttleUp}} until it reaches full power.
    This starts a persistent burn: releasing the control keeps the engine running. Begin pointing straight up.</li>
  <li><b>Build sideways speed.</b> Once clear of the pad, turn gradually toward either horizon with
    {{key:turnLeft}} / {{key:turnRight}}. Keep some upward thrust while you gain speed. Watch the navball pitch fall from +90° toward 0°.</li>
  <li><b>Choose a high point.</b> The <b>Ap</b> marker (apoapsis) is the highest point of your current coast path.
    When it is a few hundred metres up and you are still climbing, press {{key:throttleCut}} to coast.
    The path now shows where you will go without more thrust.</li>
  <li><b>Approach Ap.</b> Watch the time to Ap in Telemetry or the orbit marker. Turn toward the prograde marker,
    the direction of your motion. For this orbital burn, check that the navball reads <b>ORB</b>.</li>
  <li><b>Raise the low point.</b> Near Ap, make short prograde burns by holding {{key:engine}} and releasing to stop.
    Watch <b>Pe</b> (periapsis), the lowest point, rise above the surface. Stop before Ap grows far beyond the orbit you want.</li>
</ol>
<p><b>Check:</b> the engine is off, the coast path closes around Primus, and Pe clears the ground.
You can now increase time with {{key:warpUp}} and watch a lap. Use {{key:warpReset}} to return to 1×.</p>
<h3>If the launch goes wrong</h3>
<ul>
  <li><b>The line still hits Primus:</b> you need more sideways speed. A high Ap alone does not make an orbit.</li>
  <li><b>You fall while turning:</b> keep the nose higher for longer, or use more throttle. Turn more gradually next time.</li>
  <li><b>You fly far away:</b> cut thrust sooner. Primus is small and its orbits change quickly.</li>
</ul>
<p class="manual-note">Press {{key:reset}} to retry. To practise orbital burns first, choose
<b>Circular orbit · 128 m altitude</b> in Setup and continue with <a data-page="change-orbit">Changing your orbit</a>.</p>
${deeper('the launch numbers and gravity turn', `
<p>Default Primus has radius R = 512 m and gravitational parameter μ = 13,107,200 m³/s².
Surface gravity is μ/R² = <b>50 m/s²</b>. The default trainer’s maximum engine acceleration is <b>125 m/s²</b>.
Its full-power thrust-to-weight ratio is 2.5; at the default 50% activation level it is 1.25.</p>
<p>At 128 m altitude, r = R + altitude = 640 m. A circular orbit needs √(μ/r) ≈ <b>143 m/s</b>
of sideways speed and takes 2π√(r³/μ) ≈ <b>28 s</b>. The local two-body escape speed is about <b>202 m/s</b>.
These are ORB speeds relative to Primus’s centre, not SRF speeds over its rotating ground.</p>
<p>A gravity turn uses gravity to bend an initially upward flight toward the horizon. The lesson uses a
manually steered approximation. Turning the nose alone does not change your velocity: thrust must act over time.
Climbing vertically for too long spends thrust opposing gravity instead of building sideways speed.
The default trainer has no propellant budget; short, well-timed burns still make its path easier to control.</p>`)}`,
  },  {
    id: 'change-orbit',
    title: 'Changing your orbit',
    summary: 'Tutorial: raise one side, then make the orbit round',
    html: `
<p><b>Goal:</b> understand why raising an orbit usually takes two burns.</p>
<p>Choose <b>Circular orbit · 128 m altitude</b> around Primus in Setup. Keep time at 1× and thrust off.
Enable the velocity arrow and orbit markers. This exercise uses small burns so you can see the change.</p>
<ol>
  <li><b>Face your motion.</b> Align the nose with orbital prograde. Check the navball reads <b>ORB</b>.</li>
  <li><b>Burn briefly.</b> Hold {{key:engine}} for a short pulse, then release. Repeat if needed.
    The coast path becomes an ellipse: its far side rises, while the burn point becomes Pe.</li>
  <li><b>Coast to Ap.</b> Wait until the ship approaches the new highest point. Keep time slow near it.</li>
  <li><b>Burn prograde there.</b> Short pulses raise Pe toward Ap. Stop when the two heights are close.
    Continue burning and you can pass circular speed, making this point the new Pe instead.</li>
</ol>
<p><b>Check:</b> the new orbit is nearly round, higher than the starting orbit, and stays clear with thrust off.
Its circular speed is lower and its lap takes longer, even though you used two prograde burns to get there.</p>
<p>To lower an orbit, reverse the lesson: a short retrograde burn lowers the opposite side.
Coast down to the new Pe, then burn retrograde to lower Ap. Stop before the path intersects the surface.</p>
<p class="manual-note">Want a preview and precise Δv instead of hand-timed pulses? Follow <a data-page="maneuvers">Planning a maneuver</a>.</p>
${deeper('a two-burn example', `
<p>For circular orbits around Primus at r₁ = 640 m and r₂ = 1,280 m from the centre
(128 m and 768 m altitude), a tangential <b>Hohmann transfer</b> uses an ellipse with a = 960 m.</p>
<ul>
  <li>Departure: <code>√[μ(2/r₁ − 1/a)] − √(μ/r₁)</code> ≈ <b>22.1 m/s prograde</b>.</li>
  <li>Coast: <code>π√(a³/μ)</code> ≈ <b>25.8 s</b> to the far apsis.</li>
  <li>Arrival: <code>√(μ/r₂) − √[μ(2/r₂ − 1/a)]</code> ≈ <b>18.6 m/s prograde</b>.</li>
</ul>
<p>These are instantaneous-impulse estimates for circular orbits moving in the same direction around one body.
The first burn reaches the destination height; the second matches circular velocity there. A finite burn will differ slightly.</p>
<p>See NASA’s <a href="https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/" target="_blank" rel="noopener noreferrer">Trajectories</a> for transfer background.</p>`)}`,
  },
  {
    id: 'orbits',
    title: 'How orbits work',
    summary: 'Motion, gravity and the effect of a burn',
    html: `
<h3>Falling around a planet</h3>
<p>A thrown ball falls back to the ground. Give it enough sideways speed and the ground curves away beneath it
as it falls. Gravity still acts in orbit; you can turn the engine off because gravity bends your motion around the body.</p>
<h3>Words you will see</h3>
<dl>
  <dt>Reference body</dt><dd>The planet, moon or star used for your current position and orbital velocity.</dd>
  <dt>Prograde / retrograde</dt><dd>Along your velocity / opposite your velocity in the chosen frame.
    An orbital prograde burn adds speed; a short retrograde burn removes speed.</dd>
  <dt>Apoapsis (Ap) / periapsis (Pe)</dt><dd>The farthest / nearest point from the reference body’s centre.
    Displayed heights subtract its reference radius. Terrain can stand above that reference surface.</dd>
  <dt>Radial out / radial in</dt><dd>Directly away from / toward the body’s centre. These are directions, not a promise that your whole flight goes straight up or down.</dd>
  <dt>Δv (delta-v)</dt><dd>A change in velocity, measured in m/s. A longer burn or more thrust delivers more Δv.</dd>
  <dt>Eccentricity (e)</dt><dd>Orbit shape: 0 is circular, between 0 and 1 is elliptical, 1 is parabolic and above 1 is hyperbolic for a nonradial two-body path.
    An open path has no Ap. It can still hit the body before escaping.</dd>
  <dt>Sphere of influence (SOI)</dt><dd>A boundary where Space Sim switches which body supplies gravity.
    Entering a moon’s SOI is an encounter; staying in orbit there usually needs another burn.</dd>
</dl>
<h3>Three useful rules</h3>
<ol>
  <li><b>Burn at one end to change the other.</b> A short prograde burn at Pe raises Ap. At Ap it raises Pe toward your current height.
    Short retrograde burns do the reverse. After passing circular speed, the high and low labels can swap.</li>
  <li><b>Lower circular orbits have shorter periods.</b> A ship in a lower orbit gains angular position faster.
    To catch another ship, change the timing of your orbit, then match its position <i>and</i> velocity. Pointing at it and accelerating is rarely enough.</li>
  <li><b>Check the whole path.</b> Height alone cannot keep you up. A safe orbit needs enough sideways motion and clearance all the way around.</li>
</ol>
<p>Try the rules in <a data-page="change-orbit">Changing your orbit</a>. For another body, read
<a data-page="moon-flight">Reaching Parvus</a>.</p>
${deeper('two-body equations and their limits', `
<p>These describe an unpowered path under one body’s gravity. Use metres, seconds and velocity relative to that body.
μ = G × mass is its gravitational parameter; r is distance from the centre, <b>not altitude</b>.
For an ellipse, a is its semi-major axis: (Pe radius + Ap radius)/2.</p>
<ul>
  <li><b>Circular speed:</b> <code>v = √(μ/r)</code>.</li>
  <li><b>Escape speed:</b> <code>v = √(2μ/r)</code>. This is a local two-body energy threshold, not a guarantee of avoiding impact or leaving the whole system.</li>
  <li><b>Vis-viva:</b> <code>v² = μ(2/r − 1/a)</code>. Hyperbolic a is negative; for a parabola, 1/a is zero.</li>
  <li><b>Elliptic period:</b> <code>T = 2π√(a³/μ)</code>. Doubling a multiplies the period by about 2.83.</li>
  <li><b>Specific orbital energy:</b> <code>ε = v²/2 − μ/r</code>, in J/kg. Negative is bound; zero or positive is unbound in the isolated two-body model.</li>
</ul>
<p>For a very short tangential burn at an apsis, position hardly changes, and the burn changes the opposite apsis.
Away from an apsis, or during a long burn, both apsides and the ellipse’s direction can change.</p>
<p>The energy change for an instantaneous velocity change is
<code>Δε = v · Δv + |Δv|²/2</code>. A prograde impulse adds more energy at higher speed: the <b>Oberth effect</b>.
Burn placement still depends on the orbit and destination you want.</p>
<p>Energy stays constant during an undisturbed coast about the same body. Thrust, contact, custom forces and SOI frame changes can change the displayed value.</p>`)}
${deeper('what Space Sim simulates', `
<p>Default flight uses <b>patched conics</b>: one reference body supplies gravity at a time.
The game solves clear, unpowered arcs with Kepler’s equation to numerical precision, and uses fixed 0.01 s steps for thrust and contact.
SOI crossings change the reference frame while preserving the ship’s system position and velocity.</p>
<p>Real gravity has no sharp SOI boundary: other bodies keep pulling. Here planets and moons follow their configured paths;
this is a simplified Newtonian flight model. The default trainer has constant engine acceleration, no fuel depletion and no atmospheric drag.
An atmosphere’s visible glow does not imply aerodynamic braking. Custom games can select different physics.</p>
<p>A common SOI estimate is <code>r_SOI ≈ a(m/M)^(2/5)</code>, with child mass m and parent mass M.
A universe may set its own entry and exit radii; the defaults do. Slightly different entry and exit boundaries prevent rapid switching.</p>
<p>For real-flight background, see NASA’s <a href="https://science.nasa.gov/learn/basics-of-space-flight/chapter3-4/" target="_blank" rel="noopener noreferrer">Gravity &amp; Mechanics</a>.
The lessons here describe the game’s simplified model.</p>`)}`,
  },  {
    id: 'flight-view',
    title: 'Reading the flight view',
    summary: 'Read your coast path, heights, speeds and encounters',
    html: `
<p><b>Start with three aids:</b> enable <b>Orbit markers</b>, <b>Velocity</b> and <b>Navball</b> in <b>Instruments</b>.
Open <b>Trajectory</b> for a compact orbit readout, and <b>Telemetry</b> for more numbers.</p>
<dl>
  <dt>Coast trajectory</dt><dd>Your predicted path if you apply no more thrust. A closed, clear loop is an orbit;
    a surface endpoint means contact is predicted. It does not tell you that the contact will be a safe landing.</dd>
  <dt>Ap / Pe</dt><dd>Your current two-body high and low points. Positive Pe height alone does not guarantee terrain clearance.
    A circle has no distinct high point; an escape path has no Ap.</dd>
  <dt>Velocity arrow</dt><dd>Motion relative to the reference body’s centre. Your nose can point somewhere else.
    Turning without thrust changes attitude, not the coast path.</dd>
  <dt>Navball</dt><dd>Ship attitude, motion markers and the active ORB or SRF velocity frame. See <a data-page="navball">Navball</a>.</dd>
  <dt>Amber dashed path</dt><dd>The result of planned instantaneous burns. A plan does not apply thrust.
    See <a data-page="maneuvers">Planning a maneuver</a>.</dd>
</dl>
<h3>Encounters and incomplete paths</h3>
<p>The default predictor can follow a coast through moving SOIs, such as a Parvus encounter and a return to Primus.
An SOI crossing changes the reference body, so the local orbit and velocity numbers change too.
Amber encounter markers show the destination body and time remaining. A thin outline labelled <b>at SOI</b> shows
where that body will be at the encounter time, which can differ from its current position.</p>
<p><b>Tracing</b> means the preview is still being calculated. <b>Preview time horizon reached</b> means its time window ended;
<b>Partial path · work limit reached</b> means its work budget ended. <b>Escape · preview distance horizon</b>
marks an open path traced to its distance limit. <b>Unavailable</b> means no valid prediction was produced.
An unfinished line alone is not proof of escape. Predictions assume no future pilot burn and have finite limits.</p>
<h3>Move the view</h3>
<p>{{key:camera}} cycles camera modes; {{key:orientation}} changes north-up / horizon-up.
Drag to pan and use the wheel, pinch or {{key:zoomIn}} / {{key:zoomOut}} to zoom.
The ↶ / ↷ camera buttons rotate the view by 15° (Shift-click: 1°); <b>N↑</b> restores north-up.
Camera rotation leaves the ship’s attitude and orbit unchanged.</p>
${deeper('understanding telemetry', `
<p>These default flight readings use the body-centred orbital frame, even when the navball uses SRF.</p>
<dl>
  <dt>Radial speed</dt><dd>Outward velocity is positive; inward is negative.</dd>
  <dt>Horizontal speed</dt><dd>Magnitude of tangential velocity along the local horizon, in m/s.
    Compare it with √(μ/r); circular flight also needs radial speed near zero.</dd>
  <dt>Flight path angle</dt><dd>Angle of velocity above the local horizon. Positive while climbing, negative while descending;
    zero at an ordinary Ap or Pe. This is motion, not nose pitch.</dd>
  <dt>Local gravity</dt><dd>μ/r² in m/s², using centre distance r.</dd>
  <dt>Thrust / weight</dt><dd>Engine acceleration at the selected throttle divided by local gravity.
    It describes available thrust at that setting, even when the engine is off. Above 1 permits vertical acceleration if you point outward and fire.</dd>
  <dt>Orbital energy</dt><dd>Specific two-body energy in J/kg. Conserved during an undisturbed coast in the same frame.</dd>
  <dt>Orbit timing</dt><dd>Period and next apsis times from the current two-body orbit, not a prediction of future engine commands.
    Missing values can be appropriate for circles, radial motion or open paths.</dd>
</dl>`)}`,
  },  {
    id: 'maneuvers',
    title: 'Planning a maneuver',
    summary: 'Preview a burn, then choose how to fly it',
    html: `
<p><b>Goal:</b> predict an orbit change before firing the engine. A <b>maneuver node</b> stores a future time and Δv (change in velocity).
Creating or editing one leaves your ship coasting.</p>
<h3>Try a small burn</h3>
<ol>
  <li>Choose <b>Circular orbit · 128 m altitude</b> in Setup. Cut thrust with {{key:throttleCut}}, pause with {{key:pause}}, and zoom out to see the coast line.</li>
  <li>Click or tap a point ahead on that line. An amber diamond appears and the <b>Maneuver</b> window opens.
    Use <b>Burn editor</b> and set <b>Node in</b> to about 20 seconds for this practice orbit.</li>
  <li>Enter <b>10</b> for <b>Prograde Δv</b> and <b>0</b> for <b>Radial Δv</b>.
    The dashed amber path should rise on the far side of Primus. Negative prograde means retrograde; negative radial means inward.</li>
  <li>Check the predicted path, delta-v and burn duration at your current throttle setting. At this scale the burn is very short;
    use <b>Execute burn</b> for the first timing exercise, or choose the manual method below.</li>
  <li>Choose <b>Execute burn</b> while there is time to prepare; it resumes paused flight. It warps, aligns the ship,
    burns around the node time and cuts thrust. Watch the actual coast path afterward.</li>
</ol>
<p><b>Check:</b> the ship is coasting again, and the far side of its orbit is higher.
Execute burn affects only the selected node. Afterward, flight stays running at 1× and the editor selects and reviews the next pending node without arming it. Choose <b>Continue to next burn</b> to review actual flight and execute just the next node, or enable this ship’s automatic plan.</p>
<h3>Fly a node manually</h3>
<p><b>Warp to node</b> only coasts. It returns to 1× about 10 seconds plus half the estimated full-throttle burn duration before the node.
Point toward the amber diamond on the navball. For a short burn, aim to put half its duration before the node time and half after.
Use the displayed duration at your current throttle setting for manual flight; the full-throttle duration describes automatic execution. Burn arrows show direction at departure and arrival. Cut thrust yourself and inspect the result.</p>
<p><b>Abort burn</b> releases automatic steering and engine control. Manual flight input also takes over. Your warp keys and buttons cancel a conflicting automatic approach before applying your requested rate; its reminder stays suspended until you review or edit it.
Pausing, changing warp, switching ships, hiding the tab or changing the flight can cancel the approach or burn.
A partially flown burn needs replanning. Solo players and the host can use warp and automatic execution;
remote pilots can plan and fly manually.</p>
<p>Close and reopen the editor with the <b>Maneuver</b> dock button. See <a data-page="flight-plans">Multi-node plans and saves</a>,
<a data-page="transfers">Transfer plans</a> and <a data-page="burn-alarms">Burn reminders</a> for the next steps.</p>
${deeper('map handles and precision', `
<p>Drag the node’s <b>◇</b> along the original coast line to change its time.
Drag <b>P±</b> for prograde/retrograde or <b>R±</b> for radial out/in. <b>Button step</b> sets the adjustment;
Shift makes it ten times finer. Handles apply the step per 4 pixels. Escape cancels a drag.
<b>Clear Δv</b> keeps the node time; <b>Delete node</b> removes that node.</p>
<p>Prograde follows the predicted velocity <i>at the node</i>; radial follows position there.
These directions are not perpendicular when the ship is climbing or descending. The combined vector’s length,
not the sum of the two fields, determines Δv and estimated burn duration.</p>
<p>The preview applies Δv instantaneously. Actual burns take time and automatic execution delivers a fixed inertial
impulse vector while gravity continues acting. Long burns can differ substantially from the dashed path.
Automatic cutoff accounts for delivered engine impulse and can reduce the last tick’s throttle; it does not guarantee the planned arrival orbit.</p>
<p>The coast preview and compatible multi-node plans can cross moving SOIs. Click placement uses the initial coast before its first encounter; generated arrival nodes belong to the future body. Review against actual flight after a burn or reference-body change. Custom numerical or whole-world motion can disable analytic planning.</p>`)}`,
  },  {
    id: 'flight-plans',
    title: 'Multi-node plans and saves',
    summary: 'Chain burns, review actual flight and keep a plan',
    html: `
<p>A flight plan can hold several future burns for a ship. The dashed preview assumes each earlier burn happens exactly as planned.
Start with <a data-page="maneuvers">one maneuver</a>, then build a sequence.</p>
<ol>
  <li>Open <b>Burn editor → Plan actions</b> and choose <b>Add node</b> to append a burn. Choose which node to edit with <b>Plan node</b>.</li>
  <li>Set its time, prograde and radial Δv. Check the preview and each node’s status.
    Later nodes depend on earlier ones and cannot execute while an earlier node is pending.</li>
  <li>Fly the first burn manually or choose <b>Execute burn</b> for that node.</li>
  <li>For a manual burn, use <b>Plan actions → Mark flown</b> on the node you flew. Automatic completion marks its own node flown.</li>
  <li>Choose <b>Continue to next burn</b> to review and execute the next node, or <b>Review remaining nodes</b> to recalculate the remaining plan from the actual ship state.
    Inspect the result, adjust it if needed, then choose how to fly the next burn.</li>
</ol>
<p><b>Review remaining nodes</b> validates the edited intent against your current flight; it does not automatically correct
an inaccurate burn or optimise the arrival. A stale, missed or unsupported node needs editing, marking flown or deleting.</p>
<h3>Prepared plans for your fleet</h3>
<p>Select an owned ship in Fleet, prepare its nodes, then optionally check <b>Automatically execute this ship’s plan</b>.
This is off by default and applies only to that ship. It can continue while you select another ship.
After each burn it cuts the engine and reviews the remaining intent against actual flight. At a verified destination encounter,
it can add a validated arrival correction and continue through capture automatically. It stops if the actual coast misses the encounter or no safe correction is found.</p>
<p>By default, background ships <b>follow the current clock</b>. They request 1× only when alignment and thrust need it.
Optionally check <b>Auto-warp between burns</b> to coast at the fastest permitted warp, slowing for every running ship’s next burn, alignment, and normal world safety limits.
The Maneuver editor module’s <b>Automatic alignment warp (×)</b> setting controls rotation speed during automatic approaches: 1 uses real time; 2–4 run the same rotation physics faster. The default is 4. Engine burns always run at 1×. Follow-clock plans never increase the clock rate.
After the final burn, flight continues at 1× and automatic clock control ends. Choose <b>Clear completed plan</b> above the burn editor to remove that ship’s finished plan and markers; other ships’ plans and the current flight are preserved. Manual warp keys and buttons take priority; they cancel conflicting automation. While hosting multiplayer, approve or decline the request in the host prompt. Approval for an approach permits its needed slowdown; auto-warp approval covers the remaining burns of that armed run, including validated arrival corrections.
Approval itself does not change the clock. A pending or refused request cannot change warp. Direct Execute and Continue are the host’s explicit commands.
Remote pilots can prepare plans and fly manually; automatic control requires the authoritative host seat.</p>
<p>For an arrival at another planet or moon, <b>Continue to next burn</b> or <b>Coast to arrival and execute</b> checks the actual unpowered encounter and coasts through the SOI handoffs. At the destination it reviews the stored target orbit, updates a feasible capture’s timing and burn, and checks the finite burn and a full orbit before execution. If an inbound approach needs an extra correction, Execute and Continue offer a validated correction and updated capture for review, with execution stopped at 1×. Execute the correction separately, then Continue to next burn to review capture against actual flight. An enabled automatic plan executes the validated correction and continues through capture without another command; it reviews capture again after the actual correction burn. It stops if no encounter or safe correction is found. Older plans without an arrival orbit need review; manually editing an arrival burn removes its automatic target. Finite burns can still shift the final apsides slightly.</p>
<p>Pause, hidden input, manual takeover, a missed window or changed trajectory stops an active burn and requires review.
Resetting or repositioning a ship clears its old plan. Resetting the world clears every plan.
Turning off the checkbox or choosing <b>Abort burn</b> releases that ship’s automatic control. When automation stops, its reason remains beside the checkbox through subsequent reviews until you execute or rearm.</p>
<h3>Save and resume</h3>
<p>Under <b>Burn editor → Plan actions</b>, <b>Export plan</b> downloads a plan JSON file and <b>Load plan</b> imports it.
<b>Fleet → Save universe</b> also includes plans; load that universe to restore flight progress.
Loaded plans need review before use. A plan file alone does not move your ship onto its original orbit.</p>
<p>Plans store intent and reminder preferences. Loading, reviewing or generating a plan never arms a burn. Automatic execution permission is never saved or imported.
The current editor saves its plans locally or with your universe file; it does not broadcast them to other pilots.</p>
${deeper('compatibility and limits', `
<p>The shared plan service supports up to 16 time-ordered nodes per ship, within one year of the plan epoch.
It checks the ship, universe, system, physics identity, motion model and safe coast intervals.
Each node names its body. Supported moving SOI handoffs are evaluated at the planned time with position and velocity frame changes. Contact or prediction limits can invalidate a leg; actual flight still needs review before later execution.</p>
<p>The default game supplies the optional shared plan service. If a custom game omits it, the editor can retain
its single-node planning mode, without the multi-node save controls. Loaded plans remain inert and require review.</p>`)}`,
  },
  {
    id: 'transfers',
    title: 'Transfer plans',
    summary: 'Tutorial: compare generated departure and arrival burns',
    html: `
<p><b>Goal:</b> generate a two-burn orbit change and understand the choices before flying it.</p>
<p>Start in <b>Circular orbit · 128 m altitude</b> around Primus. Cut thrust and pause while comparing plans.</p>
<ol>
  <li>Choose <b>Transfers</b> in the flight toolbar, or the <b>Transfer window</b> tab in Maneuver. You do not need to place a node first.</li>
  <li>Keep the selected <b>Destination</b> as <b>Primus</b> (change orbit). Leave <b>Circular target</b> checked and enter
    <b>768</b> for <b>Target low altitude (m)</b>.</li>
  <li>Choose <b>Find transfer windows</b>. Compare the wait before departure, travel time, total Δv and both burn durations.</li>
  <li><b>Faster</b> is offered only when it saves at least 10% of wait plus travel and costs no more than twice the efficient plan’s Δv. Sequences without time to finish departure, turn and start arrival are excluded.</li>
  <li>Choose <b>Use plan</b> on the <b>Efficient</b> card, or the <b>Faster</b> card when offered. Expand <b>Burn estimates &amp; limits</b> for per-burn durations and uncertainty.
    This installs editable <b>Departure</b> and <b>Arrival</b> nodes; it replaces the ship’s current plan and leaves the engine off.</li>
  <li>Inspect Departure. Resume, then execute it explicitly or fly it manually. Afterward,
    mark a manually flown node with <b>Mark flown</b> and choose <b>Review remaining nodes</b>.
    Inspect Arrival against the actual path before choosing its burn.</li>
</ol>
<p><b>Check:</b> adopting a plan creates two nodes without starting thrust.
After both burns, compare actual Pe and Ap with the 768 m target; adjust any remaining error with a new maneuver.</p>
<h3>Prepare a later opportunity</h3>
<p>Adopt a validated window for the selected ship, then set its <b>Burn alarm</b> preparation lead.
Keep automatic execution off for a reminder only, or explicitly enable this ship’s automatic plan to fly its prepared nodes.
Repeat for another owned fleet ship. Each ship retains its own plan when selection changes.</p>
<h3>Other orbit shapes</h3>
<p>Starting orbits can be circular or elliptical. Uncheck <b>Circular target</b> to give the target separate low and high altitudes.
Both must clear the highest terrain; low must not exceed high. Heights are measured above the body’s reference radius.</p>
<h3>Moon and planet transfers</h3>
<p>From a safe orbit around Primus, choose <b>Parvus</b> and a circular altitude of <b>100 m</b> for a moon transfer.
Compare the sampled windows, then adopt the editable departure and arrival nodes. Planet transfers work between sibling planets around the same star.
Direct parent/child and sibling bodies sharing a parent are supported; deeper destinations need separate legs.</p>
<p>The search validates actual moving SOI handoffs, contact and a safe target revolution. Generated plans remain inert.
Review actual flight after departure and after a reference-body change before choosing arrival execution.
Both starting and target orbits may be elliptical. A long finite burn can change an encounter substantially.</p>
<p><b>Local</b> shortcuts follow the ship’s current orbital body: change its orbit, visit a child or sibling body, or transfer to its parent.
They show relationships accepted by the selected provider, not whichever body is physically closest. Acceptance does not guarantee a safe trajectory.</p>
<p>Open <b>Browse or search all destinations</b> for other systems. Choose a body’s name to select it, or its separate <b>Browse</b> button to see bodies orbiting it.
Search finds bodies even inside collapsed systems; results and the selected destination show their parent context.
Use Tab to enter a destination list, ↑/↓ or Home/End to move, and Enter or Space to choose. <b>Clear</b> returns from search to browsing.</p>
<p>Browsing and filtering leave the selected destination and any search running. Choosing a new destination clears old transfer results.
All bodies remain discoverable; selecting an unsupported relationship explains the limit. Deeper transfers need separately planned legs; the planner does not assemble a route.
See <a data-page="moon-flight">Reaching Parvus</a> for the manual flight lesson.</p>
${deeper('what efficient and faster mean', `
<p><b>Efficient</b> has the smallest total impulse cost among the validated sampled opportunities.
<b>Faster</b>, when available, arrives earlier after including both wait and travel time.
Neither label promises a global optimum. There may be no meaningfully faster validated result.</p>
<p>The search is bounded and uses the selected motion and prediction services to reject unsafe or unsupported candidates.
The result is still an <b>impulsive estimate</b>. Long finite burns can materially change the arrival;
review after departure and read any warning beside the option.</p>
<p>Thrust or changed flight conditions invalidate search results. Changing the destination or target heights requires a new search.
An expired preparation window also needs a new search. Use <b>Cancel search</b> to stop a search.</p>`)}`,
  },
  {
    id: 'burn-alarms',
    title: 'Burn reminders',
    summary: 'Leave warp in time to prepare; optionally pause',
    html: `
<p>A burn reminder helps you prepare for a node while using ordinary time warp.
It <b>exits warp and notifies you</b>; it never turns the ship or fires the engine.</p>
<ol>
  <li>Select a valid node in Maneuver and expand <b>Burn alarm</b>.</li>
  <li>Keep <b>Remind me before this burn</b> checked. Set <b>Preparation lead (s)</b> to the time you want before preparing the burn.</li>
  <li>Optionally check <b>Pause at reminder</b> or <b>Select and follow ship at reminder</b>. The default is 10 seconds of preparation, with both options off.</li>
  <li>Resume and increase time warp. You can close the Maneuver window. As the reminder approaches, warp slows;
    at the reminder it returns to 1×, notifies you, and pauses if selected.</li>
</ol>
<p><b>Select and follow ship at reminder</b> switches your selected ship and camera to the alarm’s ship, even when you are viewing another owned ship. It changes your local view, without arming a burn. If several focus reminders arrive together, the earliest deadline wins (ship ID breaks ties). The choice is saved per node; older plans leave it off.</p>
<h3>See all active reminders</h3>
<p>Open <b>Alarms</b> from the dock, or its entry under Instruments, to see pending reminders, countdowns and delivered notices for this session.
Configure each reminder in <b>Maneuver → Burn alarm</b>. Closing Alarms does not disable reminders.
This window shows reviewed next burns; later nodes appear after earlier burns are resolved and reviewed.
An empty list can mean there is no eligible reviewed node, or its reminder is off.</p>
<p><b>Check:</b> a reminder appears and the engine remains under your control.
Choose <b>Execute burn</b> separately if you want to execute just this burn, or enable this ship’s automatic plan. A non-pausing reminder does not interrupt an already armed automatic approach.</p>
<p>Only the next unflown, reviewed node of a ship is eligible. After a burn, review later nodes before expecting their reminders.
Missed or stale plans need attention. The host controls reminders that change the shared warp or pause;
remote pilots cannot independently stop the host’s clock.</p>
${deeper('when the reminder happens', `
<p>Reminders use <b>simulation time</b>, not wall-clock time. Pausing stops the countdown.
The deadline is the node time minus half the estimated full-throttle burn duration,
minus the larger of your preparation lead or estimated alignment time plus one second.</p>
<p>This allows more preparation when the nose points far from the planned direction. It is a preparation estimate, not automatic ignition.
Saved plans retain reminder settings and delivered state, so reloading does not repeatedly deliver the same old reminder.
Changing a future reminder can make it eligible again. Without the optional alarm provider, these controls are unavailable. The Alarms window is a separate optional module;
reminders can work without it. It reads the same clock catalogue and does not schedule another copy of a reminder.</p>`)}`,
  },
  {
    id: 'navball',
    title: 'Navball',
    summary: 'An attitude dial for launches, burns and landings',
    html: `
<p>The navball is a round dial in the corner of the screen (top right on phones). It shows which way your
ship points compared with the ground below you.</p>
<ul>
  <li><b>Blue half</b>: the sky, away from the planet. <b>Brown half</b>: the ground. The line between them is your local horizon.</li>
  <li><b>White chevron</b> in the middle: your ship's nose.</li>
  <li><b>Yellow-green circle with a dot</b>: prograde, the way you are moving. The same circle with an <b>X</b> is retrograde. Both use the frame shown on the dial and disappear near zero speed.</li>
  <li><b>Blue circles</b> on the marker ring: radial out (straight up) and radial in (straight down).</li>
  <li><b>Orange arc</b>: the shortest turn from your nose to prograde.</li>
  <li><b>Amber diamond</b>: the direction of a planned maneuver burn. See <a data-page="maneuvers">Planning a maneuver</a>.</li>
</ul>
<p>The readout under the dial shows <b>PITCH</b> (how far your nose points above the horizon), <b>Δ</b> (how many
degrees you need to turn to face prograde), and your speed.</p>
<h3>Using it</h3>
<ul>
  <li><b>Launch:</b> start at PITCH +90°, then let it fall steadily toward 0° as you build sideways speed.</li>
  <li><b>Raising your orbit:</b> turn until the orange arc disappears, so your nose sits on prograde, then burn.</li>
  <li><b>Landing:</b> point at retrograde to slow down, then keep the nose near +90° for the final drop.</li>
</ul>
<p>For orbital burns, use <b>ORB</b> velocity relative to the body’s centre. For landing, use <b>SRF</b> velocity relative to the rotating ground. Switching frames changes the motion markers, not your actual flight.</p>
<p>Switch the dial off in <b>Instruments → Navball</b>. Unpin it to move it; the throttle lever has its own position.</p>
${deeper('frames, pitch and settings', `
<p><b>ORB and SRF.</b> The readout shows which velocity the dial uses. <b>ORB</b> (orbit) is your speed around
the planet's centre. <b>SRF</b> (surface) is your speed over the ground, which turns with the planet. Primus spins
once every 600 s, so its equator moves about 5.4 m/s. A ship resting on the pad has 0 m/s SRF but 5.4 m/s ORB.
In auto mode, the dial uses SRF on the ground, enters SRF below a ground clearance of about 12% of the planet's radius, and returns to ORB above about 18%. The gap between the two stops it from flickering back and forth.</p>
<p><b>HRZ and CAM.</b> In <b>HRZ</b> (horizon) mode, the sky always stays at the top of the dial, so you have a steady
reference during a gravity turn. In <b>CAM</b> (camera) mode, the dial turns with your camera, so directions on
the dial match directions on screen.</p>
<p><b>Pitch</b> is measured from the horizon ahead of you (the direction you are travelling around the planet):
+90° is straight up, 0° is level going forward, −90° is straight down, and ±180° is level going backward.</p>
<p>Auto frame and HRZ orientation are the defaults. Custom game profiles can configure the navball’s frame and orientation.</p>`)}`,
  },
  {
    id: 'warp',
    title: 'Time warp',
    summary: 'Coast faster, understand limits and return to 1×',
    html: `
<p>{{key:warpUp}} increases time warp; {{key:warpDown}} reduces it. {{key:warpReset}} returns to 1×.
The maximum selectable rate is 100,000×, but the game limits the rate to suit the current world.</p>
<ul>
  <li><b>Engine firing:</b> 1×. Cut persistent thrust as well as releasing held engine controls.</li>
  <li><b>Steering, numerical flight or custom world rules:</b> at most 4×. Active contact or water entry can restrict it to 1×.</li>
  <li><b>Clear Kepler coasts:</b> up to 100,000×, including low and short-period orbits. Verified surface and sphere-of-influence events stop fast warp when preparation or ordinary physics is needed.</li>
  <li><b>Other ships matter:</b> warp is shared. A ship in the fleet can restrict it even when you are flying another one.
    A settled landed or crashed ship can sleep and does not by itself block fast warp.</li>
</ul>
<p>If warp stops increasing, read its explanation. The host controls the shared clock in multiplayer.
Use <a data-page="maneuvers">Warp to node</a> for a planned approach, or a <a data-page="burn-alarms">burn reminder</a>
while using ordinary warp. A reminder does not fire the engine.</p>
${deeper('on-rails coast and fixed steps', `
<p>For a clear two-body coast, the game evaluates a Kepler orbit directly at a later time. This is <b>on rails</b>.
It avoids stepping through every intervening 0.01 s of an uneventful coast. SOI and surface checks still bound safe jumps.</p>
<p>Thrust, near-surface interactions and custom per-step rules need numerical work.
Default flight uses 100 fixed physics steps per simulated second in those intervals.
Fast warp is limited to keep that work bounded and preserve contact accuracy.</p>
<p>Orbit Sandbox is a separate simulation with its own numerical warp and CPU limits;
see <a data-page="orbit-sandbox">Orbit Sandbox</a>.</p>`)}`,
  },  {
    id: 'landing',
    title: 'Landing, terrain and oceans',
    summary: 'Reduce surface speed and touch down upright',
    html: `
<p><b>Goal:</b> touch solid ground upright at less than 5 m/s relative to the rotating surface.
Total speed matters, including sideways motion.</p>
<h3>Practise before returning from orbit</h3>
<p>Use the default <b>North pad · ready to launch</b>. At 1×, make a short vertical hop, then cut thrust.
Keep the nose outward and use short burns to slow the descent. Aim well below the 5 m/s limit.
Press {{key:reset}} to retry.</p>
<h3>Return from orbit</h3>
<ol>
  <li>Burn orbital retrograde until the coast path intersects the surface. Start with the smooth practice planet.</li>
  <li>Watch the predicted contact point and your remaining height. Reduce speed early; the default game has no atmospheric braking.</li>
  <li>Near the ground, check the navball’s <b>SRF</b> frame. Burn opposite surface-relative motion to remove sideways drift.</li>
  <li>As surface speed approaches zero, point the nose outward for a gentle final descent. Prograde and retrograde markers disappear when there is almost no motion.</li>
</ol>
<p><b>Check:</b> the status reads <b>LANDED</b>. A safe landing needs low speed, a suitable attitude and a gentle enough slope.
On terrain, aim the nose along the local ground normal (perpendicular to the slope), rather than assuming radial up always matches it.</p>
<p>Try <b>Dry terrain flights</b> for mountains and craters. In <b>Ocean flights</b>, water provides buoyancy;
fast entry can crash the ship, and it can float or dive. These are simplified surface and water models.</p>
${deeper('landing limits and stopping distance', `
<p>Default solid-ground limits are total surface-relative impact speed ≤ <b>5 m/s</b>, nose within <b>20°</b>
of the supporting surface normal, and slope ≤ <b>30°</b>. A rotating planet’s ground velocity must be subtracted from orbital velocity.
The limits apply with ordinary crash rules; cheats and custom physics can change the outcome.</p>
<p>For a nearly vertical descent, constant engine acceleration A, approximately constant local gravity g,
and full outward thrust, net braking acceleration is A − g. If A &gt; g,
<code>d ≈ v²/[2(A − g)]</code>. This ignores turning time, sideways motion, changing gravity and terrain;
use it as a rough estimate, not a guaranteed ignition height.</p>
<p>Near Primus’s surface at full power, A − g ≈ 125 − 50 = 75 m/s².
At 50 m/s downward speed the estimate is about <b>17 m</b>; at 100 m/s it is about <b>67 m</b>.
Start higher to allow for alignment and corrections. At half throttle the available braking is much smaller.</p>`)}`,
  },  {
    id: 'moon-flight',
    title: 'Reaching Parvus',
    summary: 'Plan a moon encounter, then brake for capture',
    html: `
<p><b>Goal:</b> distinguish reaching a moon’s orbit, encountering the moon and staying there.</p>
<p>Practise <a data-page="maneuvers">maneuver planning</a> and <a data-page="change-orbit">orbit changes</a> first.
Begin in Primus’s <b>Circular orbit · 128 m altitude</b>, moving in the same direction as Parvus.</p>
<p>For a generated plan, open <b>Transfers</b> in the flight toolbar, choose <b>Parvus</b>,
enter a circular target altitude of <b>100 m</b> and choose <b>Find transfer windows</b>.
Compare wait, travel and Δv, then choose <b>Use plan</b>. Inspect both editable burn nodes
and their current-throttle duration. Execute each burn separately and review actual flight after departure and SOI changes.</p>
<p>To explore the encounter manually:</p>
<ol>
  <li><b>Raise the far side.</b> Plan a prograde departure until Ap reaches roughly Parvus’s orbital distance.
    Merely crossing that distance does not guarantee a meeting.</li>
  <li><b>Time the departure.</b> Parvus must be near the far end when you arrive, rather than where it was when you left.
    Change the departure time and inspect the coast forecast for an SOI encounter.</li>
  <li><b>Inspect the approach.</b> The multi-body coast preview can show the encounter and later path.
    Avoid a surface impact. Use low warp near the moon so you can react.</li>
  <li><b>Capture.</b> Once inside Parvus’s SOI, plan using the new moon-centred orbit.
    A retrograde burn near a safe Pe can remove enough energy to leave a bound orbit around the moon.</li>
</ol>
<p><b>Check:</b> entering the SOI is an encounter. Capture means you now have a bound, terrain-clearing moon orbit
that stays within its SOI; otherwise you may fly past and return to Primus.</p>
<p class="manual-note">Generated windows are bounded impulsive estimates. A finite burn can change the encounter;
check the forecast and review or adjust the moon-centred arrival node before capture.
See <a data-page="transfers">Transfer windows</a> for supported destinations and search limits.</p>
${deeper('a first estimate for the departure window', `
<p>Ignore the moon’s gravity until the encounter and use a half-ellipse from r₁ = 640 m to
r₂ = 15,360 m from Primus’s centre. Its semi-major axis is a = 8,000 m.</p>
<ul>
  <li>Initial circular speed: about <b>143 m/s</b>.</li>
  <li>Transfer departure speed: <code>√[μ(2/r₁ − 1/a)]</code> ≈ <b>198 m/s</b>, a prograde impulse of about <b>55 m/s</b>.</li>
  <li>Coast to the far end: <code>π√(a³/μ)</code> ≈ <b>621 s</b>, about 10 minutes of game time.</li>
  <li>Parvus’s period is about 3,298 s. It moves roughly 68° during the coast;
    for the same orbital direction, begin with Parvus about <b>112° ahead</b> along the orbit.</li>
</ul>
<p>This Hohmann-style estimate targets the moon’s orbital distance, not a safe moon-centred periapsis.
Its finite SOI, an earlier encounter, a finite departure burn and the capture maneuver all change the actual flight.
Use the preview and make corrections. A Hohmann transfer is a useful two-impulse construction;
it is not the globally cheapest route between every pair of circular orbits.</p>`)}`,
  },
  {
    id: 'worlds',
    title: 'Universes and star systems',
    summary: 'Primus System, Solar System and more',
    html: `
<p>Choose a universe, a system and a starting point in <b>Setup</b>.</p>
<ul>
  <li><b>Primus System</b> (default): the place to learn. The star Lumen; tiny Ignis; low-gravity Velum;
    <b>Primus</b> and its moon Parvus; and heavy Magnus with its moons Nix and Umbra.</li>
  <li><b>Outer Reach System</b>: the giant Kronos and its moons.</li>
  <li><b>Dry terrain flights</b> and <b>Ocean flights</b>: practice for landings.</li>
  <li><b>Solar System (1/10 scale)</b> and <b>Full Solar System (1:1, every known moon)</b>: the real planets.</li>
</ul>
<p>Use <a data-page="planet-designer">Tools → Planet designer</a> to change a body’s appearance on this device.
Build physical planetary systems in <a data-page="orbit-sandbox">Orbit Sandbox</a>, available in the ModMenu. To load a universe someone sent you, use <b>Setup → Import…</b>.</p>
${deeper('why the Primus System is so small', `
<p>Real planets are huge, so a low Earth orbit takes roughly 90 minutes and a typical trip to the Moon takes days. The Primus planets
are a few hundred metres across but very dense, so gravity at the surface is still strong. Orbits take seconds,
and you can try a manoeuvre, see the result and try again quickly. The physics is the same as at full size.
The same two-body equations apply. These compact fictional worlds are not models of realistic planet interiors or atmospheres.</p>`)}`,
  },
  {
    id: 'planet-designer',
    title: 'Planet designer',
    summary: 'Change a look, save a design and share its appearance',
    html: `
<p><b>Goal:</b> give an existing planet a new look without changing its gravity, terrain or orbit.</p>
<ol>
  <li>Open <b>Tools → Planet designer</b> and choose a <b>Body</b>.</li>
  <li>Choose a preset, then adjust style, colours and other appearance controls. These edits change the draft preview.</li>
  <li>Choose <b>Apply to</b> the selected body to see the draft in flight. <b>Restore original</b> removes that override.</li>
  <li>Name the design and choose <b>Save design</b> to keep it in <b>My planets</b>. Saving a design and applying it are separate actions.</li>
</ol>
<p><b>Check:</b> the selected body looks different, while its coast paths and landing surface behave as before.
The preview’s Sun, Lit and Spin controls help inspect the artwork; they do not change the physical world.</p>
<h3>Keep or share a design</h3>
<p><b>Export My planets</b> downloads your design library; <b>Import…</b> adds designs from a file.
<b>Copy JSON</b> copies an appearance block for a universe definition. <b>Download PNG</b> saves a preview image when available.</p>
<p>Applied looks and My planets are stored in this browser. They are not included in universe progress saves or sent to other pilots.
To build planets with new masses, radii or orbits, use <a data-page="orbit-sandbox">Orbit Sandbox</a> or edit a universe definition in the Creators workflow.</p>
${deeper('appearance and physical terrain', `
<p>Procedural surface colours, patterns and atmospheric glow are presentation. Changing them does not regenerate collision terrain or add atmospheric forces.
The optional WebGL preview may be unavailable on some devices; appearance editing and JSON/library exports still work without it.</p>`)}
`,
  },
  {
    id: 'orbit-sandbox',
    title: 'Orbit Sandbox',
    summary: 'Sling planets, edit worlds and control simulation time',
    html: `
<p>Choose <b>Orbit Sandbox</b> in the ModMenu to create planetary systems. Select a planet type in the bottom palette, then drag empty space to launch it. Hold Shift for a circular-orbit preview.</p>
<p>The Sandbox dock opens <b>Physics</b>, <b>Appearance</b>, <b>Testing</b> and <b>Export</b>; the combined app also offers <b>Load Game</b> and <b>Manual</b>.</p>
<p>Click a body to edit it in the <b>Planet inspector</b>. Its window can be moved, resized, pinned, minimized or maximized. Right-drag or middle-drag the map to pan; scroll to zoom.</p>
<p><b>Pause</b> or P / Space stops the simulation. Choose a speed in the Warp selector, or use − / +, [ / ] or , / . to step through speeds. Use / or <b>1×</b> to return to real time. Choose <b>0.2×</b> in the selector for slow motion. <b>Reset</b> or R starts a fresh default system; <b>Play · new world</b> does the same. Warp is selectable up to 100,000×. Faster warp adds numerical steps rather than enlarging them. If the CPU cannot sustain it, a warning appears and warp automatically drops to a sustainable factor. Your computer and the bodies' close encounters determine the available speed.</p>
<p>In <b>Testing Lab</b>, <b>Disable CPU limiter (debug)</b> keeps your requested speed and removes that work budget. Very high warp can stall the interface; this option resets on reload. Numerical step sizes remain bounded.</p>
<p><b>Labels</b> hides planet names. <b>Orbit Lines</b> (O) shows or hides planet orbit guides; both choices are saved on this device. Apoapsis and periapsis markers belong to the selected orbit and active launch preview. Nearly circular orbits have no useful distinct apsides. Use <b>Export Universe</b> to share the system or launch it in Space Sim.</p>`,
  },
  {
    id: 'fleet',
    title: 'Fleets and saving',
    summary: 'Several ships in one world',
    html: `
<ul>
  <li><b>Fleet → Launch another</b> adds a ship at the chosen starting point. Ships you aren't flying keep orbiting and falling on their own.</li>
  <li>{{key:cycleShip}} and {{key:cycleShipPrev}} switch between ships, or click one in the Fleet list.
    <b>Remove ship</b> deletes the ship you are flying.</li>
  <li><b>Save universe</b> downloads a <code>.spaceuniverse</code> with the clock, ships, pilots and available saved flight plans. <b>Load universe…</b> restores progress. Review loaded plans before use; a save never arms automatic burns.</li>
  <li>{{key:reset}} (<b>Reset flight</b>) returns only the ship you are flying to the chosen scenario, preserving the world clock and the other ships. <b>Setup → Reset world</b> restarts the whole world and rewinds the clock; only the host can do this.</li>
</ul>`,
  },
  {
    id: 'local-players',
    title: 'Playing on one screen',
    summary: 'Up to four pilots, controllers and dynamic split screen',
    html: `
<p>Open <b>Settings → Split screen…</b> and choose one to four players. Local pilots work in your solo world or a world you host. Joining someone else's world uses the primary pilot.</p>
<ol>
  <li>On the <b>Players</b> tab, give each pilot a name and an input device. Use the keyboard for one player and controllers for the others. <b>Press to assign</b> lets a controller claim a seat.</li>
  <li>Choose <b>Dynamic</b> screen mode to share a view while the ships are close together. Moving apart, changing reference body or opening a map splits the views. <b>Forced split screen</b> always gives each pilot a separate pane.</li>
  <li>Each pilot has a matching colour and navball. Pick its corner on the Players tab, or unpin and drag the dial. Disabling <b>Instruments → Navball</b> hides the dials and their interaction targets.</li>
  <li>The primary pilot's quick reset returns only that ship to the chosen scenario. Other pilots can use their assigned reset button. <b>Setup → Reset world</b> is for the host and restarts every ship and the clock.</li>
</ol>
<p>In a game already configured for several players, an unclaimed controller can join by pressing Start. Controller settings are separate for each player; time warp and pause affect everyone.</p>
<p>With the throw cheat enabled in Settings, hold the controller's configured throw button and pull with a stick, then release to launch. Disabled controllers and disabled cheats cannot throw a vessel. The right stick moves a virtual cursor for the pilot's viewport.</p>`,
  },

  {
    id: 'multiplayer',
    title: 'Flying together',
    summary: 'Host friends or join a server',
    html: `
<p>Open <b>Online</b>. Everyone shares one sky and one clock, and each pilot has their own ships.</p>
<p>Separate windows of the same browser can join a server as separate pilots, including from the offline HTML.
Reload a window to reconnect to that window's ships.</p>
<p>A host can offer the game modules required to join. Review the server address, versions, licenses,
source availability and Code/Data list; <b>Cancel</b> is selected first. <b>Install and join</b> approves
only that exact server pack. Code can read game data and input and send network requests, so approve
code only from a source you trust. Changed data also asks again. Accepted modules apply to that server
session; leaving returns to your local game. An unchanged approved pack can reconnect without another
prompt. A cancelled, invalid or incompatible pack leaves your current game intact.</p>
<p>Joining uses the server's saved universe, including older worlds. Your enabled local game modules
must reproduce its exact simulation identity; code and physics settings still need to match.
Leaving returns you to your own paused world.</p>
<dl>
  <dt>Host on this computer (desktop)</dt><dd>In the desktop game, choose <b>Host on this computer</b>
    to share your currently loaded world, including its ships, progress and local pilots. Send a displayed
    game link to friends on the same network, or choose <b>Copy game link</b>. Guests need only a browser
    with matching game modules. Keep the host game window open: the loaded world runs there, while the
    executable handles network connections. <b>Stop hosting</b> disconnects guests and lets you continue
    the same world solo. Internet play needs a reachable address and router/firewall setup; Google STUN
    is not used for this mode.</dd>
  <dt>Server link</dt><dd>The easiest way to play on different devices. Open the host's game link and join automatically.
    If the world has a password, enter it and choose <b>Join</b>. Once connected, <b>Copy game link</b> invites more friends.
    Your password is never included in the link. A link to <code>localhost</code> only works on the same computer.</dd>
  <dt>Invite code</dt><dd>
    <ol>
      <li>The host opens <b>Online → Invite code → Host with browser invites · Google-assisted connection</b>, chooses <b>Host this world</b>, then <b>Create invite</b>, and sends <b>Copy invite link</b> to a friend.</li>
      <li>The friend opens the link; their reply code is prepared automatically. They choose <b>Copy reply</b> and send it back.</li>
      <li>The host pastes the reply and connects automatically. <b>Connect player</b> also works if the code was typed or filled another way.</li>
    </ol>
    Make one invite per player. <b>Use Google STUN for internet invites</b> is on by default; turn it off for same-network play without public address discovery.
    Google STUN finds public addresses but does not relay connections, so some networks cannot connect directly.
    Offline HTML files use <b>Copy invite</b> instead of a web link; paste the code in your own copy of the game to prepare a reply.
    Reply codes last 10 minutes. Keep the host page open. If a direct link fails, use a server link.
    <b>Save connection report</b> downloads candidate counts and error codes without addresses or invite secrets.</dd>
  <dt>Server</dt><dd>Type a server address (like <code>192.168.1.20:6464</code>) and choose <b>Join</b>, or use
    <b>Scan local network</b>. A dedicated server keeps the world running and saves it on its own.
    If a result says <b>other version</b>, the client and server use different multiplayer versions: choose
    <b>Open server game</b> to use its matching client, or update both together.</dd>
</dl>
<p>For testing across tabs of one browser, open <b>Tools → Multiplayer debugging</b>. Choose <b>Host this world</b>
in one tab, then <b>Join</b> in the other.</p>
<p class="manual-note">When a browser tab hosts, the world runs in that tab. Keep it visible, because browsers slow down hidden tabs.</p>
<p><b>Other pilots’ orbits.</b> Faint amber lines preview their current coast, refreshed about once per second.
They assume no future engine burn. Under <b>Online → Other pilots’ orbits</b>, <b>Auto</b> shows them with up to
eight other connected pilots and hides them in larger groups. Choose <b>Always</b> to keep previews on, or <b>Off</b> to hide them.
Up to 16 flying vessels are previewed, giving each pilot one before filling spare slots with their other ships.
Your own prediction keeps its normal refresh rate. Surface contact, a changed reference body or leaving the session clears outdated previews.</p>
${deeper('running a dedicated server', `
<p>Download the server program from the project's releases page and start it. It prints the address players
should use, including a link that joins automatically. It also serves the game page itself, so guests need only a browser.
The desktop game's <b>Host on this computer</b> shares its loaded world while the game window stays open.
Use the separate server program for a world that runs and saves independently of a game window.
From a source checkout with Node and dependencies installed, run <code>npm run host</code> to build the game, start the server and open it.
Send friends on your Wi-Fi the LAN link printed by the server, not its localhost link.</p>
<p>To build matching standalone game and server programs from source, run
<code>npm run package -- --target=multiplayer</code>. This rebuilds current sources before packaging both.
<code>npm run build</code> updates the web and JavaScript bundles; it does not replace existing standalone executables.
After rebuilding, stop the old server and restart the new program, then reopen or reload the game.</p>
<ul>
  <li>The world runs at 100 physics steps per second and sends players 20 updates per second.</li>
  <li>It saves to <code>space-sim-data/world.json</code> every minute, when the last player leaves and on shutdown, and keeps timestamped backups.</li>
  <li>Settings live in <code>server.json</code>: name, password, player and ship limits, whether cheats are allowed, and which universe new worlds use.</li>
  <li>It uses TCP port 6464. For players outside your home network, forward that port on your router.</li>
</ul>
<p><b>How sync works.</b> The simulation is deterministic: the same inputs always give the same result on
every computer. Each world has a fingerprint of its physics, modules and settings, and a player whose setup
doesn't match can't join. Invite codes use WebRTC, a direct browser-to-browser link. <b>Use Google STUN for internet invites</b>
asks Google STUN for public addresses. STUN cannot relay traffic through a blocked direct path; a reachable dedicated server avoids that requirement.</p>
<p><b>Optional self-hosted web setup.</b> With Docker installed, run from the repository root:</p>
<pre><code>docker compose -f deploy/multiplayer/compose.yaml up -d --build</code></pre>
<p>Open <code>http://your-computer-address/#join=1</code> on your LAN. Worlds and backups persist in the Docker volume.
For internet play, point a domain at a reachable server, allow inbound TCP 80 and 443, and set <code>GAME_ADDRESS</code> to your domain
before running the same command. Caddy then handles HTTPS and secure WebSocket connections. Optional <code>GAME_NAME</code> and
<code>GAME_PASSWORD</code> set the world name and joining password. Share <code>https://your-domain/#join=1</code>.
For example, in a POSIX shell:</p>
<pre><code>GAME_ADDRESS=play.example.com docker compose -f deploy/multiplayer/compose.yaml up -d --build</code></pre>
<p>On PowerShell, set <code>$env:GAME_ADDRESS='play.example.com'</code> first. Stop with
<code>docker compose -f deploy/multiplayer/compose.yaml down</code>; keep the volumes to keep the world.
A home router behind carrier NAT may not accept incoming connections; use a reachable machine for internet hosting.</p>`)}`,
  },
  {
    id: 'settings',
    title: 'Look, feel and performance',
    summary: 'Sound, renderer, graphics quality, themes, profiler',
    html: `
<ul>
  <li><b>Settings → Renderer</b> switches between WebGL and 2D. 2D works on every device.</li>
  <li><b>Graphics: High / Low</b>. Low turns off lighting and planet surface detail, which helps older devices.</li>
  <li><b>Theme…</b> changes the colours of windows, the HUD, the grid and the starfield.</li>
  <li><b>Settings → Sound</b> turns procedural engine rumble and flight cues on or off. Adjust <b>Volume</b> to taste; both settings stay on this device. Sound starts after a click or key press.</li>
  <li>{{key:fullscreen}} toggles fullscreen. If the game feels slow, {{key:profiler}} opens the profiler, which shows where each frame's time goes.</li>
</ul>
<p>The engine sound follows the first pilot's active thrust. It fades when you release the engine, pause or enter time warp. A low thud marks a landing; crashes and water contacts have separate sounds. Hidden tabs stay quiet even with Run in background enabled. All flight information remains visible with sound off. To remove the sound module, open <b>ModMenu → Instruments &amp; display</b> and disable <b>Procedural sound</b>.</p>`,
  },
  {
    id: 'commands',
    title: 'Chat commands and sandbox tools',
    summary: 'Teleport, circularize, throw',
    html: `
<p>Open chat and type a command. <code>/help</code> lists them all.</p>
<ul>
  <li><code>/orbit Parvus 0.3</code> puts you in a circular orbit 0.3 km above Parvus.</li>
  <li><code>/circ</code> makes your current orbit circular.</li>
  <li><code>/tp Magnus</code>, <code>/warp 1000</code>, <code>/spawn</code>, <code>/god</code> and <code>/clear</code>.</li>
  <li><b>Throw</b> ({{key:throwShip}}, then drag): pull back to aim a launch and release. This changes the ship’s state directly; it is a sandbox shortcut.</li>
</ul>
<p>Commands that reposition a ship or change its orbit are sandbox cheats; the server can restrict them.
Enable the throw tool with <code>/throw on</code> or in <b>Settings → Gameplay</b>. Use normal engine controls to practise orbital burns.</p>`,
  },
];

const CREATORS: readonly ManualPage[] = [
  {
    id: 'overview',
    title: 'Making things with Spacelab',
    summary: 'What you can build, and where to start',
    html: `
<p>Spacelab is the engine, and <b>Space Sim</b> is the game that comes with it. Use data files and code modules
to customize worlds, flight rules, instruments and sound. Available controls and compatible modules depend on the game.</p>
<p>From easiest to most involved, you can make:</p>
<ol>
  <li><a data-page="universes">Universes and planets</a>: data files, no code.</li>
  <li><a data-page="shaders">Shader packs</a>: GLSL that changes how the scene looks.</li>
  <li><a data-page="games">Games and remixes</a>: a chosen set of modules, content and settings in one file.</li>
  <li><a data-page="modules">Code modules</a>: TypeScript that adds forces, rules, commands, instruments or cameras.</li>
</ol>
<p>The <b>ModMenu</b> window manages games and plugins. Its <b>Plugin controls</b> show simulation options and
instruments you can change now. Choose <b>Browse bundled packages</b> to search the included source packages by name
or category. These are source references: some bundled systems do not have individual switches in this alpha.</p>
${deeper('how the pieces fit', `
<p>A <b>game</b> lists two profiles. The <b>simulation profile</b> picks the modules that decide what happens,
such as the motion model and content. Those are part of every save and every multiplayer session. The
<b>presentation profile</b> picks modules that only affect what one viewer sees, such as renderers, overlays,
panels and cameras. Each viewer can change those freely.</p>
<p>Modules talk to each other through a public API (<code>packages/game-api</code>). A module can publish an API
with <code>context.expose()</code>, and another can use it with <code>context.dependency()</code>. The built-in
instruments use this: the velocity arrow, orbit markers and telemetry panel all read from a shared
<code>builtin.flight-data</code> module.</p>`)}`,
  },
  {
    id: 'flight-services',
    title: 'Flight planning services',
    summary: 'Reusable previews, plans, transfers and alarms in 0.6.4dev',
    html: `
<p>Flight tools are separate reusable services. A game can include the reader, editor or reminder logic without making them part of its physics.</p>
<ul>
  <li><b>Flight prediction</b> traces a coast in an isolated context, including supported SOI crossings. It does not advance the live world.</li>
  <li><b>Flight plans</b> store inert burn intent. The current evaluator supports safe same-body chains.</li>
  <li><b>Transfer planning</b> generates candidate departure and arrival nodes around the current body, using the selected motion and prediction services.</li>
  <li><b>Orbital alarms</b> provide simulation-time clocks. The host decides how to notify, exit warp or pause.</li>
</ul>
<p>For the player workflow, open the Players tab and read Planning a maneuver, Multi-node plans and saves, Transfer plans and Burn reminders.
Module-contributed creator guides in this topic list describe each service’s current contract.</p>
${deeper('compose through the public API', `
<p>The API v2 service tokens are <code>PREDICTIONS</code>, <code>FLIGHT_PLANS</code>, <code>TRANSFERS</code> and <code>ORBITAL_ALARMS</code>.
Their contracts live in <code>packages/game-api/src/flight-view.ts</code>, <code>flight-plans.ts</code>, <code>transfers.ts</code> and <code>alarms.ts</code>.
Use declared capabilities and provider selection; the editor’s optional connections preserve simpler compositions when providers are absent.</p>
<p><code>flight.plans@1</code> stores SI values, body identifiers and compatibility identities, without execution state.
<code>flight.transfers@1</code> requires the plan service and compatible analytic motion, rails horizons and future prediction seeds.
<code>flight.alarms@1</code> is a pure clock service without engine or UI dependencies.
<code>flight.alarm-catalogue@1</code> exposes read-only session entries; the optional <code>modules/alarm-panel/</code> window consumes that catalogue.
Transfer providers can declare relationship coverage so destination lists explain unsupported choices before a search.</p>
<p>Headless examples are the editable packages in <code>modules/flight-plans/</code>, <code>modules/transfer-planner/</code>
and <code>modules/orbital-alarms/</code>. The existing <code>modules/maneuver-editor/</code> composes them.
Keep preview jobs cancellable, dispose owned clocks/contexts, and leave execution to an explicit player choice.</p>`)}
`,
  },
  {
    id: 'universes',
    title: 'Universes and planets',
    summary: 'Star systems as JSON: bodies, orbits, starting points',
    html: `
<p>A <b>universe</b> holds one or more star systems. The game runs one system at a time.</p>
<ul>
  <li><b>Build a system:</b> open <b>Orbit Sandbox</b> from the ModMenu, create bodies, then use its Export controls to make a universe definition.</li>
  <li><b>Change the artwork:</b> <b>Tools → Planet designer</b> edits appearance only. Use <b>Copy JSON</b> to obtain an appearance block for a universe file. Applying a design in the editor does not change the universe’s physics or saved definition.</li>
  <li><b>Full control:</b> <b>Setup → Export</b> saves the current universe as a file. Edit it, then load it with
    <b>Setup → Import…</b>. Definitions export as <code>.spacedata</code>. Legacy <code>.spaceuniverse</code> definitions, JSON and gzip still import.</li>
</ul>
<p>The universes that come with the game, in <code>games/space-sim/universes/</code>, are good examples to copy.</p>
${deeper('the main fields', `
<dl>
  <dt>bodies</dt><dd>The star, planets and moons. Each has an <code>id</code>, a <code>name</code>, a
    <code>parentId</code> (<code>null</code> for the central body), a radius in metres, and either <code>mu</code>
    (G × mass, in m³/s²) or <code>mass</code> in kg. Its orbit around the parent goes in <code>ephemeris</code>.
    An optional <code>soi</code> sets the sphere of influence by hand. Otherwise it is worked out from the masses.</dd>
  <dt>surface</dt><dd>Optional terrain: mountains, craters, flat landing <code>pads</code>, and an ocean
    with <code>seaRadiusMetres</code>.</dd>
  <dt>presets</dt><dd>Starting points such as launch pads and circular orbits. They appear in Setup.</dd>
  <dt>vehicleDefaults</dt><dd>Engine acceleration, turn rate and starting throttle.</dd>
  <dt>appearance</dt><dd>Colours, atmosphere, rings and the procedural surface style.</dd>
</dl>
<p><code>universe.schema.json</code>, beside the bundled universes, lists every field and its limits, and
editors that understand JSON Schema will check your file as you type.</p>
<p><b>Tip:</b> choose μ and radius together. Surface gravity is μ/R², and circular orbit speed just above the
ground is √(μ/R). Small, dense bodies give short orbits that are quick to play.</p>`)}`,
  },
  {
    id: 'shaders',
    title: 'Shader packs',
    summary: 'Change the look of the scene with GLSL',
    html: `
<ol>
  <li>Open <b>Tools → Shaders</b> and choose <b>Export shaders</b>. This saves a <code>.spacedata</code> file with all the current shaders. Legacy shader JSON and GLSL still import.</li>
  <li>Edit the GLSL in any text editor.</li>
  <li>Choose <b>Load shader…</b> to apply your copy.</li>
</ol>
<ul>
  <li>Shaders need WebGL 2. Loading a pack while using the 2D renderer switches to WebGL.</li>
  <li>If a shader has an error, the game rejects it and keeps the previous one.</li>
</ul>
<p><code>examples/shaders/</code> has a finished pack to start from.</p>
${deeper('how packs are built', `
<p>A pack has the format <code>space-sim-shaders/1</code> and three passes, each with a vertex and a fragment
shader: <code>scene</code> (background, planets, atmospheres), <code>vector</code> (orbits, ship, HUD lines) and
<code>text</code> (labels). A pack may replace any of them and keep the defaults for the rest. A lone
<code>.frag</code> or <code>.glsl</code> file replaces only the scene fragment shader.</p>
<p>Planets with terrain are drawn by a separate built-in pass after your scene shader, so their outline always
matches what ships land on. Packs are GLSL text and can't run JavaScript.</p>`)}`,
  },
  {
    id: 'games',
    title: 'Games and remixes',
    summary: '.spacegame files: a whole setup in one file',
    html: `
<p>A <b>game</b> is a saved setup: which modules, content and settings to use, and where to start.
Space Sim, Orbit Sandbox, Flight starter, Planet viewer and Survey fixture are bundled games. <b>Flight starter</b> uses the same rails flight
physics as Space Sim with the 2D renderer, navball and throttle selected for presentation. Choose it in
ModMenu to start a smaller display setup, then add instruments or sound.</p>
<p>In a hosted or offline browser build, <code>?game=flight-starter</code> starts that bundled composition
directly. Its presentation profile selects the renderer, instruments and their settings. Viewer switches
keep the active modules' settings; reloading this startup URL restores that game's display choices.</p>
<p><code>?game=planet-viewer</code> opens a static body viewer without creating a ship, flight session,
audio or editor. WebGL is selected by default; choose <b>2D</b> under Renderer if needed. Detail switches between procedural artwork and simpler graphics. Drag to pan,
pinch or scroll to zoom, or focus the view and use arrow keys, +/− and R to fit.
<code>?game=survey-fixture</code> opens the bounded non-flight example: explicit
shared ticks, observations, one to four independent views and validated saved state. Click a view
before keyboard input. Survey state has its own versioned codec; it is not a flight universe save.</p>
<p>In source builds, <code>games/&lt;game&gt;/targets.json</code> uses the existing runtime-selection
format for exact per-target module references and provider choices. The host registers shipped
initializers and native adapters; listing a package in the catalogue does not enable it. Browser/offline
host services and Node storage policy are selected independently. Orbit Sandbox retains its explicit
legacy model adapter and does not claim flight-session compatibility. These host target plans are
source configuration; the current game exporter still writes its established game/runtime package
selection, rather than embedding arbitrary host adapters. Planet viewer and Survey fixture run from
the bundled source plans; their portable export is unavailable until a compatible non-flight game
adapter is defined. Flight games retain their existing export/import route.</p>
<ol>
  <li>Choose simulation plugins in <b>ModMenu → Plugins · simulation, data &amp; settings</b> and display modules in <b>Instruments &amp; display</b>.</li>
  <li>Under <b>Make a game from this world’s setup</b>, give it a name.</li>
  <li>Choose <b>Save as game</b> to keep it in this browser, or <b>Export .spacegame</b> to get a file you can share.</li>
</ol>
<p>Others load it with <b>Import game, plugin or universe…</b> and start it with <b>Play · new world</b>.</p>
${deeper('games, saves and code', `
<p>A game stores setup. A universe save (from <b>Fleet</b>) stores progress: the clock, ships and pilots. To continue
a save made with a custom game, start that game first, then load the save.</p>
<p>Importing a game never runs its code. Code runs only when you choose to play it, and a failed start leaves
your current world running. Exported <code>.spacegame</code> files are compressed and include the exact code,
data and settings so compatible targets can reproduce its setup. Check the game's supported targets
and required providers before sharing it.</p>`)}`,
  },
  {
    id: 'modules',
    title: 'Code modules',
    summary: 'Forces, rules, commands, instruments, cameras, sound',
    html: `
<p>Modules are written in TypeScript against the public API in <code>packages/game-api</code>. Open a section below for the details and examples.</p>
<details class="manual-deeper"><summary>Module kinds</summary>
<dl>
  <dt>Data</dt><dd>Only JSON, for example vehicle settings. Try <code>examples/modules/gentle-flight.json</code> with
    <b>ModMenu → Advanced · data &amp; profiles → Load module/profile…</b>.</dd>
  <dt>Simulation</dt><dd>Changes what happens: extra forces, a different physics integrator, world rules, or new
    pilot commands. These run on the host or server and are part of saves and multiplayer.</dd>
  <dt>Presentation</dt><dd>Changes what you see or hear: overlays, panels, camera modes and sound. You can switch these on
    and off at any time. The built-in instruments and procedural sound are presentation modules.</dd>
</dl>
</details><details class="manual-deeper"><summary>Audio providers</summary>
<p>The optional presentation <code>audio</code> provider exposes an <code>AudioProvider</code> factory. Its <code>AudioOutput</code> implements <code>resume</code>, <code>suspend</code>, <code>setVolume</code>, <code>setThrust</code>, <code>play</code> and <code>dispose</code>. Creation stays silent; the browser starts audio after user input and owns its lifetime independently of the renderer. Volume and thrust use levels from 0 to 1. Keep audio out of simulation state and saves. The bundled sample-free implementation is in <code>packages/modules/src/base/audio/</code>.</p>
</details><details class="manual-deeper"><summary>Responsibilities and optional connections</summary>
<p>Compose modules by their job: <code>camera-follow</code> owns basic camera control, <code>camera-smart</code> adds optional targeting and guided focus, <code>local-views</code> owns viewport layout, and input modules sample devices or define actions. The smart policy accepts arbitrary named targets and keeps separate state per camera. <code>ui-shell</code> owns the dock and workspace navigation, using shared window chrome from <code>ui-windows</code>.</p>
</details><details class="manual-deeper"><summary>Build and share an editable package</summary>
<ol>
  <li>For API v1, run <code>npm run module:new -- local.my-module my-module</code>, or copy a starter from
    <code>examples/packages/</code>: <code>force</code>, <code>numerical</code>, <code>telemetry</code> or <code>state</code>.
    This command currently generates v1 contracts. For API v2, start with the compatible
    <code>inventory</code> example or an appropriate editable package in <code>modules/</code>;
    v2 requires its matching manifest, initializer and services, beyond changing a format string.</li>
  <li>Set your namespaced <code>id</code>, name and licence in <code>module.json</code>. Edit <code>src/main.ts</code>,
    and include the licence texts and credits in <code>LICENSE</code> and <code>NOTICE</code>.</li>
  <li>Run <code>npm run module:build -- my-module/module.json my-module.spacemod</code>. This checks types,
    bundles the code and includes your editable source. Write the archive outside the source folder.</li>
  <li>Choose <b>ModMenu → Import game, plugin or universe…</b> and select the <code>.spacemod</code>.
    Installation only inspects it. Select the module in Plugins and apply to enable it.</li>
</ol>
<p>A <code>.spacemod</code> is a standard ZIP file. To edit a received package, run
<code>npm run module:unpack -- received.spacemod my-copy</code> with a new or empty destination.
After editing, run <code>npm run module:build -- my-copy/module.json</code>, then
<code>npm run module:pack -- my-copy edited.spacemod</code>.
Validate a file with <code>npm run module:validate -- edited.spacemod</code>.</p>
</details><details class="manual-deeper"><summary>Module configuration</summary>
<p>A module can declare numeric <code>settings</code> in its manifest, with a default, minimum,
maximum and optional increment (<code>step</code>). Add a readable <code>label</code> and plain-text
<code>description</code> so players know what each value does. The Plugins configuration displays
these controls and validates values before activating a candidate. Settings travel with the game;
saved viewer and controller preferences can override a module's presentation defaults.</p>
<p>Useful examples include split/merge distances and delay for split screen, controller deadzone,
navball frame and orientation, sound defaults, renderer pixel-density caps and profiler timing.
Defaults preserve the existing game. Declare the public capabilities a module needs, including
optional dependencies and compatible versions; changing a shared package also needs an appropriate
module version bump and a rebuilt archive.</p>
</details><details class="manual-deeper"><summary>Module logging</summary>
<p><code>modules/logging</code> provides <code>MODULE_LOGS</code>
(<code>diagnostics.logs@1.0.0</code>). A platform or network module declares this capability as optional,
captures it with <code>context.tryUse(MODULE_LOGS)</code> during initialization, then owns a logger scoped
to <code>context.module</code> when that identity is available. Use <code>log.write('info', 'reader.ready', 'Reader ready')</code>
for useful state changes; debug messages can use a lazy formatter. Missing logging leaves the consumer working.</p>
<p>The default history holds 512 recent entries with module ID, version and severity. Described settings
control severity, history, rate, message size and optional console output. Logs use diagnostic wall time
and stay outside simulation state, saves and fingerprints. Host lifecycle observation covers all tiers;
current tier rules keep a platform logging dependency out of authoritative and presentation modules.
The existing <b>Export log</b> includes host events and selected module log histories. History is bounded
and best effort; avoid frame-loop logging and live world objects. Nothing is uploaded automatically.</p>
</details><details class="manual-deeper"><summary>Forking and package compatibility</summary>
<p>To make your own version, run <code>npm run module:fork -- received.spacemod local.my-version my-copy</code>.
This keeps the original credits and inventory reference, changes the module identity and literal source
namespaces, and removes the compiled bundle. Review the source, edit it and rebuild before importing.
The fork keeps compatible service names so a game can select it as a replacement provider.</p>
<p><code>builtin.*</code> identities are reserved. Original shipped packages are recognized only through
an exact host catalogue pin; edited packages use a creator namespace. Local tools can inspect a recognized
original with <code>--catalogue=shipped-modules.json</code>. Recognition does not approve downloaded code
or override a build that disallows imported code.</p>
<p>The browser cannot compile TypeScript. Missing or stale bundles need a local rebuild. Binary assets
are preserved; API v1 exposes text assets only. Structured guides belong in <code>docs/players/</code>
or <code>docs/creators/</code>. API v2 device modules can contribute these pages to the Manual.</p>
</details><details class="manual-deeper"><summary>Installed modules and device modules</summary>
<p>Imported modules are stored on this device without running their code. Reloading the page restores
the installed files; it does not enable them. If storage is unavailable or full, the ModMenu reports
session-only installation. Export a copy to keep it. Removing an installed module does not delete saved universes.</p>
<p>Open <b>ModMenu → Device and network modules</b> for packages using <code>space-sim-game-api/2</code>.
Choose an exact installed version, review its dependencies, then select <b>Apply device modules and restart</b>.
This starts a fresh world. Device modules remain disabled in other games and after a page reload.
Saving or exporting a game includes its applied selection, exact versions and editable packages.
Choose Play in the ModMenu to enable that game's selection again. Unapplied edits are not exported.
Distinct server targets retain their explicit configuration; new device-only selections omit devices on the server.</p>
<p>V2 device packages declare a <code>platform</code> or <code>network</code> tier and versioned capability
requirements. Their synchronous initializer can contribute actions, input sources, transports,
declarative controls and structured Manual pages. Typed host services are imported as keys such as
<code>CORE_UI</code>, then requested with <code>context.use(CORE_UI)</code>. Declare
<code>{ name: 'core.ui', version: '^1.0.0' }</code> in the manifest's requirements before using it.
Optional connections declare <code>optional: true</code> and use <code>context.tryUse(key)</code>.
It returns absence only when that declared optional capability has no binding. Invalid keys,
undeclared access, wrong versions and broken providers still report errors. Required access uses
<code>context.use(key)</code>. Reconfigure by preparing and activating a new candidate; own subscriptions
and resources so disposal removes old enhancements.</p>
<p>Extracted first-party input packages live in <code>modules/</code>. Their editable v2 sources expose
flight action bindings, keyboard/touch/gamepad factories, player controllers, local pilot registries
and view allocation through public typed services. Generic device sources accept namespaced actions;
flight mappings remain explicit compatibility adapters. A controller routes intent through an adapter
that validates the session player's ownership. Local seat, player, entity and viewport identities are
separate. Each viewport gets its own camera; view allocation never advances a world. The remaining
Space Sim manifest composition remains in progress. The reusable follow camera and its explicit flight adapter are available in <code>modules/camera-follow</code>.</p>
<p>The editable <code>net-websocket</code> package provides <code>WEBSOCKET_TRANSPORT</code>
(<code>net.websocket@1.0.0</code>) for ordered text connections. It owns URL handling, timeout,
message limits, cancellation and cleanup; it has no flight, renderer or UI dependency. Declare the
capability before requesting it, and pass an abort signal when connecting. Cancelling closes the
link; replacing or removing its provider disposes its connections. Native WebSocket support is
needed only when connecting. A compatible session adapter must still agree commands, snapshots,
saves and replay; sharing a transport alone does not establish multiplayer compatibility.</p>
</details><details class="manual-deeper"><summary>Universe saving modules</summary>
<p>Saved progress is a <b>universe</b>: use <b>Save universe</b> and <b>Load universe…</b>
with <code>.spaceuniverse</code> files. Reusable setup and planet definitions export separately.</p>
<p><code>modules/universe-saves</code> supplies cancellable save/load commands over engine validation
and the host's existing container codecs. <code>modules/universe-files</code> owns browser file IO and
downloads; <code>modules/universe-save-controls</code> mounts independent controls over those commands.
A compatible host still owns package approval and atomic world activation. The supplied guard rejects
loads if the session changes while a file or package is being prepared.</p>
<p><code>modules/universe-server-storage</code> owns serialized saves, atomic file replacement,
backup retention and recovery over borrowed native disk operations. Existing server file names and
formats are preserved. Missing exact gameplay packages require explicit recovery and never authorize
code installation from a universe file. Storage and UI providers can be replaced independently.</p>
</details><details class="manual-deeper"><summary>Customizable player views</summary>
<p><code>modules/player-view</code> provides <code>PLAYER_VIEWS</code>, a shared foundation
for each player's input, camera, HUD and appearance adapters. Games choose the parts they need.
Controller, camera and HUD wrappers reuse the existing public interfaces; custom appearance adapters
own their own settings and rendering hooks. Each mutable instance belongs to one player/view.</p>
<p>Reassigning a target releases old input and gestures first. Replacing an adapter affects only that
player; removing the view cleans up its owned parts. Borrow cameras already owned by local views.
This lifecycle never creates or steps a world. The survey uses it for controls/cameras, and the flight
host uses it for HUD/appearance. Further flight input/camera migration and customization screens
remain future work; this does not add a new gameplay or saved-physics schema.</p>
</details><details class="manual-deeper"><summary>Portable trainer vehicles</summary>
<p><code>modules/vehicle-trainer</code> contributes <code>spacelab.trainer/orbit-trainer</code>
through <code>contributeVehicle</code>. A compatible game supplies shared physics, valid starts and
session ownership. Build a <code>space-sim-vehicles/1</code> catalogue from enabled authoritative
vehicle contributions and pass it to world creation. The trainer inherits the selected system's
<code>vehicleDefaults</code>; another craft can declare fixed handling in the same world.
Use <code>world.contextFor(ship)</code> for that craft's motion, prediction and flight observations.</p>
<p>Vehicle-aware saves use version 4, retaining every craft's identity and the exact catalogue.
Legacy saves map to the trainer without changing flight state. Loading or joining requires the
matching gameplay packages; a missing vehicle produces a recovery message. Saves never install code.
Controls, cameras and per-view instruments remain independently replaceable.</p>
<p><code>modules/appearance-trainer</code> owns the optional chevron and flame. Collect
<code>contributeVehicleAppearance</code> results with <code>createVehicleArtwork</code> and pass the
result as <code>Render2DOptions.vehicles</code>. Set <code>vehicleId</code> on primary and fleet render
records. Canvas and WebGL consume the same immutable vectors. Missing artwork leaves a small
position marker; headless flight needs no artwork, renderer or device.</p>
<p>Portable <code>render.canvas</code> and <code>render.webgl</code> factories draw public flight frames or
body-only scenes with independent cameras. A scene needs no trainer, flight HUD or world scheduler.
Supply physical bodies and a read-only surface-query port; compatibility defaults remain in the host
adapter. The WebGL factory also supplies body previews. Shader sources are owned by the separate
<code>render.vector-shaders</code> package; all three drawing passes retain their ABI and atomic replacement.
Shader <code>u_time</code> follows real presentation seconds, including while physics is paused. Scene viewers may set an explicit animation epoch.</p>
<p>WebGL materials implement <code>vec4 material(vec2 position)</code>, with normalized body-local position,
<code>u_radiusMetres</code> in metres and <code>m_*</code> float parameters. The renderer preserves the physical
surface silhouette. Post effects implement <code>vec4 effect(vec2 uv, vec4 color)</code>; bottom-left UV,
<code>u_scene</code>, pixel <code>u_resolution</code>/<code>u_sourceResolution</code> and <code>p_*</code> parameters
form the fixed ABI. Module candidates resolve declared assets inertly through <code>renderEffects()</code>.
A compatible renderer compiles the resolved graph before activation. Eight materials/four post passes,
256 KiB sources and half/full resolution bound the graph. Optional RGBA8 targets are pooled and released
with the renderer. Canvas reports unsupported effects before play.</p>
<p>The independent theme factory owns preferences, artwork, styles and subscriptions. Its optional
customizer mounts reusable settings over an injected controller and root, with scoped shortcuts and
cleanup. Procedural sound retains <code>builtin.audio</code>; separate sound controls own gesture/visibility
handling, preferences and reusable settings content. Read-only flight observations map confirmed contacts
and actual thrust to cues. Removing sound leaves silent flight; replacing a renderer does not replace sound.</p>
<p>The editable <code>spacelab.session-flight</code> adapter provides <code>session.flight@1.0.0</code>
through public world, clock, save, motion and command services. It preserves the existing flight
protocol, ownership, replay, reconnect and chat behavior; non-flight state uses a separate explicit
adapter. <code>spacelab.discovery-lan</code> borrows a transport and greeting codec.
<code>spacelab.chat-console</code> supplies optional shared chat and command UI through explicit DOM,
visibility and window ports, with owned observers, controls and cleanup.</p>
<p>Authoritative v2 modules register world, player or entity records with <code>contributeData</code>.
Each adapter owns a namespaced ID, schema version, bounded initial value, validation, save migrations,
authorization and a deterministic command reducer. For example, an inventory module can validate item
counts and authorize a pilot to discard their own items. Session consumers read immutable values from
<code>session.world.data</code> and request changes with <code>session.dataCommand</code>; the host supplies
the authenticated player, actual owner and tick. It never accepts arbitrary remote record replacement.</p>
<p>The flight adapter negotiates <code>space-sim-module-data/1</code> explicitly, requires exact active
schemas, and replicates complete snapshots and changed records with revision checks. Other compatible
session adapters can reuse the same public store contracts. Save version 3 records adapters and state;
registered one-version migrations run only on save load. Missing adapters, invalid state or incompatible
versions reject the candidate before publishing it. Ordinary games retain their existing save format.
Values are limited to 16 KiB each, with 4 MiB/4,096 records per world. Every replicated record is readable
by all session peers; credentials and private server records belong outside this store. Existing motion
and rule state retains its own hooks. The editable inventory example demonstrates this API.</p>
<p><code>spacelab.session-join</code> negotiates a versioned server pack before the authenticated session
constructs its mirror; <code>spacelab.join-review</code> supplies its replaceable review dialog. Dedicated
hosts opt in with <code>--offer-game-pack</code> or <code>offerGamePack: true</code> in server settings.
Only enabled distributable authority and explicitly required client capabilities are offered; optional
host windows and HUD choices remain optional. Pack size, chunk order, full inventory, code flags,
licenses and SHA-256 identity are checked before preparation. The candidate must reproduce the offered
lock and simulation fingerprint. Approval is separate from cached bytes and scoped to the source and
exact offer; verified installation commits packages, cache and provenance together. Existing password
and ownership checks still apply. Prejoin chunks have their own limits; flight commands keep theirs.</p>
<p>The editable <code>spacelab.net-webrtc</code> package provides <code>net.webrtc-signaling@1.0.0</code>.
Its reply handle exposes a code before the connection Promise resolves, preserving manual code exchange.
The host explicitly chooses STUN; diagnostics contain counts and error codes. Abort signals and handle/provider
disposal close gathering, pending and established links. The transport does not define session semantics,
ownership or saves; compatible games choose their own session adapter.</p>
<p>The Node-only <code>net-node-ws</code> package provides <code>NODE_WEBSOCKET_TRANSPORT</code>
over a borrowed HTTP upgrade and byte stream. It owns the protocol, framing, compression negotiation,
limits, heartbeat and close handshake. Declare its required <code>core.websocket-codecs</code> service;
the Node host supplies native hashing and bounded compression primitives. The host owns the HTTP
listener. Replacing or removing the provider closes accepted links. Browser builds do not load
the native adapter.</p>
<p>The editable <code>net-tab</code> package provides <code>TAB_TRANSPORT</code>, a factory for
same-origin text links and discovery. Supply an explicit game scope and session protocol ID; its
BroadcastChannel and Web Lock names use both. Each created network owns its hosts, watchers and
connections, with cancellation and provider cleanup. Web Locks are optional, with heartbeat loss
detection when unavailable. The Space Sim compatibility adapter retains the existing local channel.
New games should use their own scope and a compatible session adapter.</p>
<p>V2 authoritative modules can be included in a game's explicit runtime target alongside its legacy base profile.
Browser and dedicated-server targets use the same package resolver and world adapter. Progress records its exact plans, settings and provider choices. Load progress directly in Fleet;
the loader reconstructs it from packages already installed on this device, checks its lock and physical
fingerprint, and asks before enabling a different code selection. Missing packages must be imported
through the ModMenu; progress never embeds or downloads code. Cancelling or a failed preparation keeps
the previous game active. Both Apply controls support mixed legacy/v2 games and restart the world.
Use Include required modules for the complete ID/capability closure, or Remove dependent modules to
review a reverse removal. Ambiguous capability providers require an explicit choice; conflicts are
reported before code runs. Exact settings and provider choices survive save/export. V2 renderer hooks still require the renderer adapter;
keep renderer layers, panels and cameras in the legacy presentation profile for now.</p>
<p>Legacy <code>.module.json</code> and <code>.spaceplugin</code> files still import. A legacy code artifact
contains bundled JavaScript and source hashes, so its ZIP wrapper is labelled “original source unavailable”.
Use <code>module:convert old/module.json new-folder</code> with the original source folder to make a fully editable package.
Package hashes cover every file, including code, docs and licences. Recompressing a ZIP preserves the hash;
editing a file changes it. A matching hash identifies bytes; it does not establish that code is safe.</p>
</details><details class="manual-deeper"><summary>Keep setup, data and progress separate</summary>
<ul>
  <li><code>.spacegame</code>: game setup and its exact module selection; code lives in <code>modules/</code>, reusable data in <code>data/</code>.</li>
  <li><code>.spacemod</code>: a code module with its editable source, assets and licence.</li>
  <li><code>.spacedata</code>: universe definitions, shader packs or reusable content. Definitions describe the universe; they contain no flight progress.</li>
  <li><code>.spaceuniverse</code>: saved progress. <code>save.json</code> describes the save;
    <code>state/</code> holds the clock, pilots, ship chunks and module state; <code>data/universe.json</code>
    holds a snapshot of the definitions needed to resume it. Saves never embed code.</li>
</ul>
<p>Use <b>Fleet → Save universe</b> and <b>Load universe…</b> for progress. Use <b>Setup → Export</b> and
<b>Import…</b> for definitions, or import reusable data in the ModMenu. Old save JSON still loads. Older
<code>.spaceuniverse</code> definition files still import through Setup or the ModMenu; their contents identify them.</p>
</details><details class="manual-deeper"><summary>Build a game collection</summary>
<p><b>Export game</b> writes a ZIP <code>.spacegame</code> containing <code>game.json</code>, an exact
<code>game.lock.json</code> and its selected custom modules. Built-in v1 providers remain supplied by the engine.
The exact package identities are separate from legacy simulation identities, so old saves keep their locks.</p>
<p>For local tooling, use <code>npm run game:build -- game.json my-game.spacegame</code> and
<code>npm run game:validate -- my-game.spacegame</code>. The builder accepts existing game descriptors,
legacy plugin collections and profiles whose exact code is supplied. Unpack a game with
<code>module:unpack</code>, rebuild its embedded modules, then run <code>game:build</code> on its
<code>game.json</code> to refresh the exact lock. No import runs tests, compiles code or fetches dependencies.</p>
<p class="manual-warn">A code module can do anything the page or server can. Only install code from people you trust.</p>
${deeper('the API surface', `
<p>A module exports one synchronous <code>initialize(context)</code> function. From the context it can:</p>
<ul>
  <li><b>Simulation:</b> <code>contributeForce</code> (add an acceleration), replace the motion model, add world
    rules that run every step, and add pilot commands that the host carries out.</li>
  <li><b>Presentation:</b> <code>contributeLayer</code> (up to 256 shapes per frame, drawn in world or screen
    space), <code>contributePanel</code> (up to 16 label and value rows, updated up to 4 times a second) and camera hooks.</li>
  <li><b>Settings:</b> declare numbers in the manifest with a default, minimum and maximum. Players can edit them in the ModMenu.</li>
  <li><b>Dependencies:</b> list other modules with version ranges such as <code>^0.1.0</code>, and use their APIs.</li>
</ul>
<p>Presentation hooks receive a frozen snapshot of the frame: ship state, orbit elements, ground clearance,
prediction and camera. If a hook throws an error, only that contribution is switched off and the world keeps running.</p>
<p>The build only accepts imports from <code>@space-sim/game-api</code> and files inside your module's folder.
<code>examples/modules/README.md</code> lists every example and how to try it.</p>`)}</details>`,
  },
  {
    id: 'determinism',
    title: 'Rules for simulation modules',
    summary: 'Determinism: keep worlds identical on every computer',
    html: `
<p>Determinism means that the same starting state and inputs produce exactly the same result.
The host or server advances the authoritative multiplayer world; clients receive snapshots. Replays, prediction and compatible hosts still need reproducible results. Simulation
modules have to follow a few rules:</p>
<ul>
  <li>Use the maths functions from the API (<code>sin</code>, <code>cos</code>, <code>atan2</code>, <code>exp</code> and so on) instead of <code>Math.sin</code> and friends.</li>
  <li>Use the seeded random number generator from the context. Never use <code>Math.random()</code>.</li>
  <li>Keep state in the per-ship or shared-world module state that the context provides, so it saves, loads and syncs.</li>
</ul>
${deeper('why these rules exist', `
<p>Browsers may compute <code>Math.sin</code> and similar functions slightly differently. Over thousands of steps,
a difference in the last digit grows into ships in different places. The API's maths functions give
bit-identical results everywhere.</p>
<p>State kept in ordinary variables is lost when a world is saved, and a joining player never receives it.
Module state is part of the save and of every snapshot sent to players.</p>
<p>Each world has a fingerprint built from its modules' code, settings and model identities. Put every
parameter that affects physics into your model identity, so two different setups can never be mistaken for
the same one.</p>`)}`,
  },
  {
    id: 'sharing',
    title: 'Sharing and licensing',
    summary: 'Exports, credits and trust',
    html: `
<ul>
  <li>To share your work, send the exported file: <code>.spaceuniverse</code> (progress), <code>.spacedata</code> (reusable definitions), <code>.spacegame</code> (setup),
    <code>.spacemod</code> (editable module), a legacy <code>.spaceplugin</code>, a shader <code>.json</code> or a <code>.module.json</code>.</li>
  <li>Spacelab uses the MIT licence. Give your module a licence, and credit any code or data you include.</li>
  <li>Universe saves hold state and the names of the modules they need. They never contain code.</li>
</ul>`,
  },
];

export const MANUAL: Readonly<Record<ManualAudience, ManualSection>> = Object.freeze({
  players: { label: 'Players', intro: 'How to fly, orbit, land and play together. Open "Go deeper" sections for the maths.', pages: PLAYERS },
  creators: { label: 'Creators', intro: 'How to make universes, shaders, games and modules.', pages: CREATORS },
});
