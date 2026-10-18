import { afterEach, expect, it, vi } from 'vitest';
import { createProfilers } from '../../modules/profiler/src/index';
afterEach(() => vi.restoreAllMocks());
it('computes grouped frame costs and bounded history independently, then stops disposed collectors', () => {
  let now=0,flushes=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const factory=createProfilers(),first=factory.create(()=>flushes++),second=factory.create();
  for(let i=0;i<605;i++) {first.begin(16);now+=1;first.lap('physics');now+=2;first.lap('prediction');first.end();}
  expect(first.summary()).toMatchObject({frames:605,work:{avg:3,p95:3},sections:{physics:{avg:1},prediction:{avg:2}}});
  expect(first.group(['physics','prediction'])).toMatchObject({avg:3,p95:3,max:3});
  const history=first.history();expect(history).toHaveLength(600);expect(history[0]!.t).toBe(.015);expect(history[599]!.physics).toBe(1);
  expect(second.summary().frames).toBe(0);
  for(let i=0;i<1005;i++)first.event('marker',{index:i});
  expect(first.log()).toHaveLength(1000);expect(first.log()[0]!.index).toBe(5);
  first.precise=true;first.dispose();first.begin(16);first.lap('physics');first.end();first.event('late');
  expect(first.summary().frames).toBe(0);expect(first.log()).toEqual([]);expect(flushes).toBe(0);
  factory.dispose();expect(()=>factory.create()).toThrow('disposed');
});
