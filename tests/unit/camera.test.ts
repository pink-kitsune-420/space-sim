import { expect, it } from 'vitest';
import { advance, initialState } from '../../packages/sim-core/src/index';
import { CanvasRenderer, WebGLRenderer, blendAngle, dragCamera, drawPlanetHorizon, hermiteControls, interpolateState, parallelArcs, pathFromShip, project } from '../../packages/render-2d/src/index';
import { CameraController, findSmartThrowTarget, type SmartCandidate } from '../../apps/web/src/camera';

it('projects a shared world transform with +Y up and camera-relative subtraction', () => {
  const center = { x: 1e12, y: -1e12 };
  const camera = { center, rotation: 0, scale: 2 };
  expect(project({ x: center.x + 2, y: center.y + 3 }, camera, 800, 600)).toEqual({ x: 404, y: 294 });
  const p = project({ x: 1, y: 0 }, { center: { x: 0, y: 0 }, rotation: Math.PI / 2, scale: 1 }, 800, 600);
  expect(p.x).toBeCloseTo(400); expect(p.y).toBeCloseTo(299);
});

it('pans in screen coordinates at every camera rotation and zoom', () => {
  for (const rotation of [0, .7, Math.PI / 2, -Math.PI]) for (const scale of [.2, 1, 4]) {
    const camera = { center: { x: 120, y: -50 }, rotation, scale };
    const point = { x: 200, y: 300 }, delta = { x: 80, y: -30 };
    const before = project(point, camera, 800, 600);
    const after = project(point, dragCamera(camera, delta), 800, 600);
    expect(after.x - before.x).toBeCloseTo(delta.x, 10);
    expect(after.y - before.y).toBeCloseTo(delta.y, 10);
  }
});

it('preserves a fixed viewer rotation through following, panning and zooming, then restores mode orientation', () => {
  const camera = new CameraController(), body = { x: 1e10, y: -1e10 }, ship = { x: 200, y: 600 };
  const frame = { body, ship, width: 800, height: 600, elapsed: .1, instant: true };
  camera.manualRotation = .7;
  expect(camera.update(frame).rotation).toBe(.7);
  const point = { x: body.x + 350, y: body.y + 700 };
  const before = project(point, camera.last, 800, 600);
  camera.drag({ x: 40, y: -20 }, body, ship, 800, 600);
  const after = project(point, camera.update(frame), 800, 600);
  expect(after.x - before.x).toBeCloseTo(40, 4); expect(after.y - before.y).toBeCloseTo(-20, 4);
  camera.changeZoom(2); expect(camera.update(frame).rotation).toBe(.7);
  camera.manualRotation = undefined; expect(camera.update(frame).rotation).toBe(0);
  camera.followShip(); expect(camera.update(frame).rotation).toBeCloseTo(Math.PI / 2 - Math.atan2(ship.y, ship.x));
});

it('releases manual rotation on Follow, recenter, mode changes and new smart focus while retaining the chosen follow orientation', () => {
  const camera = new CameraController(), body = { x: 0, y: 0 }, ship = { x: 200, y: 600 };
  const frame = { body, ship, width: 800, height: 600, elapsed: .1, instant: true };
  for (const restore of [() => camera.followShip(), () => camera.recenter(), () => camera.planetView(), () => camera.cycle([])]) {
    camera.manualRotation = .7; restore(); expect(camera.manualRotation).toBeUndefined();
  }
  camera.horizon = true; camera.manualRotation = .7; camera.followShip();
  expect(camera.update(frame).rotation).toBeCloseTo(Math.PI / 2 - Math.atan2(ship.y, ship.x));
  camera.horizon = false; camera.manualRotation = .7; camera.recenter();
  expect(camera.update(frame).rotation).toBe(0);
  camera.mode = 'free'; camera.manualRotation = .7;
  camera.focusTarget = { kind: 'body', id: 'moon', name: 'Moon' };
  expect(camera.manualRotation).toBeUndefined();
  camera.manualRotation = .7;
  camera.fling({ x: -800, y: 0 }, 800, 600, { kind: 'body', id: 'beacon', name: 'Beacon' });
  camera.update({ ...frame, focusPosition: { x: 300, y: 0 } });
  expect(camera.manualRotation).toBeUndefined();
  expect(camera.focusTarget?.id).toBe('beacon');
});

it('blends the shortest angular path through wraparound and allows retargeting', () => {
  const degrees = Math.PI / 180;
  expect(Math.abs(blendAngle(179 * degrees, -179 * degrees, .5))).toBeCloseTo(Math.PI);
  expect(blendAngle(0, Math.PI / 2, .5)).toBeCloseTo(Math.PI / 4);
  expect(blendAngle(Math.PI / 4, 0, 1)).toBe(0);
});

it('builds Hermite Bézier controls that reproduce cubic motion exactly', () => {
  // x(t)=t^3-t, y(t)=2t^2 sampled with exact positions/velocities at t=1 and t=3.
  const at = (t: number) => ({ time: t, position: { x: t ** 3 - t, y: 2 * t * t }, velocity: { x: 3 * t * t - 1, y: 4 * t } });
  const [c1, c2] = hermiteControls(at(1), at(3));
  const bezier = (u: number, a: number, b: number, c: number, d: number): number =>
    (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
  for (const u of [0, .25, .5, .9, 1]) {
    const exact = at(1 + 2 * u).position;
    expect(bezier(u, 0, c1.x, c2.x, 24)).toBeCloseTo(exact.x, 10);
    expect(bezier(u, 2, c1.y, c2.y, 18)).toBeCloseTo(exact.y, 10);
  }
});

it('starts open paths at the ship with world-fixed dash length, and keeps closed loops whole', () => {
  const sample = (time: number, x: number) => ({ time, position: { x, y: 0 }, velocity: { x: 1, y: 0 } });
  const path = [sample(0, 0), sample(1, 10), sample(2, 30), sample(3, 60)];
  const ship = sample(1.5, 18);
  const open = pathFromShip(path, false, ship);
  expect(open.points).toEqual([ship, path[2], path[3]]);
  expect(open.flown).toBeCloseTo(18, 12); // 10 m of passed chords + 8 m into the next one
  expect(pathFromShip(path, false, sample(-1, -5)).points[0]).toEqual(sample(-1, -5));
  expect(pathFromShip(path, false, sample(4, 70)).points).toEqual([]);
  expect(pathFromShip(path, true, ship)).toEqual({ points: path, flown: 0 });
});

it('interpolates presentation states between fixed steps without touching physics fields', () => {
  const a = { ...initialState('planet-orbit'), heading: Math.PI - .1 };
  const b = { ...advance(a), heading: -Math.PI + .1, throttle: .9 };
  const mid = interpolateState(a, b, .5);
  expect(mid.time).toBeCloseTo((a.time + b.time) / 2, 12);
  expect(mid.position.x).toBeCloseTo((a.position.x + b.position.x) / 2, 12);
  expect(Math.abs(mid.heading)).toBeCloseTo(Math.PI, 12); // shortest way through the wrap
  expect(mid.throttle).toBe(.9);
  expect(mid.coast).toBe(b.coast);
  expect(interpolateState(a, b, 1)).toBe(b);
  expect(interpolateState(a, b, 0).position).toEqual(a.position);
  expect(interpolateState(b, b, .3)).toBe(b);
});

it('cuts latitude lines analytically to the planet disc instead of clipping', () => {
  const k = .13;
  const point = (offset: number, angle: number) => ({ x: Math.cos(angle), y: offset + k * Math.sin(angle) });
  for (const offset of [-2 / 3, -1 / 3, 1 / 3, 2 / 3]) {
    const arcs = parallelArcs(offset);
    expect(arcs).toHaveLength(2);
    for (const [start, end] of arcs) {
      for (const edge of [start, end]) expect(Math.hypot(point(offset, edge).x, point(offset, edge).y)).toBeCloseTo(1, 12);
      for (let f = .02; f < 1; f += .07) {
        const p = point(offset, start + (end - start) * f);
        expect(Math.hypot(p.x, p.y)).toBeLessThan(1);
      }
      for (const outside of [start - .01, end + .01]) {
        const p = point(offset, outside);
        expect(Math.hypot(p.x, p.y)).toBeGreaterThan(1);
      }
    }
  }
  expect(parallelArcs(0)).toEqual([[0, 2 * Math.PI]]);
});

it('draws a clipped horizon polygon without canvas arc overflow when planet radius is huge', () => {
  const operations: string[] = [];
  const fakeCtx = {
    save: () => operations.push('save'),
    restore: () => operations.push('restore'),
    beginPath: () => operations.push('beginPath'),
    closePath: () => operations.push('closePath'),
    moveTo: (x: number, y: number) => operations.push(`moveTo(${Math.round(x)},${Math.round(y)})`),
    lineTo: (x: number, y: number) => operations.push(`lineTo(${Math.round(x)},${Math.round(y)})`),
    fill: () => operations.push('fill'),
    stroke: () => operations.push('stroke'),
    fillRect: (x: number, y: number, w: number, h: number) => operations.push(`fillRect(${x},${y},${w},${h})`),
    createLinearGradient: () => ({
      addColorStop: () => {},
    }),
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  // 1. Horizon passes through center of 800x600 screen with 4.5 million pixel radius
  drawPlanetHorizon(fakeCtx, 800, 600, 400, 300 + 4500000, 4500000);
  expect(operations).toContain('fill');
  expect(operations).toContain('stroke');
  expect(operations.some(op => op.startsWith('moveTo(400,300)'))).toBe(false); // starts at -sMax

  // 2. Offscreen planet is culled
  operations.length = 0;
  drawPlanetHorizon(fakeCtx, 800, 600, 400, 300 + 10000000, 4500000);
  expect(operations).toHaveLength(0);

  // 3. Viewport entirely underground fills screen
  operations.length = 0;
  drawPlanetHorizon(fakeCtx, 800, 600, 400, 300, 4500000);
  expect(operations).toContain('fillRect(0,0,800,600)');
});

it('traces curved atmosphere ribbon backwards without cutting flat chords across the sky', () => {
  const lineTos: { x: number; y: number }[] = [];
  const fakeCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: (x: number, y: number) => lineTos.push({ x, y }),
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  // Viewport 907x480, planet radius 1826 (exact values from diagnostic log)
  drawPlanetHorizon(fakeCtx, 907, 480, 453.5, 240 + 1826, 1826);
  // Total lineTo calls should include forward surface arc (48), backward atmosphere arc (49),
  // plus ground polygon (48 + 2 corners), plus horizon stroke (48)
  expect(lineTos.length).toBeGreaterThan(100);

  // All screen coordinates generated must stay near the visible viewport (bounded within [-500, 1500])
  for (const pt of lineTos) {
    expect(pt.x).toBeGreaterThan(-500);
    expect(pt.x).toBeLessThan(1500);
    expect(pt.y).toBeGreaterThan(-500);
    expect(pt.y).toBeLessThan(2500);
  }
});

it('applies custom horizonColor and skyColor when drawing horizon', () => {
  let appliedStroke = '';
  const addedStops: { offset: number; color: string }[] = [];
  const fakeCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
    stroke: () => { appliedStroke = String(fakeCtx.strokeStyle); },
    fillRect: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({
      addColorStop: (offset: number, color: string) => addedStops.push({ offset, color }),
    }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  drawPlanetHorizon(
    fakeCtx,
    800,
    600,
    400,
    300 + 4500000,
    4500000,
    '#233c47',
    '#659497',
    '#29495380',
    false,
    '#00ffcc',
    '#ff00ff80',
  );

  expect(appliedStroke).toBe('#00ffcc');
  expect(addedStops.some(s => s.offset === 0 && s.color === '#ff00ff80')).toBe(true);
});

it('renders consistent body and vessel labels with the scale bar at bottom right across CanvasRenderer and WebGLRenderer', () => {
  const c2dLabels: Array<{ text: string; x: number; y: number; align: string; color: string }> = [];
  const fake2dCtx = {
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    bezierCurveTo: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillText: (text: string, x: number, y: number) => {
      c2dLabels.push({
        text,
        x: Math.round(x),
        y: Math.round(y),
        align: String(fake2dCtx.textAlign),
        color: String(fake2dCtx.fillStyle),
      });
    },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'start',
    lineWidth: 1,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;

  const glLabels: string[] = [];
  let uploadedVertices: Float32Array = new Float32Array();
  let drawingStyle = 0;
  const vesselTips: number[][] = [];
  const scaleBars: number[][] = [];
  const fakeLabelCtx = {
    setTransform: () => {},
    clearRect: () => {},
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillText: (text: string) => { glLabels.push(text); },
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;

  const fakeGl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ACTIVE_UNIFORMS: 35718,
    ACTIVE_ATTRIBUTES: 35721,
    ACTIVE_UNIFORM_BLOCKS: 35382,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    TRIANGLES: 4,
    TRIANGLE_FAN: 6,
    LINES: 1,
    LINE_LOOP: 2,
    LINE_STRIP: 3,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    detachShader: () => {},
    deleteShader: () => {},
    deleteProgram: () => {},
    bindAttribLocation: () => {},
    linkProgram: () => {},
    getProgramParameter: (_program: unknown, parameter: number) => parameter === 35714 ? true : 0,
    getFragDataLocation: () => 0,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: (_target: number, _offset: number, data: Float32Array) => { uploadedVertices = data; },
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    viewport: () => {},
    useProgram: () => {},
    uniform1i: (_location: unknown, value: number) => { drawingStyle = value; },
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    drawArrays: (mode: number) => {
      if (mode === 6 && drawingStyle === 5) vesselTips.push([uploadedVertices[0]!, uploadedVertices[1]!]);
      if (mode === 1 && drawingStyle === 8) scaleBars.push(Array.from(uploadedVertices.slice(0, 4)));
    },
    enable: () => {},
    disable: () => {},
    blendFunc: () => {},
    activeTexture: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    texImage2D: () => {},
    texImage3D: () => {},
    pixelStorei: () => {},
    getExtension: () => null,
    getContextAttributes: () => ({ stencil: true }),
    texParameteri: () => {},
  } as unknown as WebGL2RenderingContext;

  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  try {
    const c2dCanvas = {
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600,
      getContext: () => fake2dCtx,
    } as unknown as HTMLCanvasElement;

    const glCanvas = {
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600,
      ownerDocument: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => fakeLabelCtx,
        }),
      },
      getContext: () => fakeGl,
    } as unknown as HTMLCanvasElement;

    const state = initialState('planet-orbit');
    const frame = {
      state,
      path: [],
      pathClosed: false,
      camera: { center: { x: 0, y: 0 }, rotation: 0, scale: 0.4 },
      engine: false,
    };

    new CanvasRenderer(c2dCanvas).draw(frame);
    const gpuRenderer = new WebGLRenderer(glCanvas);
    gpuRenderer.draw(frame);

    expect(c2dLabels.map(l => l.text)).toEqual(['PRIMUS', 'VESSEL 01', '100 m']);
    expect(glLabels).toEqual(['PRIMUS', 'VESSEL 01', '100 m']);
    expect(scaleBars).toEqual([[736, 573, 776, 573]]);

    // A long path grows the shared GPU staging buffer. The later vessel draw must
    // write into that new buffer, rather than uploading leftover path coordinates.
    const path = Array.from({ length: 400 }, (_, i) => ({
      time: i, position: { x: i, y: 640 }, velocity: { x: 1, y: 0 },
    }));
    gpuRenderer.draw({ ...frame, path, pathClosed: true });
    expect(vesselTips).toEqual([[411, 44], [411, 44]]);

    // Verify scale bar label stays at bottom right, right-aligned with #95a9b5 even when the ship is offscreen
    c2dLabels.length = 0;
    new CanvasRenderer(c2dCanvas).draw({
      ...frame,
      shipWorldPosition: { x: 100000, y: 100000 },
    });
    const scaleLabel = c2dLabels.find(l => l.text === '100 m');
    expect(scaleLabel).toMatchObject({ x: 776, y: 564, align: 'right' });
    expect(scaleLabel?.color).toBe('#95a9b5');
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

it('throws camera into inertial free pan, coasts over time, and slows down with friction', () => {
  const camera = new CameraController();
  // Drag into free mode
  camera.drag({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 }, 800, 600);
  expect(camera.mode).toBe('free');

  // Fling with screen velocity of 300 px/sec to the right
  camera.fling({ x: 300, y: 0 }, 800, 600);
  expect(Math.hypot(camera.panVelocity.x, camera.panVelocity.y)).toBeGreaterThan(0);

  const initialPanX = camera.pan.x;
  // Advance 0.1s
  camera.update({
    body: { x: 0, y: 0 },
    ship: { x: 100, y: 100 },
    elapsed: 0.1,
    instant: false,
    width: 800,
    height: 600,
  });

  // Pan advanced in direction of throw
  expect(camera.pan.x).not.toBe(initialPanX);
  const velAfter01 = Math.hypot(camera.panVelocity.x, camera.panVelocity.y);

  // Advance another 0.5s
  camera.update({
    body: { x: 0, y: 0 },
    ship: { x: 100, y: 100 },
    elapsed: 0.5,
    instant: false,
    width: 800,
    height: 600,
  });
  const velAfter06 = Math.hypot(camera.panVelocity.x, camera.panVelocity.y);
  // Velocity decelerates due to friction
  expect(velAfter06).toBeLessThan(velAfter01);

  // Calling stopFling halts drift immediately
  camera.stopFling();
  expect(camera.panVelocity).toEqual({ x: 0, y: 0 });
});

it('findSmartThrowTarget prioritizes ships over bodies and selects the closest candidate', () => {
  const bodies: SmartCandidate[] = [
    { kind: 'body', id: 'moon', name: 'Moon', position: { x: 500, y: 0 } },
    { kind: 'body', id: 'mars', name: 'Mars', position: { x: 1200, y: 0 } },
  ];
  const ships: SmartCandidate[] = [
    { kind: 'ship', id: 'probe', name: 'Probe', position: { x: 700, y: 0 } },
    { kind: 'ship', id: 'lander', name: 'Lander', position: { x: 900, y: 0 } },
  ];

  // Swiping left (screen -X) throws the camera to the right (+X world)
  // Scale is 1 px/m, center at {0, 0}
  // Even though Moon is closer (500m vs 700m), probe is a ship, so probe MUST take priority!
  const target = findSmartThrowTarget({
    currentCenter: { x: 0, y: 0 },
    screenVelocity: { x: -800, y: 0 },
    cameraRotation: 0,
    scale: 1,
    bodies,
    ships,
  });
  expect(target).toEqual({
    kind: 'ship',
    id: 'probe',
    name: 'Probe',
    isPilotedShip: undefined,
  });
});

it('findSmartThrowTarget selects closest body when no ships are in throw path', () => {
  const bodies: SmartCandidate[] = [
    { kind: 'body', id: 'moon', name: 'Moon', position: { x: 400, y: 0 } },
    { kind: 'body', id: 'mars', name: 'Mars', position: { x: 1000, y: 0 } },
  ];
  const target = findSmartThrowTarget({
    currentCenter: { x: 0, y: 0 },
    screenVelocity: { x: -800, y: 0 },
    cameraRotation: 0,
    scale: 1,
    bodies,
    ships: [],
  });
  expect(target).toEqual({
    kind: 'body',
    id: 'moon',
    name: 'Moon',
  });
});

it('findSmartThrowTarget eases up and returns undefined for slow drags or opposite directions', () => {
  const bodies: SmartCandidate[] = [
    { kind: 'body', id: 'moon', name: 'Moon', position: { x: 400, y: 0 } },
  ];
  // Slow / moderate drag (< 650 px/s): eases up, no auto-focus
  const slow = findSmartThrowTarget({
    currentCenter: { x: 0, y: 0 },
    screenVelocity: { x: -400, y: 0 },
    cameraRotation: 0,
    scale: 1,
    bodies,
    ships: [],
  });
  expect(slow).toBeUndefined();

  // Thrown in opposite direction (swiping right throws away from Moon at +X)
  const opposite = findSmartThrowTarget({
    currentCenter: { x: 0, y: 0 },
    screenVelocity: { x: 800, y: 0 },
    cameraRotation: 0,
    scale: 1,
    bodies,
    ships: [],
  });
  expect(opposite).toBeUndefined();

  // Target in local vicinity of camera center (< 150 screen px away)
  const tooClose = findSmartThrowTarget({
    currentCenter: { x: 0, y: 0 },
    screenVelocity: { x: -800, y: 0 },
    cameraRotation: 0,
    scale: 1,
    bodies: [{ kind: 'body', id: 'earth', name: 'Earth', position: { x: 100, y: 0 } }],
    ships: [],
  });
  expect(tooClose).toBeUndefined();
});

it('smart fling smoothly guides camera to target, locks focus, and tracks moving bodies', () => {
  const camera = new CameraController();
  camera.drag({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);
  expect(camera.mode).toBe('free');

  const moonPos = { x: 500, y: 0 };
  const smartTarget = { kind: 'body' as const, id: 'moon', name: 'Moon' };
  camera.fling({ x: -800, y: 0 }, 800, 600, smartTarget);
  expect(camera.smartTarget).toEqual(smartTarget);

  // Advance time: camera glides towards moon
  for (let i = 0; i < 25; i++) {
    camera.update({
      body: { x: 0, y: 0 },
      ship: { x: 0, y: 0 },
      elapsed: 0.1,
      instant: false,
      width: 800,
      height: 600,
      focusPosition: moonPos,
    });
    if (!camera.smartTarget) break; // arrived
  }

  // Camera arrived and locked onto Moon
  expect(camera.smartTarget).toBeUndefined();
  expect(camera.focusTarget).toEqual(smartTarget);
  expect(camera.label([])).toBe('Moon view');
  expect(camera.last.center.x).toBeCloseTo(moonPos.x, 1);

  // If Moon moves in its orbit, camera continues tracking it
  const moonNewPos = { x: 510, y: 30 };
  camera.update({
    body: { x: 0, y: 0 },
    ship: { x: 0, y: 0 },
    elapsed: 0.1,
    instant: false,
    width: 800,
    height: 600,
    focusPosition: moonNewPos,
  });
  expect(camera.last.center.x).toBeCloseTo(moonNewPos.x, 1);
  expect(camera.last.center.y).toBeCloseTo(moonNewPos.y, 1);

  // Dragging breaks focus and continues manually
  camera.drag({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);
  expect(camera.focusTarget).toBeUndefined();
  expect(camera.label([])).toBe('Free camera');

  // Clicking cycle clears focus and returns to following ship
  camera.cycle([]);
  expect(camera.mode).toBe('follow');
  expect(camera.label([])).toBe('Follow ship');
});

it('smart fling targeting piloted ship smoothly returns camera to follow mode on arrival', () => {
  const camera = new CameraController();
  camera.drag({ x: -200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);
  expect(camera.mode).toBe('free');

  const shipPos = { x: 0, y: 0 };
  const smartTarget = { kind: 'ship' as const, id: 'ship-1', name: 'Alpha', isPilotedShip: true };
  camera.fling({ x: 800, y: 0 }, 800, 600, smartTarget);

  // Advance time: camera glides towards ship and arrives
  for (let i = 0; i < 25; i++) {
    camera.update({
      body: { x: 0, y: 0 },
      ship: shipPos,
      elapsed: 0.1,
      instant: false,
      width: 800,
      height: 600,
      focusPosition: shipPos,
    });
    if (!camera.smartTarget) break;
  }

  expect(camera.smartTarget).toBeUndefined();
  expect(camera.mode).toBe('follow');
  expect(camera.label([])).toBe('Follow ship');
});

it('smart fling does not overshoot target even at high fling velocity or frame rate spikes', () => {
  const camera = new CameraController();
  camera.drag({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);

  const targetPos = { x: 300, y: 0 };
  const smartTarget = { kind: 'body' as const, id: 'planet-b', name: 'Aurelia' };
  // Aggressive fling: 3500 px/s in screen coordinates towards target
  camera.fling({ x: -3500, y: 0 }, 800, 600, smartTarget);

  let prevDist = Infinity;
  let overshootDetected = false;

  // Simulate 60fps frames (16.6ms each)
  for (let frame = 0; frame < 120; frame++) {
    camera.update({
      body: { x: 0, y: 0 },
      ship: { x: 0, y: 0 },
      elapsed: 0.0166,
      instant: false,
      width: 800,
      height: 600,
      focusPosition: targetPos,
    });

    const currentX = camera.last.center.x;
    const dist = Math.hypot(targetPos.x - currentX, targetPos.y - camera.last.center.y);

    // If camera stepped PAST the target (+X > 300), that is an overshoot
    if (currentX > targetPos.x + 0.1) {
      overshootDetected = true;
    }

    // While still in flight, distance to target should decrease monotonically
    if (camera.smartTarget && dist > prevDist + 0.001) {
      overshootDetected = true;
    }
    prevDist = dist;

    if (!camera.smartTarget) break; // Docked
  }

  expect(overshootDetected).toBe(false);
  expect(camera.smartTarget).toBeUndefined();
  expect(camera.focusTarget).toEqual(smartTarget);
  expect(camera.last.center.x).toBeCloseTo(targetPos.x, 2);
  expect(camera.last.center.y).toBeCloseTo(targetPos.y, 2);
});

it('smart fling with off-axis angle smoothly suppresses lateral drift without swinging past target', () => {
  const camera = new CameraController();
  camera.drag({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);

  const targetPos = { x: 200, y: 0 };
  const smartTarget = { kind: 'body' as const, id: 'station-1', name: 'Gateway' };

  // Fling angled 25 degrees off axis (vx = -2000, vy = 800)
  camera.fling({ x: -2000, y: 800 }, 800, 600, smartTarget);

  for (let frame = 0; frame < 90; frame++) {
    camera.update({
      body: { x: 0, y: 0 },
      ship: { x: 0, y: 0 },
      elapsed: 0.0166,
      instant: false,
      width: 800,
      height: 600,
      focusPosition: targetPos,
    });
    if (!camera.smartTarget) break;
  }

  expect(camera.smartTarget).toBeUndefined();
  expect(camera.focusTarget).toEqual(smartTarget);
  expect(camera.last.center.x).toBeCloseTo(targetPos.x, 1);
  expect(camera.last.center.y).toBeCloseTo(targetPos.y, 1);
});


