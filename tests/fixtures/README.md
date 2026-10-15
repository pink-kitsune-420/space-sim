# Orbital fixtures — planned

Generate independent JSON cases for circular/elliptic/escape motion, burns, frame
transforms, impacts, moving-moon encounters, warp partitions and camera transitions.
Each fixture needs units, model ID/version, generator provenance, expected values
and explicit tolerances. Do not copy production output and call it an oracle.

See [verification](../../docs/VERIFICATION.md). The scenario data is a seed for
fixture generation; it is not a numerical accuracy test by itself.
