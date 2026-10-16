import {describe,expect,it} from 'vitest';
import {DEFAULT_LAB_CONFIG,parseLabConfig} from './remotion-lab-model';

describe('individual white-canvas Graphics candidates',()=>{
  it('migrates saved scene demos into individual elements and rejects invalid controls',()=>{
    expect(parseLabConfig({...DEFAULT_LAB_CONFIG,scene:'cards'}).scene).toBe('block-card');
    expect(parseLabConfig({...DEFAULT_LAB_CONFIG,scene:'arrows'}).scene).toBe('block-arrow');
    for(const patch of [{blockX:2},{blockWidth:0},{blockBend:Infinity},{blockFill:'red'},{blockChecks:[true]}])expect(()=>parseLabConfig({...DEFAULT_LAB_CONFIG,...patch})).toThrow();
  });
});
