// Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-Project

import type { RenderAir, RenderBody, Vec } from '../../../packages/game-api/src/index';

/** Viewer-only phase clock, reset on world identity changes. Warp is deliberately
 * absent. Suspension prevents a hidden tab's missing animation callbacks becoming
 * catch-up motion on return. Nothing enters saves or simulation fingerprints. */
export class AirClock {
  seconds = 0;
  private world: unknown;
  private active = false;
  suspend(): void { this.active = false; }
  advance(elapsed: number, paused: boolean, hidden: boolean, world: unknown): void {
    if (world !== this.world) { this.world = world; this.seconds = 0; this.active = false; }
    if (!paused && !hidden && this.active && Number.isFinite(elapsed) && elapsed > 0) this.seconds += elapsed;
    this.active = !paused && !hidden;
  }
}

type MutableAir = { -readonly [K in keyof RenderAir]: RenderAir[K] };
/** Successor-owned art parameters; each body descriptor is borrowed through drawing.
 * Only authored Primus air participates; Parvus and other bodies retain legacy art.
 * Cached descriptor changes never invalidate terrain cells or contact geometry. */
export class SuccessorAir {
  mode: RenderAir['mode'] = 'off';
  readonly clock = new AirClock();
  private readonly descriptor: MutableAir = { mode: 'off', heightMetres: 1, cloudAltitudeMetres: 1,
    cloudThicknessMetres: 1, color: [.416, .706, .925], opacity: .12, phaseRadians: 0 };
  forBody(body: Pick<RenderBody, 'id' | 'radius' | 'atmosphereColor'>, low: boolean, sunDirection?: Vec): RenderAir | undefined {
    // Both supplied world fixtures and runtime-authored color changes must honor airless bodies.
    if (body.id !== 'planet' || !body.atmosphereColor || (body.atmosphereColor.length === 9 && /00$/i.test(body.atmosphereColor))) return undefined;
    const air = this.descriptor;
    air.sunDirection = sunDirection;
    air.mode = low && this.mode === 'clouds' ? 'air' : this.mode;
    air.heightMetres = body.radius * .06;
    air.cloudAltitudeMetres = body.radius * .018;
    air.cloudThicknessMetres = body.radius * .008;
    air.phaseRadians = (this.clock.seconds * .0005) % (Math.PI * 2);
    return air;
  }
  get stats() { return { mode: this.mode, seconds: this.clock.seconds, phaseRadians: this.descriptor.phaseRadians,
    clock: 'real-seconds-pause-hidden-freeze-no-warp', convention: 'fixed-altitude-radial-section', scope: 'Primus-only; Parvus-airless' }; }
}
