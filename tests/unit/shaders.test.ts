import { expect, it } from 'vitest';
import { DEFAULT_SHADERS, MAX_SHADER_FILE_BYTES, SHADER_FORMAT, parseShaderFile, validateShaderPack } from '../../packages/render-2d/src/shaders';

const fragment = '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(1.0);}';
const pack = (passes: unknown) => ({ format: SHADER_FORMAT, name: 'My look', passes });

it('round-trips the default shaders and fills partial packs from the built-in defaults', () => {
  expect(parseShaderFile(JSON.stringify(DEFAULT_SHADERS), 'default.json')).toEqual(DEFAULT_SHADERS);
  const resolved = validateShaderPack(pack({ scene: { fragment } }));
  expect(resolved.passes.scene.fragment).toBe(fragment);
  expect(resolved.passes.scene.vertex).toBe(DEFAULT_SHADERS.passes.scene.vertex);
  expect(resolved.passes.vector).toEqual(DEFAULT_SHADERS.passes.vector);
  expect(resolved.passes.text).toEqual(DEFAULT_SHADERS.passes.text);
  expect(Object.isFrozen(resolved.passes.scene)).toBe(true);
});

it('loads plain GLSL scene fragments without executing source as JavaScript', () => {
  const resolved = parseShaderFile(fragment, 'night.FRAG');
  expect(resolved.name).toBe('night.FRAG');
  expect(resolved.passes.scene.fragment).toBe(fragment);
  expect(resolved.passes.text).toEqual(DEFAULT_SHADERS.passes.text);
});

it('rejects malformed, unknown, incompatible and oversized pack data', () => {
  for (const value of [null, [], {}, { ...pack({ scene: {} }), format: 'space-sim-shaders/2' },
    { ...pack({ scene: {} }), name: '' }, pack({}), pack({ scen: {} }), pack({ scene: null }),
    pack({ scene: { fragment: 12 } }), pack({ scene: { fragment: ' ' } }),
    pack({ scene: { fragment: 'x'.repeat(256 * 1024 + 1) } }), pack({ scene: { url: 'https://example.com' } })]) {
    expect(() => validateShaderPack(value)).toThrow();
  }
  expect(() => parseShaderFile('{broken', 'bad.json')).toThrow();
  expect(() => parseShaderFile('x'.repeat(MAX_SHADER_FILE_BYTES + 1), 'big.frag')).toThrow('1 MiB');
});
