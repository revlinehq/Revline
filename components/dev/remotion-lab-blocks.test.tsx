import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RemotionLabBlock} from './remotion-lab-blocks';
import {DEFAULT_LAB_CONFIG,LAB_SCENES,parseLabConfig} from './remotion-lab-model';

describe('individual white-canvas Graphics candidates',()=>{
  for(const scene of LAB_SCENES)it(`${scene.label} is a deterministic independent editable element`,()=>{
    const config={...DEFAULT_LAB_CONFIG,scene:scene.id};
    const render=(frame:number)=>renderToStaticMarkup(<RemotionLabBlock config={config} frame={frame}/>);
    const first=render(7);render(180);render(0);
    expect(render(7)).toEqual(first);
    expect(first).toContain('data-block-canvas="white"');
    expect(first).toContain(`data-block-kind="${scene.id}"`);
    expect(first).not.toMatch(/gradient|animation:|NaN|Infinity/);
    expect(render(60)).not.toEqual(render(0));
    expect(parseLabConfig(config)).toEqual(config);
  });
  it('migrates saved scene demos into individual elements and rejects invalid controls',()=>{
    expect(parseLabConfig({...DEFAULT_LAB_CONFIG,scene:'cards'}).scene).toBe('block-card');
    expect(parseLabConfig({...DEFAULT_LAB_CONFIG,scene:'arrows'}).scene).toBe('block-arrow');
    for(const patch of [{blockX:2},{blockWidth:0},{blockBend:Infinity},{blockFill:'red'},{blockChecks:[true]}])expect(()=>parseLabConfig({...DEFAULT_LAB_CONFIG,...patch})).toThrow();
    expect(LAB_SCENES).toHaveLength(15);
  });
});
