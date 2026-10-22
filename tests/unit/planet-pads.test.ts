import { describe, expect, it } from 'vitest';
import { createPlanetField, createPlanetBake, validatePlanetField, deterministicMath as dm, type PlanetFieldDefinition } from '../../packages/game-api/src/index';
const base:PlanetFieldDefinition={generatorVersion:2,seed:741,recipe:'oceanic',radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,waterCoverage:.68};
const definition={...base,pads:[{id:'landing-area',angleRadians:0,widthMetres:48,elevationMetres:24}],padShoulderMetres:40};
const sphere=(a:number,z=0)=>{const r=Math.sqrt(1-z*z);return [r*Math.cos(a),r*Math.sin(a),z] as const;};

describe('shared sphere landing pads',()=>{
  it('flattens the same spherical cap across equator seam and latitude without recolouring substrate attributes',()=>{
    const field=createPlanetField(definition),original=createPlanetField(base),out=new Float64Array(8),raw=new Float64Array(8);
    for(const [a,z] of [[0,0],[-.005,0],[.005,.002],[2*Math.PI-.005,0]]){const p=sphere(a!,z);field.evaluate(...p,out);original.evaluate(...p,raw);expect(out[0]).toBe(24);expect(Array.from(out.slice(1,4))).toEqual([0,0,0]);expect(Array.from(out.slice(4))).toEqual(Array.from(raw.slice(4)));}
    field.evaluate(0,0,1,out);original.evaluate(0,0,1,raw);expect(out).toEqual(raw);
    field.evaluate(...sphere(.1),out);original.evaluate(...sphere(.1),raw);expect(out).toEqual(raw);
    expect(field.storageBytes).toBe(32+48);
  });
  it('matches independent quintic height and tangent finite differences throughout both shoulders',()=>{
    const field=createPlanetField(definition),original=createPlanetField(base),out=new Float64Array(8),raw=new Float64Array(8),left=new Float64Array(8),right=new Float64Array(8),e=1e-7;
    for(const sign of [-1,1])for(let i=1;i<20;i++){
      const t=i/20,a=sign*(24+40*t)/2048;field.evaluate(...sphere(a),out);original.evaluate(...sphere(a),raw);
      const w=t*t*t*(t*(6*t-15)+10);expect(out[0]).toBeCloseTo(24+(raw[0]!-24)*w,10);
      field.evaluate(...sphere(a-e),left);field.evaluate(...sphere(a+e),right);const derivative=(right[0]!-left[0]!)/(2*e),analytic=-Math.sin(a)*out[1]!+Math.cos(a)*out[2]!;
      expect(Math.abs(derivative-analytic)).toBeLessThan(.0001);
      field.evaluate(...sphere(a,-e),left);field.evaluate(...sphere(a,e),right);expect(Math.abs((right[0]!-left[0]!)/(2*e)-out[3]!)).toBeLessThan(.0001);
      expect(Math.hypot(out[1]!,out[2]!,out[3]!)).toBeLessThanOrEqual(field.bounds.maxGradientMetres);
    }
  });
  it('keeps global bounds finite and conservative through dense cap, shoulder and sphere samples',()=>{
    const field=createPlanetField(definition),out=new Float64Array(8);
    for(let i=0;i<20000;i++){const a=(i%1000)/1000*.16-.08,z=(Math.floor(i/1000)-10)/500;field.evaluate(...sphere(a,z),out);expect(Math.abs(out[0]!)).toBeLessThanOrEqual(48);expect(Math.hypot(out[1]!,out[2]!,out[3]!)).toBeLessThanOrEqual(field.bounds.maxGradientMetres);}
  });
  it('detaches nested pad inputs and includes every physical pad parameter in identity',()=>{
    const raw=structuredClone(definition),field=createPlanetField(raw);raw.pads[0]!.elevationMetres=-20;expect(field.definition.pads![0]!.elevationMetres).toBe(24);expect(Object.isFrozen(field.definition.pads![0])).toBe(true);
    expect(createPlanetField(raw).identity).not.toBe(field.identity);expect(createPlanetField({...definition,padShoulderMetres:41}).identity).not.toBe(field.identity);
  });
  it.each([
    {...base,pads:[]}, {...base,padShoulderMetres:40}, {...definition,padShoulderMetres:0}, {...definition,padShoulderMetres:1e-20},
    {...definition,pads:[{...definition.pads[0]!,widthMetres:1e-20}]}, {...definition,pads:[{...definition.pads[0]!,elevationMetres:49}]},
    {...definition,pads:[definition.pads[0]!,{...definition.pads[0]!,id:'other',angleRadians:2*Math.PI-.001}]},
  ])('rejects malformed, unresolvable or overlapping caps %j',raw=>{expect(()=>validatePlanetField(raw)).toThrow();});
  it('bakes physical ring, map and sea classification from the same padded field',()=>{
    const field=createPlanetField(definition),job=createPlanetBake(definition,{columns:32,rows:16,equatorSamples:8192}),out=new Float64Array(8);
    while(job.status==='pending')job.step(1024);const result=job.takeResult();
    for(let i=0;i<8192;i+=13){const a=i*2*Math.PI/8192;field.evaluate(dm.cos(a),dm.sin(a),0,out);expect(result.equator[i]).toBe(out[0]);}
    expect(result.equator[0]).toBe(24);expect(result.equator[8191]).toBe(24);
    for(let i=0;i<512;i++){const z=2*(Math.floor(i/32)+.5)/16-1,a=(i%32+.5)*2*Math.PI/32;const r=Math.sqrt(1-z*z);field.evaluate(r*dm.cos(a),r*dm.sin(a),z,out);expect(result.map.elevations[i]).toBe(out[0]);expect(result.map.waterMask[i]).toBe(+(2048+out[0]!<result.seaRadiusMetres!));}
    expect(job.storageBytes).toBe(0);
  });
});
