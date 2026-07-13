const fs = require('fs/promises');
const path = require('path');

const { createDiagnostic } = require('./diagnostics');
const { validateProject } = require('./projectSchema');
const { validateHtmlCanvasContract } = require('./frameCanvasContract');
const { validateOverlayHtml, hasRealOverlayElement, stripNonElementHtml } = require('./motionPrimitiveCatalog');
const { validateSceneSpecTimelineConsistency } = require('./timelineConsistency');
const { normalizeCaptionsForFrame } = require('./captionLayer');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isSafeRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  if (!text || path.isAbsolute(text)) return false;
  return !text.split('/').some(part => part === '..');
}

function resolveProjectPath(projectDir, relativePath) {
  const root = path.resolve(projectDir);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

function add(diagnostics, code, stage, user_message, details = {}, fallback_allowed = true, extra = {}) {
  const inputDetails = objectOrEmpty(details);
  diagnostics.push({
    ...createDiagnostic({
      code,
      stage,
      sub_stage: extra.sub_stage || sub_stage_for_diagnostic(stage, code),
      frame_id: extra.frame_id || inputDetails.frame_id,
      retryable: extra.retryable,
      repair_action: extra.repair_action,
      user_message,
      details: inputDetails,
      fallback_allowed,
    }),
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => (
      !['sub_stage', 'frame_id', 'retryable', 'repair_action'].includes(key)
    ))),
  });
}

function sub_stage_for_diagnostic(stage, code) {
  if (stage === 'frame' || String(code || '').startsWith('raw_html_')) return 'frame_html';
  if (stage === 'timeline') return 'timeline_check';
  if (['environment', 'assets', 'overrides'].includes(stage)) return 'validate_project';
  return stage === 'project' ? 'validate_project' : '';
}

function isBlockingDiagnostic(diagnostic = {}) {
  const details = objectOrEmpty(diagnostic.details);
  if (details.blocking === false) return false;
  if (diagnostic.severity === 'warning') return false;
  return true;
}

// 注释/<style>/<script> 剥离统一复用 motionPrimitiveCatalog.stripNonElementHtml（单向依赖，无环）
function hasTextKey(html, key) {
  const cleaned = stripNonElementHtml(html);
  const tags = cleaned.match(/<[A-Za-z][^>]*>/g) || [];
  const pattern = new RegExp(`\\bdata-text-key\\s*=\\s*(['"])${key}\\1`, 'i');
  return tags.some(tag => pattern.test(tag));
}

function warningDiagnostic(diagnostics, code, stage, user_message, details = {}) {
  add(diagnostics, code, stage, user_message, {
    ...details,
    blocking: false,
  }, true, { severity: 'warning' });
}

function validateEnvironment(diagnostics, environment) {
  if (!environment || environment.ok === true) return;
  const items = arrayOrEmpty(environment.diagnostics);
  const hasPlaywright = items.some(item => /playwright|chromium/i.test(String(item.code || item.message || '')) && item.ok === false);
  const hasFfmpeg = items.some(item => /ffmpeg/i.test(String(item.code || item.message || '')) && item.ok === false);
  if (hasPlaywright) {
    add(diagnostics, 'playwright_not_configured', 'environment', 'Playwright Chromium 未配置，无法渲染 html-video。', { environment });
  }
  if (hasFfmpeg) {
    add(diagnostics, 'ffmpeg_not_configured', 'environment', 'ffmpeg 未配置，无法合成 html-video。', { environment });
  }
}

function collectMissingTextKeys(html) {
  const missing = [];
  for (const key of ['headline', 'subtitle', 'body']) {
    if (!hasTextKey(html, key)) {
      missing.push(key);
    }
  }
  return missing;
}

async function readFrameHtmlForValidation(projectDir, frame, diagnostics) {
  if (!projectDir || frame.source_mode !== 'raw_html' || !frame.html_path) return null;
  const htmlPath = resolveProjectPath(projectDir, frame.html_path);
  if (!htmlPath) {
    add(diagnostics, 'raw_html_path_invalid', 'frame', 'raw_html 帧 HTML 路径不合法。', {
      frame_id: frame.id,
      html_path: frame.html_path,
    }, true, {
      sub_stage: 'frame_html',
      frame_id: frame.id,
    });
    return null;
  }
  try {
    return await fs.readFile(htmlPath, 'utf8');
  } catch {
    return null;
  }
}

// asset_first 专属：raw_html 帧的 motion overlay 确定性校验（warning 级，不阻断）。
// hf_first 或无 overlay 的 HTML 不产生任何 issue（硬约束 A）。
function assetFirstOverlayIssues(html, { visualStrategy, frameHeight = 1920 } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  // P1-8：按真实 opening tag 判定，<style> 选择器/注释里的字样不触发校验（也不误报缺根节点）
  if (!hasRealOverlayElement(html)) return [];
  const result = validateOverlayHtml(html, { height: frameHeight });
  if (result.valid) {
    // Finding 1：非 px 非零定位值无法静态确认安全区合规——warning 级提示人工复核（不阻断）
    if (result.indeterminate) {
      return [{
        code: 'overlay_position_indeterminate',
        severity: 'warning',
        message: result.message || 'overlay 定位值无法静态确认安全区合规，请人工复核',
      }];
    }
    return [];
  }
  return [{
    code: result.reason_code,
    severity: 'warning',
    message: result.message,
  }];
}

// scene_html：scene 帧 beat scope 完整性检查——每个 beat_windows 条目须有对应
// data-mp-beat-scope="<beat_id>" 真实元素，缺失只告警（scene_html 不做确定性注入，维持现状）。
function sceneBeatScopeIssues(html, beatWindows = []) {
  if (!Array.isArray(beatWindows) || !beatWindows.length) return [];
  const tags = stripNonElementHtml(html).match(/<[A-Za-z][^>]*>/g) || [];
  const missing = [];
  for (const window of beatWindows) {
    const id = String(window?.id || '').trim();
    if (!id) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\bdata-mp-beat-scope\\s*=\\s*(['"])${escaped}\\1`, 'i');
    if (!tags.some(tag => pattern.test(tag))) missing.push(id);
  }
  if (!missing.length) return [];
  return [{
    code: 'scene_beat_scope_missing',
    severity: 'warning',
    message: `scene_html 帧缺少 ${missing.join('、')} 对应的 data-mp-beat-scope 元素，这些 beat 期间画面无局部变化。`,
    missing_beat_ids: missing,
  }];
}

async function validateRawHtmlFrames({ diagnostics, projectDir, project, frames }) {
  const output = objectOrEmpty(project.output);
  const resolution = objectOrEmpty(output.resolution);
  const visualStrategy = project.visual_strategy || null;
  // P2-B：无图 diagram beat 的骨架确定性校验（asset_first 专属，warning 级不阻断）。
  // beat 信息从 project.visual_plan.beats 按 frame.beat_id 查（gate 现有可达上下文）。
  const beatsById = new Map(
    arrayOrEmpty(objectOrEmpty(project.visual_plan).beats)
      .filter(beat => beat && beat.id)
      .map(beat => [String(beat.id).trim(), beat]),
  );
  for (const frame of frames) {
    const html = await readFrameHtmlForValidation(projectDir, frame, diagnostics);
    if (html == null) continue;
    const resolutionValidation = validateHtmlCanvasContract(html, { resolution });
    if (!resolutionValidation.success) {
      add(diagnostics, 'raw_html_resolution_mismatch', 'frame', resolutionValidation.message || 'raw_html 帧画幅尺寸不符合工程输出尺寸。', {
        frame_id: frame.id,
        html_path: frame.html_path,
        expected: resolutionValidation.expected,
        actual: resolutionValidation.actual,
      }, true, {
        sub_stage: 'frame_html',
        frame_id: frame.id,
      });
    }
    const missing = collectMissingTextKeys(html);
    if (missing.length) {
    warningDiagnostic(diagnostics, 'raw_html_text_keys_missing', 'frame', 'raw_html 帧缺少可编辑文本锚点。', {
      frame_id: frame.id,
      missing_keys: missing,
    });
    }
    for (const issue of assetFirstOverlayIssues(html, {
      visualStrategy,
      frameHeight: Number(resolution.height) || 1920,
    })) {
      warningDiagnostic(diagnostics, issue.code, 'frame', issue.message || 'motion overlay 不符合安全区约束。', {
        frame_id: frame.id,
      });
    }
    // scene_html：scene 帧（metadata.beat_windows）逐 beat 检查 data-mp-beat-scope 元素完整性
    for (const issue of sceneBeatScopeIssues(html, arrayOrEmpty(objectOrEmpty(frame.metadata).beat_windows))) {
      warningDiagnostic(diagnostics, issue.code, 'frame', issue.message, {
        frame_id: frame.id,
        missing_beat_ids: issue.missing_beat_ids,
      });
    }
    // 无图 diagram beat 的 HTML 必须使用统一骨架（data-mp-diagram-base）；缺失只告警不阻断
    if (visualStrategy === 'asset_first') {
      const beat = beatsById.get(String(frame.beat_id || frame.beatId || '').trim());
      if (beat && objectOrEmpty(beat.visual_base).type === 'diagram' && !html.includes('data-mp-diagram-base')) {
        warningDiagnostic(diagnostics, 'diagram_base_missing', 'frame', '无图 beat 未使用统一 diagram 骨架（缺少 data-mp-diagram-base）。', {
          frame_id: frame.id,
          beat_id: beat.id,
        });
      }
    }
  }
}

function validateNarrationCaptionSafety({ diagnostics, frames, mediaOptions = {} }) {
  const captionsDisabledByMedia = mediaOptions.generateCaptions === false;
  for (const frame of frames) {
    const narration = String(frame?.narration_text || frame?.narrationText || '').trim();
    if (!narration) continue;
    if (captionsDisabledByMedia || frame.generate_captions === false || frame.generateCaptions === false) {
      warningDiagnostic(diagnostics, 'caption_generation_disabled_for_narration', 'frame', '该镜头有旁白，但字幕生成已关闭。', {
        frame_id: frame.id || frame.scene_id,
      });
      continue;
    }
    if (!normalizeCaptionsForFrame(frame).length) {
      warningDiagnostic(diagnostics, 'caption_missing_for_narration', 'frame', '该镜头有旁白，但未能生成有效字幕层。', {
        frame_id: frame.id || frame.scene_id,
      });
    }
  }
}

async function validateHtmlVideoProject({
  project,
  projectDir,
  environment,
  sceneSpec,
  mediaOptions = {},
} = {}) {
  const input = objectOrEmpty(project);
  const diagnostics = [];
  const frames = arrayOrEmpty(input.frames);

  await validateRawHtmlFrames({ diagnostics, projectDir, project: input, frames });
  validateNarrationCaptionSafety({ diagnostics, frames, mediaOptions });

  const schemaValidation = validateProject(input);
  for (const error of schemaValidation.errors || []) {
    if (error.code === 'timeline-item-kind-unsupported') {
      add(diagnostics, 'timeline_item_kind_unsupported', 'timeline', error.message || '首版时间线只支持 frame 类型条目。', error);
    }
    if (error.code === 'asset-path-absolute' || error.code === 'asset-path-escape') {
      add(diagnostics, 'asset_path_invalid', 'assets', error.message || '素材路径不合法。', error);
    }
  }

  arrayOrEmpty(input.assets).forEach(asset => {
    if (asset && asset.path && !isSafeRelativePath(asset.path)) {
      const exists = diagnostics.some(item => item.code === 'asset_path_invalid' && item.details.ref === asset.id);
      if (!exists) {
        add(diagnostics, 'asset_path_invalid', 'assets', '素材路径不合法。', { ref: asset.id, path: asset.path });
      }
    }
  });

  if (sceneSpec) {
    const timelineConsistency = validateSceneSpecTimelineConsistency({
      sceneSpec,
      project: input,
      audio: input.audio,
      mediaOptions,
    });
    diagnostics.push(...timelineConsistency.diagnostics);
  }

  const htmlOverride = objectOrEmpty(objectOrEmpty(input.overrides).html);
  if (htmlOverride.enabled === true) {
    const frames = objectOrEmpty(htmlOverride.frames);
    const active = Object.entries(frames).filter(([, value]) => objectOrEmpty(value).enabled === true);
    if (active.length) {
      add(diagnostics, 'html_override_active', 'overrides', '当前工程启用了 HTML 改写。', {
        frames: active.map(([key]) => key),
      });
    }
  }

  validateEnvironment(diagnostics, environment);

  return {
    ok: diagnostics.every(item => !isBlockingDiagnostic(item)),
    diagnostics,
  };
}

module.exports = {
  validateHtmlVideoProject,
  collectMissingTextKeys,
  assetFirstOverlayIssues,
  sceneBeatScopeIssues,
};
