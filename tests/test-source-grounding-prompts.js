const assert = require('assert/strict');

const creativeSpecAgent = require('../server/services/creative-video/creativeSpecAgent');
const contentGraphAgent = require('../server/services/creative-video/html-video/contentGraphAgent');

const SOURCE_TRANSCRIPT_ONLY_MARKER = 'SOURCE_TRANSCRIPT_ONLY_UNIQUE_FACT_12345';
const LONG_TRANSCRIPT_START_MARKER = 'LONG_TRANSCRIPT_START_MARKER';
const LONG_TRANSCRIPT_TAIL_MARKER = 'AFTER_2400_SHOULD_NOT_APPEAR';

function createCreativeContext(transcript) {
  return {
    input: {
      mode: 'source_url',
      raw_text: '做成项目解读视频 https://github.com/owner/repo',
      source_url: 'https://github.com/owner/repo',
      source_hint: '做成项目解读视频',
    },
    source_context: {
      kind: 'source_url',
      summary: 'owner/repo',
      transcript,
      source_metadata: {
        kind: 'github_repo',
        url: 'https://github.com/owner/repo',
        title: 'owner/repo',
      },
    },
  };
}

function buildGraphPrompt(creativeContext) {
  return contentGraphAgent.buildContentGraphPrompt({
    sceneSpec: {
      title: 'owner/repo',
      scenes: [{ id: 'scene_01', narration_text: '这个项目把 HTML 变成视频。' }],
    },
    creativeContext,
    target: { duration_sec: 30 },
  });
}

function findSourceTranscriptLine(prompt) {
  return prompt.split('\n').find(line => line.startsWith('来源全文：')) || '';
}

const creativeContext = createCreativeContext([
  '# owner/repo',
  '',
  'Source: https://github.com/owner/repo',
  '',
  '## README',
  '',
  '这个项目把 HTML 变成视频。',
  `来源全文独有事实：${SOURCE_TRANSCRIPT_ONLY_MARKER}`,
].join('\n'));

const scenePrompt = creativeSpecAgent.buildSceneSpecPrompt({
  creativeContext,
  target: { duration_sec: 30 },
});

assert.match(scenePrompt, /来源材料是视频主题/);
assert.match(scenePrompt, /source_context\.transcript 是文章、网页或 GitHub repo 的真实来源材料/);
assert.match(scenePrompt, /必须基于其中的具体事实、名字、数字、项目术语和主张生成场景/);
assert.match(scenePrompt, /不要输出可套用到任何文章或任何仓库的泛泛句子。/);
assert.match(scenePrompt, /不要编造来源材料没有的精确数字、机构、版本、结论或功能。/);
assert.match(scenePrompt, /GitHub repo 视频只能基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。/);
assert.match(scenePrompt, /owner\/repo/);

const graphPrompt = buildGraphPrompt(creativeContext);
const graphPromptLines = graphPrompt.split('\n');
const sourceTranscriptLine = findSourceTranscriptLine(graphPrompt);

assert.ok(graphPromptLines.includes('SOURCE MATERIAL / 源素材上下文：'));
assert.match(graphPrompt, /\nSOURCE MATERIAL \/ 源素材上下文：\n/);
assert.match(graphPrompt, /SOURCE MATERIAL 是视频真正主题，不是装饰信息/);
assert.match(graphPrompt, /每个节点/);
assert.match(graphPrompt, /每个节点都必须引用或改写来源材料里的具体事实、名字、数字、产品、项目能力、术语或主张/);
assert.match(graphPrompt, /禁止输出可套用到任何文章或任何仓库的泛泛句子/);
assert.match(graphPrompt, /GitHub repo 只能基于 README、仓库描述、语言、目录结构和 topics/);
assert.match(graphPrompt, /不要假装读过全量源码/);
assert.match(graphPrompt, /真实 README 内容|这个项目把 HTML 变成视频/);
assert.ok(sourceTranscriptLine.includes(SOURCE_TRANSCRIPT_ONLY_MARKER));

const longTranscript = `${LONG_TRANSCRIPT_START_MARKER} ${'A'.repeat(2450)} ${LONG_TRANSCRIPT_TAIL_MARKER}`;
const longGraphPrompt = buildGraphPrompt(createCreativeContext(longTranscript));
const longSourceTranscriptLine = findSourceTranscriptLine(longGraphPrompt);
const longSourceTranscriptText = longSourceTranscriptLine.replace(/^来源全文：/, '');

assert.ok(longSourceTranscriptLine, '来源全文行应该存在');
assert.ok(longSourceTranscriptText.includes(LONG_TRANSCRIPT_START_MARKER));
assert.ok(!longSourceTranscriptText.includes(LONG_TRANSCRIPT_TAIL_MARKER));
assert.ok(longSourceTranscriptText.length <= 2401);

console.log('source grounding prompt tests passed');
