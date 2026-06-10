#!/usr/bin/env node
const path = require('path');
const videoQualityReport = require('../server/services/videoQualityReport');

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('用法：node scripts/analyze-video-quality.js <HyperFrames工程目录>');
  process.exit(1);
}

const inputs = videoQualityReport.loadProjectQualityInputs(path.resolve(projectDir));
const report = videoQualityReport.buildVideoQualityReport({
  ...inputs,
  phraseCaptions: inputs.phraseCaptions || inputs.project.phrase_captions || inputs.project.tts_phrase_captions || [],
  targetDurationSec: inputs.project.target_duration_sec || 60,
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 2);
