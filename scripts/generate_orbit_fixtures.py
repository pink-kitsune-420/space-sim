#!/usr/bin/env python3
"""Independent RK4 + Richardson oracle; standard library only, no runtime imports.

Integrate in normalized L=V=mu=1 units; require dt refinement agreement before
exporting SI-scaled fixtures. This numerical implementation shares no Kepler code.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def derivative(q):
    x, y, vx, vy = q
    r3 = math.hypot(x, y) ** 3
    return (vx, vy, -x / r3, -y / r3)


def integrate(q, duration, dt):
    count = max(1, math.ceil(abs(duration) / dt))
    h = duration / count
    q = list(q)
    for _ in range(count):
        k1 = derivative(q)
        k2 = derivative([v + h / 2 * d for v, d in zip(q, k1)])
        k3 = derivative([v + h / 2 * d for v, d in zip(q, k2)])
        k4 = derivative([v + h * d for v, d in zip(q, k3)])
        q = [v + h / 6 * (a + 2 * b + 2 * c + d)
             for v, a, b, c, d in zip(q, k1, k2, k3, k4)]
    return q


def state(q, length, speed):
    return {'position': {'x': q[0] * length, 'y': q[1] * length},
            'velocity': {'x': q[2] * speed, 'y': q[3] * speed}}


def main():
    fixtures = []
    inputs = []
    for e in [0, 1e-10, .1, .9, .999, 1 - 1e-10, 1, 1 + 1e-10, 1.1, 2]:
        for direction in [-1, 1]:
            inputs.append((f'e{e}-dir{direction}', [1, 0, 0, direction * math.sqrt(1 + e)], .7))
    inputs += [('radial-in', [1, 0, -.3, 0], .3), ('radial-out', [1, 0, 1.8, 0], .2),
               ('radial-rest', [1, 0, 0, 0], .4),
               ('general-in', [1, 0, -.7, .6], .3), ('general-out', [1, 0, .4, 1.2], 2),
               ('tiny-time', [1, 0, .4, 1.2], 1e-10)]
    for index, (name, q, duration) in enumerate(inputs):
        for sign in [-1, 1]:
            dt = .0005
            coarse = integrate(q, sign * duration, dt)
            fine = integrate(q, sign * duration, dt / 2)
            finer = integrate(q, sign * duration, dt / 4)
            error = max(abs(a - b) for a, b in zip(fine, finer))
            if error > 2e-12:
                raise ValueError(f'{name} refinement error {error}')
            expected = [b + (b - a) / 15 for a, b in zip(fine, finer)]
            angle = index * .37
            def rotate(v):
                c, s = math.cos(angle), math.sin(angle)
                return [c * v[0] - s * v[1], s * v[0] + c * v[1],
                        c * v[2] - s * v[3], s * v[2] + c * v[3]]
            length = [1, 640, 1e6][index % 3]
            mu = [1, 13107200, 3e12][index % 3]
            speed = math.sqrt(mu / length)
            fixtures.append({'id': f'{name}-time{sign}', 'mu': mu, 'lengthScale': length,
                             'speedScale': speed, 'seconds': sign * duration * length / speed,
                             'input': state(rotate(q), length, speed),
                             'expected': state(rotate(expected), length, speed),
                             'refinementDifference': error,
                             'coarseFineDifference': max(abs(a - b) for a, b in zip(coarse, fine)),
                             'normalizedTolerance': 1e-10})
    document = {'schemaVersion': 1, 'units': {'position': 'm', 'velocity': 'm/s', 'time': 's', 'mu': 'm^3/s^2'},
                'model': 'ideal-two-body-v1',
                'generator': {'path': 'scripts/generate_orbit_fixtures.py',
                              'sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                              'method': 'Independent RK4 at h=.0005,.00025,.000125 normalized seconds; Richardson extrapolation'},
                'fixtures': fixtures}
    path = ROOT / 'tests/fixtures/orbits.json'
    path.write_text(json.dumps(document, indent=2) + '\n')
    print(f'Wrote {len(fixtures)} fixtures; worst normalized refinement difference '
          f'{max(f["refinementDifference"] for f in fixtures):.3g}')


if __name__ == '__main__':
    main()
