import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {AssistantActivity} from './assistant-activity';
import {AssistantPanel} from './assistant-panel';

test.each(['Replying…','Revline','Editing…','Queued…','Watching footage…','Listening to audio…','Applying edits…','Downloading footage…'])('%s uses text feedback without a loading glyph or progress bar',label=>{
  const html=renderToStaticMarkup(<AssistantActivity label={label} detail="My project"/>);
  expect(html).not.toMatch(/lucide-loader|lucide-clock|assistant-activity-spinner|<progress|processing-status-sweep/);
  expect(html).toContain('My project');
  expect(html).toContain('data-state="working"');
});

test('removing loading decorations preserves the working label and Stop control',()=>{
  const html=renderToStaticMarkup(<AssistantPanel messages={[{id:'request',role:'user',text:'Trim this.'}]} running configured hasClips demo={false} activity="Applying edits…" activitySource="My project" onSend={async()=>{}} onStop={async()=>{}}/>);
  expect(html).toContain('Applying edits…');
  expect(html).toContain('My project');
  expect(html).toContain('aria-label="Stop editing"');
  expect(html).not.toMatch(/assistant-activity-spinner|lucide-loader-circle/);
});
