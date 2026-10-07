import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sceneImageGenerationStatus} from '../frontend-react/src/components/creative/illustrated/illustratedImageProgress.mjs';

const sceneIds = ['first', 'second', 'third'];
const scene = id => ({id,selected:null});
const operation = (status, queued, running, extra={}) => ({type:'images',status,sceneIds,
  progress:{queued,running,success:0,failed:0,cancelled:0},...extra});
const state = value => ({operation:value});

assert.equal(sceneImageGenerationStatus(scene('first'),state(operation('queued',3,0))), 'queued');
assert.equal(sceneImageGenerationStatus(scene('third'),state(operation('running',2,1))), 'queued');
assert.equal(sceneImageGenerationStatus(scene('first'),state(operation('running',2,1))), 'running');
assert.equal(sceneImageGenerationStatus(scene('first'),state(operation('running',1,1))), '');
assert.equal(sceneImageGenerationStatus(scene('second'),state(operation('running',1,1))), 'running');
assert.equal(sceneImageGenerationStatus(scene('second'),state(operation('running',0,0))), '');
assert.equal(sceneImageGenerationStatus(scene('first'),state(operation('cancelled',2,0))), '');
assert.equal(sceneImageGenerationStatus(scene('outside'),state(operation('running',2,1))), '');
assert.equal(sceneImageGenerationStatus({...scene('first'),selected:{id:'existing'}},state(operation('running',2,1))), '');
assert.equal(sceneImageGenerationStatus({...scene('first'),selected:{id:'existing'}},state(operation('running',2,1,{regenerate:true}))), 'running');

const page = fs.readFileSync(new URL('../frontend-react/src/pages/OneClickCreativePage.jsx',import.meta.url),'utf8');
const panel = fs.readFileSync(new URL('../frontend-react/src/components/creative/illustrated/IllustratedMediaPanel.jsx',import.meta.url),'utf8');
assert.match(page,/activeStreamRef\.current[^\n]*!isGeneratingIllustratedImages/, 'image tasks should refresh scene state while SSE is active');
assert.match(panel,/generation==='running'\?<span role="status"[\s\S]*?正在生成这张配图/, 'the active image placeholder should display a loading indicator');
assert.doesNotMatch(panel,/bg-surface-2\/\d+/, 'the project surface color does not support Tailwind opacity modifiers');
console.log('旁白配图逐幕生成进度：10 项状态和界面接线检查通过。');
