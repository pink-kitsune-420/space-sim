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
    summary: 'What the game is and where everything lives',
    html: `
<p>Space Sim is a 2D spaceflight game with real orbital physics. Gravity pulls your ship toward planets, and your
engine changes its speed and direction. With enough sideways speed, your ship keeps falling around a planet
without ever reaching the ground. That path is called an <b>orbit</b>.</p>
<h3>The dock</h3>
<p>The column of buttons at the edge of the screen opens windows:</p>
<ul>
  <li><b>Setup</b>: pick the universe, the star system and where your ship starts. <b>Reset flight</b> is here too.</li>
  <li><b>Fleet</b>: your ships, plus <b>Save universe</b> and <b>Load universe…</b>.</li>
  <li><b>Online</b>: host friends or join a server.</li>
  <li><b>Instruments</b>, <b>Trajectory</b> and <b>Telemetry</b>: choose what the flight view shows.</li>
  <li><b>Settings</b>, <b>Tools</b>, <b>Manual</b> and <b>ModMenu</b>: display options, creator tools, this manual, and other games and plugins.</li>
</ul>
<p>Click a dock button again or press <kbd>Esc</kbd> to close its window. The <b>pin</b> button keeps a window open
while you fly. Press {{key:pause}} to pause.</p>
<p>Drag a window's edge or corner to resize it. The <b>□</b> button maximizes it; press it again to restore
the previous size and position. Focus a resize grip and use the arrow keys for small adjustments.</p>
<p>Open <b>Settings → Edit HUD layout</b> to move the dock, flight controls, clock, status, readings and hints.
Drag a small grip, or focus it and use the arrow keys. Navballs can be dragged directly while editing, even when pinned. Hold Shift for larger steps. Choose <b>Done</b> when finished.
Your positions stay saved on this device and fit back inside the screen when it resizes. Touch joystick and action controls have move handles too.
Windows and chat move by their title bars. Outside the editor, unlock a navball with its pin button before dragging it. <b>Reset HUD layout</b> restores their default positions and window sizes.</p>
<p>Fly with the interactive navball and throttle lever. The dock has no separate Ship controls window. Activation throttle and fallback flight controls are in <b>Settings</b>; plugin command buttons are in <b>Instruments</b>. <b>Shift+← / Shift+→</b> rotate the camera by 15° without steering; <b>R</b> resets flight. Shift-click the rotation buttons for 1° steps. Follow, recenter, camera mode changes and new focus targets restore the mode’s normal orientation; manual rotation does not replace your chosen horizon setting.</p>
<p><b>Settings → HUD visibility</b> lets you hide status, flight controls, clock, readings, hints, notices, chat, navballs, touch controls, ship labels, planet labels, planet orbit lines and the scale bar. Planet orbits can be hidden independently of ship trajectories. The dock stays visible so you can reopen Settings. Choices are saved on this device. <b>Restore HUD visibility</b> brings the defaults back. You can also reopen hidden chat from its dock button or with Enter.</p>
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
<p>The table shows player 1's current keyboard and controller mappings. Lesson hints use these mappings too.
Choose <b>Configure controls…</b> above to change them. This opens the same dialog as
<b>Settings → Controls &amp; keybindings…</b>. Controller axes show their configured index and direction;
button names match the connected controller, with Xbox names used when it is disconnected.
A dash means the action has no binding for that input or the device is disabled or assigned elsewhere.</p>
<div data-manual-controls></div>
<h3>Touch and mouse</h3>
<ul>
  <li>Drag the lever beside your navball to set persistent thrust; release to keep burning, or drag to 0% to coast. The lever shows active power. Each local pilot has their own lever; its mechanical track and grip work with mouse and touch.</li>
  <li>{{key:throttleUp}} / {{key:throttleDown}} adjust active thrust: tap for 1%, or hold to ramp smoothly, starting at 20 percentage points per second and gently increasing to 30 over one second. Hold {{key:throttleFine}} for a slower ramp (4 to 6 percentage points per second) and 0.2% taps. Releasing, reversing direction or changing fine mode resets the ramp speed. Starting from idle ramps up from 0%, and releasing keeps the burn. {{key:throttleRemember}} remembers the current active thrust for your assigned player without changing the burn. {{key:throttleCut}} cuts to 0%; {{key:throttleRecall}} starts a persistent burn at your remembered activation level. In <b>Settings</b>, moving the throttle slider also remembers that level; choose a player and edit <b>Activation throttle (%)</b> directly or choose <b>Reset activation level</b> to restore the world's default (normally 50%). The lever and ramp can still reach 100%. Switch the lever independently with <b>Instruments → Throttle</b>. Use <b>Settings → Edit HUD layout</b> and its grip to move it without moving the navball; each local player has a separate lever position.</li>
  <li>Hold <b>BURN</b> or {{key:engine}} for a temporary burn; releasing stops it. This overrides a persistent burn. Held engine/throttle controls lock and cancel dragging (LOCK). Cut overrides held controls until you release them. Pausing, losing focus or opening a window clears persistent thrust. Hold the turn buttons to rotate.</li>
  <li>Drag the view to move the camera. Pinch or use the mouse wheel to zoom. Flick the view to send the camera gliding.</li>
</ul>
<h3>Gamepad</h3>
<p>Plug in a controller and press any button. Steam Deck, Xbox, PlayStation and most joysticks work. By default, left stick vertical or D-pad up/down ramps thrust; LT/L2 gives fine adjustment, R3 cuts, and A/Cross recalls the activation level. RT/R2 remains a held burn. Throw has no default controller button; bind it in Controllers if wanted. Saved default layouts migrate to free D-pad up for throttle.</p>
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
  <li><b>Climb.</b> Hold {{key:throttleUp}} until the throttle is full; thrust starts immediately and continues when released. Go straight up for a moment.</li>
  <li><b>Tip over slowly.</b> Turn toward the horizon a little at a time with {{key:turnLeft}} or {{key:turnRight}}.
    Sideways speed is what keeps you up, so you want more of it as you climb.</li>
  <li><b>Watch the line.</b> The trajectory line shows where you will go if you stop the engine. If it hits the
    ground, keep burning sideways.</li>
  <li><b>Stop at the right height.</b> The <b>Ap</b> marker is the highest point of your path. When it is well
    above the ground, press {{key:throttleCut}} to coast.</li>
  <li><b>Finish at the top.</b> Coast up to Ap. Point the ship the way you are moving (along the velocity arrow)
    and press {{key:throttleRecall}} to burn again. The low side of the path lifts. Cut with {{key:throttleCut}} when the <b>Pe</b> marker, the lowest point, is safely
    above the ground.</li>
</ol>
<p>You are now in orbit. Press {{key:warpUp}} to speed up time and watch the ship circle the planet with the engine off.</p>
<p class="manual-note">To try again, press {{key:reset}}. To start in orbit instead, pick <b>Circular orbit · 128 m altitude</b> in Setup.</p>
${deeper('the numbers behind this launch', `
<p>Primus has a radius of 512 m and a gravitational parameter μ of 13,107,200 m³/s². Surface gravity is
μ/R² = <b>50 m/s²</b>, about five times Earth's. Your engine gives up to 125 m/s², so at full throttle the
<b>thrust-to-weight ratio</b> is 2.5. At the default half throttle it is 1.25, barely enough to lift off.</p>
<p>A circular orbit 128 m up (r = 640 m from the centre) needs a speed of √(μ/r) ≈ <b>143 m/s</b> and takes
2πr/v ≈ <b>28 s</b> per lap when moving along the local horizon. A slower sideways speed lowers the opposite side
of the orbit; check whether Pe clears the terrain to know if you will hit the ground. The two-body escape speed
there is √(2μ/r) ≈ <b>202 m/s</b>.</p>
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
    {{key:orientation}} switches between north-up and horizon-up. The camera's ↶ / ↷ buttons rotate the view by 15° (Shift: 1°); <b>N↑</b> resets to north up. This changes the view, leaving ship attitude alone. Zoom with {{key:zoomIn}} {{key:zoomOut}}.</li>
</ul>
<p>You can switch off any instrument in <b>ModMenu → Instruments &amp; display</b>.</p>
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
  <li>The dashed amber line previews the coast after that burn. Drag the node's ◇ along the coast, click another point on the original line, or edit <b>Node in (s)</b> to move it. Drag <b>P±</b> handles for prograde/retrograde and <b>R±</b> for radial out/in. Choose an <b>Adjustment</b> size for buttons and handles; Shift makes it ten times finer. Map drags apply that step per 4 pixels. Escape cancels a drag; <b>Clear Δv</b> keeps the node and removes its burn.</li>
  <li><b>Warp to node</b> coasts without firing the engine, including with zero Δv or no engine. It returns to normal speed 10 seconds plus half the estimated burn duration beforehand, when thrust is available. Only the host controls warp. Steering, thrust, pausing, hiding the tab or <b>Stop warp</b> cancels the approach.</li>
  <li>Turn toward the amber diamond on the navball and fire the engine yourself. Centre the estimated burn on the node time. The amber arrow at the node also shows the intended burn direction.</li>
</ol>
<p>For a fully autonomous maneuver, choose <b>Execute burn</b>. It warps toward the selected node, returns to normal speed, turns toward the burn direction, fires the engine around the node time, and cuts off after delivering the planned Δv. It adjusts the final tick's throttle for small burns and leaves throttle at zero when complete. Allow enough time before the node for alignment and half the burn duration. Autonomous execution is available in solo play and for the host's selected ship; remote pilots can still plan and fly manually.</p>
<p><b>Abort burn</b> immediately releases engine and steering control. Manual steering, engine or throttle input, changing warp, pausing, opening Controls, hiding the tab, switching ships, disabling the instrument or a changed trajectory also aborts. A partly executed burn needs a new plan. Execution stays at normal speed after cutoff.</p>
<p>Use <b>Delete node</b> to remove the plan. Close the editor and reopen it from the <b>Maneuver</b> dock button. Disable the tool in <b>Instruments → Maneuver planner</b>.</p>
<p>Each piloted ship has one local plan for this flight session. Plans are not included in universe saves or sent to other players. Manual thrust, resets and changes of reference body mark an old plan for replanning.</p>
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
ModMenu. To load a universe someone sent you, use <b>Setup → Import…</b>.</p>
${deeper('why the Primus System is so small', `
<p>Real planets are huge, so a real orbit takes 90 minutes and a trip to the Moon takes days. The Primus planets
are a few hundred metres across but very dense, so gravity at the surface is still strong. Orbits take seconds,
and you can try a manoeuvre, see the result and try again quickly. The physics is the same as at full size.
Only the scale changes.</p>`)}`,
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
  <li><b>Save universe</b> downloads progress as a <code>.spaceuniverse</code> file, with the clock, ships and pilots. <b>Load universe…</b> picks up where you left off.</li>
  <li>{{key:reset}} (<b>Reset flight</b>) returns only the ship you are flying to the chosen scenario, preserving the world clock and the other ships. <b>Setup → Reset world</b> restarts the whole world and rewinds the clock; only the host can do this.</li>
</ul>`,
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
  <li><b>Throw</b> ({{key:throwShip}}, then drag): drag out a velocity for your ship and let go.</li>
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
    id: 'universes',
    title: 'Universes and planets',
    summary: 'Star systems as JSON: bodies, orbits, starting points',
    html: `
<p>A <b>universe</b> holds one or more star systems. The game runs one system at a time.</p>
<ul>
  <li><b>Easiest:</b> use <b>Tools → Planet designer</b>, or open the <b>Orbit Sandbox</b> game from the ModMenu,
    fling planets into orbit, then choose <b>Export to Space Sim</b>.</li>
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
