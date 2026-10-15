# Scenarios

[legacy-c64.json](legacy-c64.json) is a declarative design fixture, version 1.
It converts the original compact fictional system to SI seconds at 1 metre per
legacy world unit. It contains no claim of realistic Earth parameters.

Body orbits use radians counterclockwise from +X. For the circular clockwise moon,
position is `(a*cos(theta), a*sin(theta))`, velocity is
`direction*sqrt(mu_parent/a)*(-sin(theta), cos(theta))`, and
`theta(t)=phase+direction*sqrt(mu_parent/a³)*(t-epoch)`.

For a circular vessel preset, derive velocity by the same tangent rule about its
active body. Heading is a separate attitude value. For the pad preset, store contact
state instead of interpreting zero speed on the surface as an orbit. Future loaders
must validate parent graphs, IDs, radii, units and finite values.

The fractional theoretical SOI exit is floored here to 3000 metres, matching the
legacy integer checks. Later scenarios should choose explicit boundary values;
they need not inherit this rounding or the legacy engine acceleration model.
