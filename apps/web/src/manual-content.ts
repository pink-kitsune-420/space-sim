/** In-game Manual text. Two audiences only: players and creators.
 *
 * Writing style: short plain sentences a beginner can follow, then an optional
 * `<details class="manual-deeper">` section with the maths and detail for readers who want more.
 * Define a term the first time it appears. Avoid stock phrasing ("it's not X, it's Y", "the secret is").
 *
 * Pages are trusted first-party HTML. Tokens the Manual expands when a page opens:
 * - `{{key:<actionId>}}` the pilot's current key for an action in `input-config.ts`;
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
    summary: 'What the game is and where everything lives',
    html: `
<p>Space Sim is a 2D spaceflight game with real orbital physics. Gravity pulls your ship toward planets, and your
engine changes its speed and direction. With enough sideways speed, your ship keeps falling around a planet
without ever reaching the ground. That path is called an <b>orbit</b>.</p>
<h3>The dock</h3>
<p>The column of buttons at the edge of the screen opens windows:</p>
<ul>
  <li><b>Setup</b>: pick the universe, the star system and where your ship starts. <b>Reset flight</b> is here too.</li>
  <li><b>Ship</b>: throttle, turning and engine buttons for touch and mouse.</li>
  <li><b>Fleet</b>: your ships, plus <b>Save world</b> and <b>Load world…</b>.</li>
  <li><b>Online</b>: host friends or join a server.</li>
  <li><b>Instruments</b>, <b>Trajectory</b> and <b>Telemetry</b>: choose what the flight view shows.</li>
  <li><b>Settings</b>, <b>Tools</b>, <b>Manual</b> and <b>Library</b>: display options, creator tools, this manual, and other games and plugins.</li>
</ul>
<p>Click a dock button again or press <kbd>Esc</kbd> to close its window. The <b>pin</b> button keeps a window open
while you fly. Press {{key:pause}} to pause.</p>
<h3>Where to start</h3>
<ol>
  <li>Look over <a data-page="controls">Controls</a>, or hold {{key:engine}} to fire the engine and steer with {{key:turnLeft}} {{key:turnRight}}.</li>
  <li>Follow <a data-page="first-orbit">Your first orbit</a>.</li>
  <li>Read <a data-page="orbits">How orbits work</a>. The rest of the game is easier once you know the three rules there.</li>
</ol>
<p class="manual-note">Space Sim is free, works offline, and needs no account.</p>`,
  },
  {
    id: 'controls',
    title: 'Controls',
    summary: 'Keyboard, touch and gamepad',
    html: `
<p>The table shows your keys as they are set right now. To change any of them, open
<b>Settings → Controls &amp; keybindings…</b>.</p>
<div data-manual-controls></div>
<h3>Touch and mouse</h3>
<ul>
  <li>Hold <b>BURN</b> to fire the engine. Hold the turn buttons to rotate. Drag the throttle slider in <b>Ship</b>.</li>
  <li>Drag the view to move the camera. Pinch or use the mouse wheel to zoom. Flick the view to send the camera gliding.</li>
</ul>
<h3>Gamepad</h3>
<p>Plug in a controller and press any button. Steam Deck, Xbox, PlayStation and most joysticks work.</p>
${deeper('tuning a controller', `
<p>Open <b>Settings → Controls &amp; keybindings… → Controllers</b>. Choose the player to configure, then change their stick axes, inversion, dead zone or button bindings. The <b>dead zone</b> is how far a stick must move before the game reacts; raise it if the ship drifts while you aren't touching the stick. Select <b>+</b> beside an action and press a controller button to bind it. Gameplay input is held while this dialog is open.</p>`)}`,
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
    id: 'first-orbit',
    title: 'Your first orbit',
    summary: 'From the launch pad to a stable orbit around Primus',
    html: `
<p>In <b>Setup</b>, choose the <b>Primus System</b> and <b>North pad · ready to launch</b>. Primus is a small,
heavy practice planet. Orbits there are a few hundred metres up and one lap takes about half a minute.</p>
<ol>
  <li><b>Climb.</b> Press {{key:throttleUp}} until the throttle is full, then hold {{key:engine}}. Go straight up for a moment.</li>
  <li><b>Tip over slowly.</b> Turn toward the horizon a little at a time with {{key:turnLeft}} or {{key:turnRight}}.
    Sideways speed is what keeps you up, so you want more of it as you climb.</li>
  <li><b>Watch the line.</b> The trajectory line shows where you will go if you stop the engine. If it hits the
    ground, keep burning sideways.</li>
  <li><b>Stop at the right height.</b> The <b>Ap</b> marker is the highest point of your path. When it is well
    above the ground, let go of the engine.</li>
  <li><b>Finish at the top.</b> Coast up to Ap. Point the ship the way you are moving (along the velocity arrow)
    and burn again. The low side of the path lifts. Stop when the <b>Pe</b> marker, the lowest point, is safely
    above the ground.</li>
</ol>
<p>You are now in orbit. Press {{key:warpUp}} to speed up time and watch the ship circle the planet with the engine off.</p>
<p class="manual-note">To try again, press {{key:reset}}. To start in orbit instead, pick <b>Circular orbit · 128 m altitude</b> in Setup.</p>
${deeper('the numbers behind this launch', `
<p>Primus has a radius of 512 m and a gravitational parameter μ of 13,107,200 m³/s². Surface gravity is
μ/R² = <b>50 m/s²</b>, about five times Earth's. Your engine gives up to 125 m/s², so at full throttle the
<b>thrust-to-weight ratio</b> is 2.5. At the default half throttle it is 1.25, barely enough to lift off.</p>
<p>A circular orbit 128 m up (r = 640 m from the centre) needs a speed of √(μ/r) ≈ <b>143 m/s</b> and takes
2πr/v ≈ <b>28 s</b> per lap. Anything below 143 m/s at that height falls back down. Above √(2μ/r) ≈ 202 m/s
you escape Primus entirely.</p>
<p>A <b>gravity turn</b> is the steady tilt in step 2. Climbing straight up the whole way wastes fuel because
the engine spends all its effort holding you up against gravity. Tilting early puts that effort into
sideways speed, which you need for orbit anyway.</p>`)}`,
  },
  {
    id: 'orbits',
    title: 'How orbits work',
    summary: 'Orbital mechanics for beginners, with optional maths',
    html: `
<h3>Falling around a planet</h3>
<p>Throw a ball and it curves down to the ground. Throw it faster and it lands farther away. Throw it fast
enough and the ground curves away beneath it as fast as it falls. The ball keeps falling and never lands.
That is an orbit.</p>
<h3>Words you will see</h3>
<dl>
  <dt>Prograde and retrograde</dt><dd>Prograde is the direction you are moving. Retrograde is the opposite.
    Burning prograde speeds you up. Burning retrograde slows you down.</dd>
  <dt>Apoapsis (Ap) and periapsis (Pe)</dt><dd>The highest and lowest points of your orbit.</dd>
  <dt>Radial out and radial in</dt><dd>Straight away from the planet, and straight toward it.</dd>
  <dt>Eccentricity (e)</dt><dd>How stretched the orbit is. 0 is a circle. Values near 1 are long, thin ovals.
    At 1 or above, the ship escapes and never comes back.</dd>
  <dt>Sphere of influence (SOI)</dt><dd>The region where one body's gravity is the one that counts. When you
    cross into a moon's SOI, your path is drawn around the moon instead.</dd>
</dl>
<h3>Three rules</h3>
<ol>
  <li><b>A burn moves the opposite side of the orbit.</b> Burning prograde at Pe raises Ap. Burning prograde at
    Ap raises Pe. This is why you finish a launch at the highest point.</li>
  <li><b>Lower orbits are faster.</b> A lower orbit takes less time per lap. To catch a ship ahead of you,
    drop to a lower orbit and let it carry you forward.</li>
  <li><b>Sideways speed keeps you up.</b> Climbing straight up costs fuel and gets you nowhere. Turn early and
    build sideways speed.</li>
</ol>
<h3>Travelling to a moon</h3>
<p>To reach Parvus, the moon of Primus, burn prograde until your Ap reaches Parvus's orbit. Time the burn so
Parvus arrives at that point when you do. When your path enters Parvus's sphere of influence, you have arrived.</p>
${deeper('the equations', `
<p>These hold for every body in the game. μ is the body's gravitational parameter (G × mass), r is your
distance from its centre, and a is the <b>semi-major axis</b>, half the longest width of the orbit.</p>
<ul>
  <li><b>Circular speed</b>: <code>v = √(μ / r)</code></li>
  <li><b>Escape speed</b>: <code>v = √(2μ / r)</code>, about 1.41 times circular speed.</li>
  <li><b>Vis-viva</b> gives your speed anywhere on any orbit: <code>v² = μ (2/r − 1/a)</code></li>
  <li><b>Period</b> (time per lap): <code>T = 2π √(a³ / μ)</code>. Double the size of an orbit and a lap takes 2.8 times as long.</li>
  <li><b>Specific orbital energy</b>: <code>ε = v²/2 − μ/r</code>. Negative means bound, zero or positive means
    escape. Telemetry shows it as <i>Orbital energy</i>, and it stays constant while you coast.</li>
</ul>
<p><b>Why a burn moves the other side.</b> Your orbit's energy depends only on a. A prograde burn adds energy,
so a grows. You are still at the same point when the burn ends, so that point stays put and the far side
moves out.</p>
<p><b>Burn where you are fastest.</b> The same Δv (change in velocity) adds more energy when you are already
moving fast, because energy grows with v². That is the <b>Oberth effect</b>, and it is why big burns go at periapsis.</p>`)}
${deeper('a worked transfer to Parvus', `
<p>The cheapest path between two circular orbits is a <b>Hohmann transfer</b>: half an ellipse that touches the
low orbit at its Pe and the high orbit at its Ap.</p>
<ul>
  <li>Start: circular orbit 128 m up (r₁ = 640 m), speed 143 m/s.</li>
  <li>Parvus orbits Primus at r₂ = 15,360 m. The transfer ellipse has a = (r₁ + r₂)/2 = 8,000 m.</li>
  <li>Speed needed at Pe of the transfer, from vis-viva: √(μ(2/640 − 1/8000)) ≈ 198 m/s. The burn is about <b>55 m/s prograde</b>.</li>
  <li>The coast to Ap is half a transfer period: π √(a³/μ) ≈ <b>620 s</b>, about 10 minutes of game time.</li>
  <li>Parvus takes 3,298 s per lap, so it moves about 68° during your coast. Burn when Parvus is about
    <b>112° ahead</b> of you, and you meet it.</li>
</ul>
<p>Spheres of influence are worked out with <code>r_SOI ≈ a (m / M)^(2/5)</code>. Space Sim uses
<b>patched conics</b>: inside each SOI, only that body's gravity acts, and your path is an exact ellipse or
hyperbola. When you cross a boundary, the game switches the path to the new body.</p>`)}`,
  },
  {
    id: 'flight-view',
    title: 'Reading the flight view',
    summary: 'Trajectory, markers, velocity arrow, telemetry',
    html: `
<ul>
  <li><b>Trajectory line</b>: where you will coast if you stop the engine now. A closed loop means you are in
    orbit. A line that ends at the ground means you will hit it.</li>
  <li><b>Ap and Pe markers</b>: the high and low points, with their height and time to reach them.
    Switch them on in <b>Instruments → Orbit markers</b>.</li>
  <li><b>Velocity arrow</b>: the direction you are moving, with your speed (<b>Instruments → Velocity</b>).</li>
  <li><b>Navball</b>: your ship's tilt against the horizon. See <a data-page="navball">Navball</a>.</li>
  <li><b>Trajectory window</b>: Pe, Ap and impact numbers.</li>
  <li><b>Maneuver planner</b>: click or tap the coast line to place a planned burn. See <a data-page="maneuvers">Planning a maneuver</a>.</li>
  <li><b>Telemetry window</b>: your speed split into up-down and sideways parts, local gravity, and orbit timing.</li>
  <li><b>Camera</b>: {{key:camera}} switches between following the ship, a view of the planet, and free movement.
    {{key:orientation}} switches between north-up and horizon-up. Zoom with {{key:zoomIn}} {{key:zoomOut}}.</li>
</ul>
<p>You can switch off any instrument in <b>Library → Instruments &amp; display</b>.</p>
${deeper('what the telemetry numbers mean', `
<dl>
  <dt>Radial speed</dt><dd>How fast you are climbing (+) or falling (−).</dd>
  <dt>Horizontal speed</dt><dd>Your speed along the horizon. Compare it with circular speed, √(μ/r), to see how close you are to orbit.</dd>
  <dt>Flight path angle</dt><dd>The angle between your motion and the horizon. 0° at Ap and Pe, positive while climbing.</dd>
  <dt>Local gravity</dt><dd>μ/r² at your current height. It weakens with the square of distance.</dd>
  <dt>Thrust / weight</dt><dd>Engine acceleration divided by local gravity. Above 1 you can hover or climb straight up.</dd>
  <dt>Orbital energy</dt><dd>v²/2 − μ/r. It only changes when you burn.</dd>
  <dt>Period, time to Pe and time to Ap</dt><dd>Exact values from your current orbit, recalculated every frame.</dd>
</dl>`)}`,
  },
  {
    id: 'maneuvers',
    title: 'Planning a maneuver',
    summary: 'Click a trajectory, plan a burn, preview the orbit',
    html: `
<p>A maneuver node marks a future point where you intend to change your velocity. Planning a burn leaves your ship coasting.</p>
<ol>
  <li>Enter an unpowered orbit. Zoom out until you can see the coast line, then click or tap it. An amber diamond marks the node and the <b>Maneuver</b> window opens.</li>
  <li>Set <b>Prograde Δv</b> to add speed along your motion; a negative value is retrograde and slows you down. Set <b>Radial Δv</b> to push away from the body; a negative value pushes inward. Δv means a change in velocity, measured in metres per second.</li>
  <li>The dashed amber line previews the coast after that burn. Click a different point on the original coast line to move the node, or edit <b>Burn in (s)</b>. The + and − buttons adjust by 1 m/s; Shift-click adjusts by 10 m/s.</li>
  <li>Use the countdown and full-throttle burn estimate to prepare. <b>Warp to burn</b> approaches the node and returns to normal speed 10 seconds plus half the estimated burn duration beforehand. Only the host controls warp. Steering, thrust, pausing, hiding the tab or <b>Stop warp</b> cancels the approach.</li>
  <li>Turn toward the amber diamond on the navball and fire the engine yourself. Centre the estimated burn on the node time. The amber arrow at the node also shows the intended burn direction.</li>
</ol>
<p>For a fully autonomous maneuver, choose <b>Execute burn</b>. It warps toward the selected node, returns to normal speed, turns toward the burn direction, fires the engine around the node time, and cuts off after delivering the planned Δv. It adjusts the final tick's throttle for small burns and leaves throttle at zero when complete. Allow enough time before the node for alignment and half the burn duration. Autonomous execution is available in solo play and for the host's selected ship; remote pilots can still plan and fly manually.</p>
<p><b>Abort burn</b> immediately releases engine and steering control. Manual steering, engine or throttle input, changing warp, pausing, opening Controls, hiding the tab, switching ships, disabling the instrument or a changed trajectory also aborts. A partly executed burn needs a new plan. Execution stays at normal speed after cutoff.</p>
<p>Use <b>Delete node</b> to remove the plan. Close the editor and reopen it from the <b>Maneuver</b> dock button. Disable the tool in <b>Instruments → Maneuver planner</b>.</p>
<p>Each piloted ship has one local plan for this flight session. Plans are not included in world saves or sent to other players. Manual thrust, resets and changes of reference body mark an old plan for replanning.</p>
${deeper('precision and limits', `<p>The preview applies the entire Δv instantly at the node, then uses the same isolated trajectory predictor as the coast line. Real engine burns take time, so long burns differ from the preview. Prograde follows velocity and radial follows position; those directions are not perpendicular on an eccentric orbit. Burn duration uses the magnitude of their combined vector and the engine's maximum acceleration.</p>
<p>The preview uses the current body's gravity and stops at contact or its prediction limit. It does not forecast subsequent sphere-of-influence encounters. Custom worlds requiring numerical or whole-world prediction cannot use this analytic planner.</p>`)}`,
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
  <li><b>Yellow-green circle with a dot</b>: prograde, the way you are moving. The same circle with an <b>X</b> is retrograde.</li>
  <li><b>Blue circles</b> at the top and bottom: radial out (straight up) and radial in (straight down).</li>
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
<p>Switch it off in <b>Instruments → Navball</b>.</p>
${deeper('frames, pitch and settings', `
<p><b>ORB and SRF.</b> The readout shows which velocity the dial uses. <b>ORB</b> (orbit) is your speed around
the planet's centre. <b>SRF</b> (surface) is your speed over the ground, which turns with the planet. Primus spins
once every 600 s, so its equator moves about 5.4 m/s. A ship resting on the pad has 0 m/s SRF but 5.4 m/s ORB.
In auto mode, the dial uses SRF on the ground and below about 12% of the planet's radius, and switches to ORB
above about 18%. The gap between the two stops it from flickering back and forth.</p>
<p><b>HRZ and CAM.</b> In <b>HRZ</b> (horizon) mode, the sky always stays at the top of the dial, so you have a steady
reference during a gravity turn. In <b>CAM</b> (camera) mode, the dial turns with your camera, so directions on
the dial match directions on screen.</p>
<p><b>Pitch</b> is measured from the horizon ahead of you (the direction you are travelling around the planet):
+90° is straight up, 0° is level going forward, −90° is straight down, and ±180° is level going backward.</p>
<p>Frame (auto, ORB or SRF) and orientation (HRZ or CAM) are settings of the <code>builtin.navball</code> module. Auto and HRZ are the defaults.</p>`)}`,
  },
  {
    id: 'warp',
    title: 'Time warp',
    summary: 'Speed up time while you coast',
    html: `
<p>{{key:warpUp}} speeds up time and {{key:warpDown}} slows it down. {{key:warpReset}} returns to normal speed.
Time can run up to 100,000 times faster.</p>
<ul>
  <li>Fast warp only works while every ship is coasting: engines off, no steering, nothing touching the ground or water.</li>
  <li>While an engine fires, time runs at normal speed. Close to the ground, while steering, or while floating, warp stops at 4×.</li>
  <li>If warp won't go higher, a message says why, for example "Low altitude" or "Engine thrust active".</li>
</ul>
${deeper('why warp is limited', `
<p>A coasting ship follows an exact ellipse or hyperbola. The game can jump straight to any future time with
Kepler's equation, so 100,000× costs no more than 1×. This is called being <b>on rails</b>.</p>
<p>Thrust, terrain, water and steering can't be solved that way. For those the game steps the physics forward in
small fixed steps (100 per second). Warping a stepped ship would take thousands of steps per frame, so warp is
capped until the ship is coasting again.</p>`)}`,
  },
  {
    id: 'landing',
    title: 'Landing, terrain and oceans',
    summary: 'Touch down at 5 m/s or less',
    html: `
<ul>
  <li>Land <b>upright</b> at <b>5 m/s or less</b> on fairly flat ground. Any faster and the ship breaks.</li>
  <li>To come down from orbit, burn retrograde until the Pe marker sits below the ground. Near the surface,
    point the engine against your motion and burn to slow down.</li>
  <li>Some worlds have mountains and craters, and the trajectory line follows them. Practise in <b>Setup → Dry terrain flights</b>.</li>
  <li>Water holds your ship up. Hitting it faster than 5 m/s is a crash. You can also dive and come back up. Practise in <b>Setup → Ocean flights</b>.</li>
</ul>
${deeper('timing the landing burn', `
<p>With engine acceleration A and local gravity g, your ship can slow down at A − g while pointing straight up.
Falling at speed v, you need a distance of about <code>d = v² / (2(A − g))</code> to stop.</p>
<p>On Primus at full throttle, A − g = 125 − 50 = 75 m/s². Falling at 50 m/s, you need about 17 m. At 100 m/s,
you need about 67 m. Start the burn a little higher than that and ease off near the ground.</p>`)}`,
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
<p>You can make your own planets with <b>Tools → Planet designer</b>, or in the <b>Orbit Sandbox</b> game in the
Library. To load a universe someone sent you, use <b>Setup → Import…</b>.</p>
${deeper('why the Primus System is so small', `
<p>Real planets are huge, so a real orbit takes 90 minutes and a trip to the Moon takes days. The Primus planets
are a few hundred metres across but very dense, so gravity at the surface is still strong. Orbits take seconds,
and you can try a manoeuvre, see the result and try again quickly. The physics is the same as at full size.
Only the scale changes.</p>`)}`,
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
  <li><b>Save world</b> downloads the whole world, with its clock and every ship, as a file. <b>Load world…</b> picks up where you left off.</li>
  <li>{{key:reset}} (<b>Reset flight</b>) returns only the ship you are flying to the chosen scenario, preserving the world clock and the other ships. <b>Setup → Reset world</b> restarts the whole world and rewinds the clock; only the host can do this.</li>
</ul>`,
  },
  {
    id: 'multiplayer',
    title: 'Flying together',
    summary: 'Host friends or join a server',
    html: `
<p>Open <b>Online</b>. Everyone shares one sky and one clock, and each pilot has their own ships.</p>
<dl>
  <dt>This browser</dt><dd>Open the game in a second browser tab and choose <b>Join</b>. This is the quickest way to try it out.</dd>
  <dt>Server link</dt><dd>The easiest way to play on different devices. Open the host's game link and join automatically.
    If the world has a password, enter it and choose <b>Join</b>. Once connected, <b>Copy game link</b> invites more friends.
    Your password is never included in the link. A link to <code>localhost</code> only works on the same computer.</dd>
  <dt>Invite code</dt><dd>
    <ol>
      <li>The host chooses <b>Host this world</b>, then <b>Create invite</b>, and sends <b>Copy invite link</b> to a friend.</li>
      <li>The friend opens the link; their reply code is prepared automatically. They choose <b>Copy reply</b> and send it back.</li>
      <li>The host pastes the reply and connects automatically. <b>Connect player</b> also works if the code was typed or filled another way.</li>
    </ol>
    Make one invite per player. <b>Across the internet</b> is on by default; turn it off for local play without public address discovery.
    Offline HTML files use <b>Copy invite</b> instead of a web link; paste the code in your own copy of the game to prepare a reply.
    Reply codes last 10 minutes. Keep the host page open. If a direct link fails, use a server link.
    <b>Save connection report</b> downloads candidate counts and error codes without addresses or invite secrets.</dd>
  <dt>Server</dt><dd>Type a server address (like <code>192.168.1.20:6464</code>) and choose <b>Join</b>, or use
    <b>Scan local network</b>. A dedicated server keeps the world running and saves it on its own.</dd>
</dl>
<p class="manual-note">When a browser tab hosts, the world runs in that tab. Keep it visible, because browsers slow down hidden tabs.</p>
<p><b>Other pilots’ orbits.</b> Faint amber lines preview their current coast, refreshed about once per second.
They assume no future engine burn. Under <b>Online → Other pilots’ orbits</b>, <b>Auto</b> shows them with up to
eight other connected pilots and hides them in larger groups. Choose <b>Always</b> to keep previews on, or <b>Off</b> to hide them.
Up to 16 flying vessels are previewed, giving each pilot one before filling spare slots with their other ships.
Your own prediction keeps its normal refresh rate. Surface contact, a changed reference body or leaving the session clears outdated previews.</p>
${deeper('running a dedicated server', `
<p>Download the server program from the project's releases page and start it. It prints the address players
should use, including a link that joins automatically. It also serves the game page itself, so guests need only a browser.
From a source checkout with Node and dependencies installed, run <code>npm run host</code> to build the game, start the server and open it.
Send friends on your Wi-Fi the LAN link printed by the server, not its localhost link.</p>
<ul>
  <li>The world runs at 100 physics steps per second and sends players 20 updates per second.</li>
  <li>It saves to <code>space-sim-data/world.json</code> every minute, when the last player leaves and on shutdown, and keeps timestamped backups.</li>
  <li>Settings live in <code>server.json</code>: name, password, player and ship limits, whether cheats are allowed, and which universe new worlds use.</li>
  <li>It uses TCP port 6464. For players outside your home network, forward that port on your router.</li>
</ul>
<p><b>How sync works.</b> The simulation is deterministic: the same inputs always give the same result on
every computer. Each world has a fingerprint of its physics, modules and settings, and a player whose setup
doesn't match can't join. Invite codes use WebRTC, a direct browser-to-browser link. <b>Across the internet</b>
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
    summary: 'Renderer, graphics quality, themes, profiler',
    html: `
<ul>
  <li><b>Settings → Renderer</b> switches between WebGL and 2D. 2D works on every device.</li>
  <li><b>Graphics: High / Low</b>. Low turns off lighting and planet surface detail, which helps older devices.</li>
  <li><b>Theme…</b> changes the colours of windows, the HUD, the grid and the starfield.</li>
  <li>{{key:fullscreen}} toggles fullscreen. If the game feels slow, {{key:profiler}} opens the profiler, which shows where each frame's time goes.</li>
</ul>`,
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
  <li><b>Throw</b> ({{key:throwShip}}, or Alt + drag): drag out a velocity for your ship and let go.</li>
</ul>
<p>Commands that move your ship count as cheats. Turn them on with <code>/throw on</code> or in
<b>Settings → Gameplay</b>. Servers can turn them off.</p>`,
  },
];

const CREATORS: readonly ManualPage[] = [
  {
    id: 'overview',
    title: 'Making things with Spacelab',
    summary: 'What you can build, and where to start',
    html: `
<p>Spacelab is the engine, and <b>Space Sim</b> is the game that comes with it. Almost every part, from the
instruments and cameras to the renderers, the physics model and the planets, is a <b>module</b>. You can remove
a module, replace it with your own, or mix modules into a new game. All games share the same 2D orbital physics.</p>
<p>From easiest to most involved, you can make:</p>
<ol>
  <li><a data-page="universes">Universes and planets</a>: data files, no code.</li>
  <li><a data-page="shaders">Shader packs</a>: GLSL that changes how the scene looks.</li>
  <li><a data-page="games">Games and remixes</a>: a chosen set of modules, content and settings in one file.</li>
  <li><a data-page="modules">Code modules</a>: TypeScript that adds forces, rules, commands, instruments or cameras.</li>
</ol>
<p>The <b>Library</b> window manages all of these. Nothing leaves your computer unless you share the file.</p>
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
    id: 'universes',
    title: 'Universes and planets',
    summary: 'Star systems as JSON: bodies, orbits, starting points',
    html: `
<p>A <b>universe</b> holds one or more star systems. The game runs one system at a time.</p>
<ul>
  <li><b>Easiest:</b> use <b>Tools → Planet designer</b>, or open the <b>Orbit Sandbox</b> game from the Library,
    fling planets into orbit, then choose <b>Export to Space Sim</b>.</li>
  <li><b>Full control:</b> <b>Setup → Export</b> saves the current universe as a file. Edit it, then load it with
    <b>Setup → Import…</b>. Both <code>.spaceuniverse</code> and <code>.json</code> work.</li>
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
  <li>Open <b>Tools → Shaders</b> and choose <b>Export shaders</b>. This saves a JSON pack with all the current shaders.</li>
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
Space Sim and Orbit Sandbox are both games.</p>
<ol>
  <li>Choose simulation plugins in <b>Library → Plugins · simulation, data &amp; settings</b> and display modules in <b>Instruments &amp; display</b>.</li>
  <li>Under <b>Make a game from this world’s setup</b>, give it a name.</li>
  <li>Choose <b>Save as game</b> to keep it in this browser, or <b>Export .spacegame</b> to get a file you can share.</li>
</ol>
<p>Others load it with <b>Import game, plugin or universe…</b> and start it with <b>Play · new world</b>.</p>
${deeper('games, saves and code', `
<p>A game stores setup. A world save (from <b>Fleet</b>) stores progress: the clock, ships and pilots. To continue
a save made with a custom game, start that game first, then load the save.</p>
<p>Importing a game never runs its code. Code runs only when you choose to play it, and a failed start leaves
your current world running. Exported <code>.spacegame</code> files are compressed and include the exact code,
data and settings, so the game plays the same on any computer.</p>`)}`,
  },
  {
    id: 'modules',
    title: 'Code modules',
    summary: 'Forces, rules, commands, instruments, cameras',
    html: `
<p>Modules are written in TypeScript against the public API in <code>packages/game-api</code>. There are three kinds:</p>
<dl>
  <dt>Data</dt><dd>Only JSON, for example vehicle settings. Try <code>examples/modules/gentle-flight.json</code> with
    <b>Library → Data &amp; legacy profiles → Load module/profile…</b>.</dd>
  <dt>Simulation</dt><dd>Changes what happens: extra forces, a different physics integrator, world rules, or new
    pilot commands. These run on the host or server and are part of saves and multiplayer.</dd>
  <dt>Presentation</dt><dd>Changes only what you see: overlays, panels and camera modes. You can switch these on
    and off at any time. The built-in instruments, including the navball, are presentation modules.</dd>
</dl>
<h3>Build one</h3>
<ol>
  <li>Copy a starter from <code>examples/modules/</code>: <code>force</code>, <code>numerical</code>, <code>telemetry</code> or <code>state</code>.</li>
  <li>Change <code>id</code> and <code>name</code> in its manifest, then edit <code>main.ts</code>.</li>
  <li>Run <code>npm run module:build -- my-module/module.json my-module.module.json</code>. This checks types, bundles the code and validates the result.</li>
  <li>In the Library, choose <b>Install code artifact…</b>, select the module and apply.</li>
</ol>
<p class="manual-warn">A code module can do anything the page or server can. Only install code from people you trust.</p>
${deeper('the API surface', `
<p>A module exports one synchronous <code>initialize(context)</code> function. From the context it can:</p>
<ul>
  <li><b>Simulation:</b> <code>contributeForce</code> (add an acceleration), replace the motion model, add world
    rules that run every step, and add pilot commands that the host carries out.</li>
  <li><b>Presentation:</b> <code>contributeLayer</code> (up to 256 shapes per frame, drawn in world or screen
    space), <code>contributePanel</code> (up to 16 label and value rows, updated up to 4 times a second) and camera hooks.</li>
  <li><b>Settings:</b> declare numbers in the manifest with a default, minimum and maximum. Players can edit them in the Library.</li>
  <li><b>Dependencies:</b> list other modules with version ranges such as <code>^0.1.0</code>, and use their APIs.</li>
</ul>
<p>Presentation hooks receive a frozen snapshot of the frame: ship state, orbit elements, ground clearance,
prediction and camera. If a hook throws an error, only that contribution is switched off and the world keeps running.</p>
<p>The build only accepts imports from <code>@space-sim/game-api</code> and files inside your module's folder.
<code>examples/modules/README.md</code> lists every example and how to try it.</p>`)}`,
  },
  {
    id: 'determinism',
    title: 'Rules for simulation modules',
    summary: 'Keep worlds identical on every computer',
    html: `
<p>Determinism means that the same starting state and inputs produce exactly the same result.
In multiplayer, every computer runs the same simulation and must get exactly the same result. Simulation
modules have to follow a few rules for that to work:</p>
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
  <li>To share your work, send the exported file: <code>.spaceuniverse</code>, <code>.spacegame</code>,
    <code>.spaceplugin</code>, a shader <code>.json</code> or a <code>.module.json</code>.</li>
  <li>Spacelab uses the MIT licence. Give your module a licence, and credit any code or data you include.</li>
  <li>World saves hold state and the names of the modules they need. They never contain code.</li>
</ul>`,
  },
];

export const MANUAL: Readonly<Record<ManualAudience, ManualSection>> = Object.freeze({
  players: { label: 'Players', intro: 'How to fly, orbit, land and play together. Open "Go deeper" sections for the maths.', pages: PLAYERS },
  creators: { label: 'Creators', intro: 'How to make universes, shaders, games and modules.', pages: CREATORS },
});
