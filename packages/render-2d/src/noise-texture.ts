/** Lattice size of the shared value-noise texture: it repeats every NOISE_SIZE units. */
export const NOISE_SIZE = 64;

let lattice: Uint8Array | undefined;
/** Deterministic random lattice (xorshift32), generated once in code. */
function noiseLattice(): Uint8Array {
  if (lattice) return lattice;
  lattice = new Uint8Array(NOISE_SIZE ** 3);
  let s = 0x9e3779b9;
  for (let i = 0; i < lattice.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    lattice[i] = s >>> 24;
  }
  return lattice;
}

/** The scene shader's `u_noise`: one trilinear fetch per noise octave instead of eight hashes,
 * which keeps the shader small to compile and cheap per pixel. */
export function createNoiseTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, noiseLattice());
  for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, wrap, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return texture;
}
