const path = require('path');
const fs = require('fs/promises');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const defaultLayoutQaService = require('./layoutQaService');
const defaultFfmpegComposer = require('./ffmpegComposer');
const projectStore = require('./projectStore');
const { addExport, addRevision, saveProject } = projectStore;
const { normalizeProject, markCheckpointStage } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');
const { findDraft } = require('./htmlVideoDraftService');
const { analyzeTimelineMismatch } = require('./timelineRepair');
const sfxEventService = require('./sfxEventService');
const { buildAssetUsageReport, updateRuntimePolicyViolations } = require('./assetUsagePhase');
const {
  report,
  getOutputConfig,
  inspectProjectLayoutBeforeRender,
  expectedDurationSec,
  fitFrameDurationsToCaptions,
  validateReasonableTimelineDuration,
  resolveTargetDurationSec,
} = require('./timelineGuards');
const {
  markRenderCheckpoint,
  renderCheckpointKey,
  relativeProjectPath,
  resolveNarrationPath,
  collectRenderedFramesFromProject,
  missingRenderedFrameIds,
  ensureProjectDir,
  createProject,
  materializeProject,
  renderHtmlVideoFrames: renderHtmlVideoFramesUnchecked,
  runtimeAssetPolicyAttestation,
  renderAttestationMatches,
  formalFrameMp4,
} = require('./frameRenderPhase');

async function assetRegistryPreflight({ projectDir, project, inspectionProject = project, creativeContext = {} } = {}) {
  const assetUsageReport = buildAssetUsageReport({ project: inspectionProject, projectDir, creativeContext });
  project.asset_usage_report = assetUsageReport;
  const references = Array.isArray(assetUsageReport.unregistered_image_references)
    ? assetUsageReport.unregistered_image_references
    : [];
  const diagnostics = references.length ? [createDiagnostic({
    code: 'unregistered_visual_asset_reference',
    stage: 'project',
    sub_stage: 'asset_usage',
    severity: 'warning',
    retryable: false,
    user_message: `静态检查发现 ${references.length} 个疑似未登记视觉素材引用，将由 Chromium 运行时继续裁决。`,
    details: { unregistered_image_references: references },
  })] : [];
  assetUsageReport.diagnostics = diagnostics;
  await saveProject(projectDir, project);
  return { success: true, project, diagnostics };
}

async function renderHtmlVideoFrames(options = {}) {
  const materializer = options.services?.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir(options);
  let project = normalizeProject(options.project);
  const diagnostics = [];
  if (options.materialize) {
    const materialized = await materializer.materializeProject({ projectDir: resolvedProjectDir, project });
    project = normalizeProject(materialized.project);
    diagnostics.push(...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }));
  }
  const preflight = await assetRegistryPreflight({
    projectDir: resolvedProjectDir,
    project,
    creativeContext: options.creativeContext,
  });
  diagnostics.push(...preflight.diagnostics);
  const rendered = await renderHtmlVideoFramesUnchecked({
    ...options,
    project,
    projectDir: resolvedProjectDir,
    materialize: false,
  });
  return { ...rendered, diagnostics: [...diagnostics, ...normalizeDiagnostics(rendered.diagnostics)] };
}

function markComposeCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'compose', patch);
}

function markDurationVerifyCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'duration_verify', patch);
}

function markVisualInspectCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'visual_inspect', patch);
}

async function runtimePolicyRevalidationFrameIds(projectDir, project) {
  const checkpointFrames = project.generation_checkpoint?.stages?.render?.frames || {};
  const frameIds = [];
  for (const frame of (project.frames || [])) {
    const checkpointKey = renderCheckpointKey(frame);
    const checkpoint = checkpointFrames[checkpointKey] || checkpointFrames[frame.id] || {};
    if (checkpoint.status !== 'done') continue;
    const formal = await formalFrameMp4(projectDir, checkpoint);
    if (!formal || !checkpoint.output_hash || formal.hash !== checkpoint.output_hash) {
      frameIds.push(frame.id || frame.scene_id || checkpointKey);
      continue;
    }
    const expected = await runtimeAssetPolicyAttestation(projectDir, project, frame, {
      checkpoint_key: checkpointKey, mp4_path: checkpoint.mp4_path, output_hash: checkpoint.output_hash,
    });
    if (!renderAttestationMatches(checkpoint.runtime_asset_policy_attestation, expected)) {
      frameIds.push(frame.id || frame.scene_id || checkpointKey);
    }
  }
  return frameIds;
}

async function composeHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  services = {},
  onProgress = null,
  targetDurationSec,
} = {}) {
  void targetDurationSec;
  const ffmpegComposer = services.ffmpegComposer || defaultFfmpegComposer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  let nextProject = normalizeProject(project);
  const diagnostics = [];
  const preflight = await assetRegistryPreflight({ projectDir: resolvedProjectDir, project: nextProject });
  diagnostics.push(...preflight.diagnostics);
  const outputConfig = getOutputConfig(nextProject);
  const missingRendered = await missingRenderedFrameIds(nextProject, resolvedProjectDir);
  if (missingRendered.length) {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markComposeCheckpoint(current, {
        status: 'failed',
        output_path: '',
        output_audio_path: '',
        diagnostic_code: 'render_checkpoint_missing',
      });
      return current;
    });
    const diagnostic = createDiagnostic({
      code: 'render_checkpoint_missing',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: `缺少已渲染帧，无法合成：${missingRendered.join(', ')}。`,
      retryable: true,
      repair_action: 'rerender_frames',
      details: { frame_ids: missingRendered },
    });
    return {
      success: false,
      message: diagnostic.user_message,
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: [],
      diagnostics: [diagnostic],
    };
  }
  const composeRevalidationFrameIds = await runtimePolicyRevalidationFrameIds(resolvedProjectDir, nextProject);
  if (composeRevalidationFrameIds.length) {
    const diagnostic = createDiagnostic({
      code: 'runtime_asset_policy_revalidation_required', stage: 'compose', sub_stage: 'render',
      retryable: true, repair_action: 'rerender_frames',
      user_message: '已有渲染帧的运行时素材安全证明缺失或已过期，需要重新渲染后再合成。',
      details: { frame_ids: composeRevalidationFrameIds },
    });
    return { success: false, code: diagnostic.code, message: diagnostic.user_message, project: nextProject,
      project_dir: resolvedProjectDir, html_video_project_path: resolvedProjectDir, rendered_frames: [], diagnostics: [diagnostic] };
  }
  const renderedFrames = await collectRenderedFramesFromProject(nextProject, resolvedProjectDir);
  const videoPath = path.join(resolvedProjectDir, 'exports', 'output.mp4');
  await report(onProgress, {
    type: 'html_video_compose_started',
    stage: 'project',
    sub_stage: 'compose',
    message: '正在合成 html-video 成片...',
    data: {
      frame_count: renderedFrames.length,
      output_path: videoPath,
    },
  });
  const concat = await ffmpegComposer.concatFramesWithFfmpeg(renderedFrames, videoPath, resolvedProjectDir, {
    fps: outputConfig.fps,
  });
  if (!concat.success) {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markComposeCheckpoint(current, {
        status: 'failed',
        output_path: relativeProjectPath(resolvedProjectDir, videoPath),
        output_audio_path: '',
        diagnostic_code: concat.code || 'compose_failed',
      });
      return current;
    });
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: concat.message || 'html-video 视频合成失败。',
      retryable: true,
      repair_action: 'retry_compose',
      details: { strategy: concat.strategy, stderr: concat.stderr },
    }));
    return {
      success: false,
      message: concat.message || 'html-video 视频合成失败。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: renderedFrames,
      diagnostics,
    };
  }

  let finalOutput = concat.output_path || videoPath;
  const composeVideoOutput = finalOutput;
  const audioDisabled = nextProject.audio?.status === 'skipped'
    && nextProject.audio?.reason === 'disabled_by_settings';
  const audioStatus = String(nextProject.audio?.status || '').trim().toLowerCase();
  const hasAudioIntent = !audioDisabled && (
    /^(ready|done|generated|rendered|mixed)$/i.test(audioStatus)
    || Boolean(nextProject.audio?.narration_path || nextProject.audio?.tts_manifest_path || nextProject.audio?.music_path)
  );
  let audioTrackCheck = null;
  if (!audioDisabled) {
    const narrationPath = await resolveNarrationPath(nextProject, resolvedProjectDir, ffmpegComposer, diagnostics);
    const { events: sfxEvents, dropped: sfxDropped, avoidance_dropped: sfxAvoided = [] } = sfxEventService.resolveProjectSfxEventsForMux({
      project: nextProject,
      projectDir: resolvedProjectDir,
      // 旁白避让：混音时传 voiceWindows，避免自动音效压过旁白
      voiceWindows: sfxEventService.buildVoiceWindowsFromProject(nextProject),
    });
    if (sfxAvoided.length) {
      // 避让移除是预期行为而非素材故障，与 sfx_event_dropped 分开出诊断；
      // 诊断体系只把 severity=warning 视为非阻断（validationGate/retryPlanner 无 info 档），故用 warning
      diagnostics.push(createDiagnostic({
        code: 'sfx_event_avoided',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: `${sfxAvoided.length} 条自动音效为避让旁白已自动移除。`,
        details: { avoided: sfxAvoided },
      }));
    }
    if (sfxDropped.length) {
      diagnostics.push(createDiagnostic({
        code: 'sfx_event_dropped',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: `${sfxDropped.length} 条自动音效素材不可用，导出时已跳过。`,
        details: { dropped: sfxDropped },
      }));
    }
    const muxOptions = {
      videoPath: finalOutput,
      outputPath: path.join(resolvedProjectDir, 'exports', 'output-audio.mp4'),
      narrationPath,
      musicPath: nextProject.audio?.music_path,
      videoDurationSec: expectedDurationSec(nextProject),
      ...(nextProject.audio?.mix || {}),
    };
    let mux = await ffmpegComposer.muxAudioWithFfmpeg({ ...muxOptions, sfxEvents });
    if (!mux.success && sfxEvents.length) {
      diagnostics.push(createDiagnostic({
        code: 'sfx_mix_failed',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: '自动音效混入失败，已尝试导出无音效版本。',
        details: { stderr: mux.stderr },
      }));
      mux = await ffmpegComposer.muxAudioWithFfmpeg({ ...muxOptions, sfxEvents: [] });
    }
    if (!mux.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markComposeCheckpoint(current, {
          status: 'failed',
          output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
          output_audio_path: '',
          diagnostic_code: mux.code || 'compose_failed',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: 'compose_failed',
        stage: 'compose',
        sub_stage: 'compose',
        user_message: mux.message || 'html-video 音频混流失败。',
        retryable: true,
        repair_action: 'retry_compose',
        details: { stderr: mux.stderr },
      }));
      return {
        success: false,
        message: mux.message || 'html-video 音频混流失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: renderedFrames,
        diagnostics,
      };
    }
    finalOutput = mux.output_path || finalOutput;
  }

  if (hasAudioIntent && typeof ffmpegComposer.verifyAudioStreamWithFfprobe === 'function') {
    await report(onProgress, {
      type: 'html_video_audio_verify_started',
      stage: 'project',
      sub_stage: 'compose',
      message: '正在校验导出视频音频轨...',
      data: {
        output_path: finalOutput,
      },
    });
    audioTrackCheck = await ffmpegComposer.verifyAudioStreamWithFfprobe({
      videoPath: finalOutput,
    });
    if (audioTrackCheck.skipped) {
      diagnostics.push(createDiagnostic({
        code: audioTrackCheck.code || 'ffprobe_skipped',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: audioTrackCheck.message || '已跳过导出音频轨校验。',
        details: audioTrackCheck,
      }));
      await report(onProgress, {
        type: 'html_video_audio_verify_done',
        stage: 'project',
        sub_stage: 'compose',
        message: '已跳过导出视频音频轨校验。',
        data: audioTrackCheck,
      });
    } else if (!audioTrackCheck.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markComposeCheckpoint(current, {
          status: 'failed',
          output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
          output_audio_path: finalOutput !== composeVideoOutput ? relativeProjectPath(resolvedProjectDir, finalOutput) : '',
          diagnostic_code: 'render_output_missing_audio',
        });
        return current;
      });
      const diagnostic = createDiagnostic({
        code: 'render_output_missing_audio',
        stage: 'compose',
        sub_stage: 'compose',
        user_message: audioTrackCheck.message || '导出成片缺少音频轨，已停止发布该文件。',
        retryable: true,
        repair_action: 'retry_compose',
        details: audioTrackCheck,
      });
      diagnostics.push(diagnostic);
      return {
        success: false,
        message: diagnostic.user_message,
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        output_path: finalOutput,
        rendered_frames: renderedFrames,
        diagnostics,
        audio_track_check: audioTrackCheck,
      };
    } else {
      await report(onProgress, {
        type: 'html_video_audio_verify_done',
        stage: 'project',
        sub_stage: 'compose',
        message: '导出视频音频轨校验完成。',
        data: audioTrackCheck,
      });
    }
  }
  nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
    markComposeCheckpoint(current, {
      status: 'done',
      output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
      output_audio_path: finalOutput !== composeVideoOutput ? relativeProjectPath(resolvedProjectDir, finalOutput) : '',
      diagnostic_code: '',
    });
    return current;
  });

  let durationCheck = null;
  const expectedDuration = expectedDurationSec(nextProject);
  if (typeof ffmpegComposer.verifyDurationWithFfprobe === 'function') {
    await report(onProgress, {
      type: 'html_video_duration_verify_started',
      stage: 'project',
      sub_stage: 'duration_verify',
      message: '正在校验导出视频时长...',
      data: {},
    });
    durationCheck = await ffmpegComposer.verifyDurationWithFfprobe({
      videoPath: finalOutput,
      expectedDurationSec: expectedDuration,
      toleranceSec: 1.5,
    });
    if (durationCheck.skipped) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'skipped',
          expected_duration_sec: expectedDuration,
          actual_duration_sec: null,
          diagnostic_code: durationCheck.code || '',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: durationCheck.code || 'ffprobe_skipped',
        stage: 'compose',
        sub_stage: 'duration_verify',
        user_message: durationCheck.message || '已跳过导出时长校验。',
        details: durationCheck,
      }));
      await report(onProgress, {
        type: 'html_video_duration_verify_done',
        stage: 'project',
        sub_stage: 'duration_verify',
        message: '已跳过导出视频时长校验。',
        data: durationCheck,
      });
    } else if (!durationCheck.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'failed',
          expected_duration_sec: durationCheck.expected_duration_sec ?? expectedDuration,
          actual_duration_sec: durationCheck.actual_duration_sec ?? durationCheck.duration_sec ?? null,
          diagnostic_code: 'duration_mismatch',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: 'duration_mismatch',
        stage: 'compose',
        sub_stage: 'duration_verify',
        user_message: durationCheck.message || '导出视频时长校验失败。',
        retryable: true,
        repair_action: 'retry_duration_verify',
        details: durationCheck,
      }));
      return {
        success: false,
        message: durationCheck.message || '导出视频时长校验失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        output_path: finalOutput,
        rendered_frames: renderedFrames,
        diagnostics,
        duration_check: durationCheck,
      };
    } else {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'done',
          expected_duration_sec: durationCheck.expected_duration_sec ?? expectedDuration,
          actual_duration_sec: durationCheck.actual_duration_sec ?? durationCheck.duration_sec ?? null,
          diagnostic_code: '',
        });
        return current;
      });
      await report(onProgress, {
        type: 'html_video_duration_verify_done',
        stage: 'project',
        sub_stage: 'duration_verify',
        message: '导出视频时长校验完成。',
        data: durationCheck,
      });
    }
  } else {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markDurationVerifyCheckpoint(current, {
        status: 'skipped',
        expected_duration_sec: expectedDuration,
        actual_duration_sec: null,
        diagnostic_code: 'ffprobe_unavailable',
      });
      return current;
    });
  }

  const exportEntry = addExport(nextProject, {
    format: 'mp4',
    path: path.relative(resolvedProjectDir, finalOutput).replace(/\\/g, '/'),
    absolute_path: finalOutput,
    render_mode: 'html-video',
  });
  // addExport 去重会把第二次起的记录改名为 output-audio-N.mp4，但 mux 始终覆盖写
  // output-audio.mp4，需把成片复制到去重后的路径，否则记录指向不存在的文件（播放报“文件不存在”）。
  const exportAbs = projectStore.resolveProjectPath(resolvedProjectDir, exportEntry.path);
  if (path.resolve(exportAbs) !== path.resolve(finalOutput)) {
    await fs.copyFile(finalOutput, exportAbs);
    exportEntry.absolute_path = exportAbs;
  }
  addRevision(nextProject, {
    summary: 'html-video 工程渲染完成。',
    change: { type: 'render', output_path: finalOutput },
  });
  nextProject.status = 'rendered';
  await saveProject(resolvedProjectDir, nextProject);
  await report(onProgress, {
    type: 'html_video_export_ready',
    stage: 'project',
    sub_stage: 'compose',
    message: 'html-video 成片已导出。',
    data: {
      output_path: finalOutput,
      export_count: nextProject.exports?.length || 0,
    },
  });

  return {
    success: true,
    message: 'html-video 工程已渲染。',
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    output_path: finalOutput,
    rendered_frames: renderedFrames,
    diagnostics,
    duration_check: durationCheck,
    audio_track_check: audioTrackCheck,
  };
}

async function renderHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  services = {},
  skipRender = false,
  runLayoutQa = false,
  ignoreLayoutQaFrameIds = [],
  onProgress = null,
  targetDurationSec,
  creativeContext = {},
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const trustedTargetDurationSec = resolveTargetDurationSec(project, targetDurationSec);
  let nextProject = normalizeProject(project);
  const diagnostics = [];

  const materialized = await materializer.materializeProject({
    projectDir: resolvedProjectDir,
    project: nextProject,
  });
  nextProject = normalizeProject(materialized.project);
  diagnostics.push(...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }));
  await saveProject(resolvedProjectDir, nextProject);

  if (skipRender) {
    return {
      success: true,
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }
  const revalidationFrameIds = await runtimePolicyRevalidationFrameIds(resolvedProjectDir, nextProject);
  if (revalidationFrameIds.length) {
    const diagnostic = createDiagnostic({
      code: 'runtime_asset_policy_revalidation_required', stage: 'compose', sub_stage: 'render',
      retryable: true, repair_action: 'rerender_frames',
      user_message: '已有渲染帧的运行时素材安全证明缺失或已过期，需要重新渲染后再合成。',
      details: { frame_ids: revalidationFrameIds },
    });
    return { success: false, code: diagnostic.code, message: diagnostic.user_message, project: nextProject,
      project_dir: resolvedProjectDir, html_video_project_path: resolvedProjectDir, rendered_frames: [], diagnostics: [diagnostic] };
  }
  const timingFit = fitFrameDurationsToCaptions(nextProject);
  diagnostics.push(...timingFit.diagnostics);
  if (!timingFit.ok) {
    const firstError = timingFit.diagnostics.find(item => item.fallback_allowed === false);
    return {
      success: false,
      message: firstError?.user_message || '视频时间轴异常，已停止渲染。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }
  if (timingFit.changed) {
    await saveProject(resolvedProjectDir, nextProject);
  }

  const timelineDurationOptions = Number.isFinite(trustedTargetDurationSec) && trustedTargetDurationSec > 0
    ? { targetDurationSec: trustedTargetDurationSec }
    : {};
  const timelineDuration = validateReasonableTimelineDuration(nextProject, timelineDurationOptions);
  if (!timelineDuration.ok) {
    const mismatch = analyzeTimelineMismatch({
      project: nextProject,
      targetDurationSec: trustedTargetDurationSec,
      audioManifest: nextProject.audio,
    });
    diagnostics.push(createDiagnostic({
      code: timelineDuration.code,
      stage: 'timeline-consistency',
      sub_stage: 'timeline_check',
      user_message: timelineDuration.message || '视频时间轴异常，已停止渲染。',
      retryable: true,
      repair_action: mismatch.repair_action || 'repair_timeline',
      details: {
        ...timelineDuration,
        timeline_mismatch: mismatch,
      },
      fallback_allowed: false,
    }));
    return {
      success: false,
      code: timelineDuration.code,
      message: timelineDuration.message || '视频时间轴异常，已停止渲染。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  if (runLayoutQa === true) {
    const layoutQa = await inspectProjectLayoutBeforeRender({
      projectDir: resolvedProjectDir,
      project: nextProject,
      services,
      onProgress,
      ignoreFrameIds: ignoreLayoutQaFrameIds,
    });
    diagnostics.push(...layoutQa.diagnostics);
    if (!layoutQa.success) {
      return {
        success: false,
        code: 'layout_qa_failed',
        message: layoutQa.diagnostics[0]?.user_message || 'html-video 帧布局检查未通过，已停止渲染。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        diagnostics,
        layout_qa: layoutQa.reports,
      };
    }
  }

  const rendered = await renderHtmlVideoFrames({
    rootDir,
    workflowId,
    runId,
    projectDir: resolvedProjectDir,
    project: nextProject,
    services,
    onProgress,
    materialize: false,
    creativeContext,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics));
  if (!rendered.success) {
    return {
      success: false,
      ...(rendered.code ? { code: rendered.code } : {}),
      message: rendered.message || 'html-video 帧渲染失败。',
      project: rendered.project || nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: rendered.rendered_frames || [],
      diagnostics,
    };
  }

  const composed = await composeHtmlVideoProject({
    rootDir,
    workflowId,
    runId,
    projectDir: resolvedProjectDir,
    project: rendered.project,
    services,
    onProgress,
    targetDurationSec: trustedTargetDurationSec,
  });
  diagnostics.push(...normalizeDiagnostics(composed.diagnostics));
  if (!composed.success) {
    return {
      success: false,
      ...(composed.code ? { code: composed.code } : {}),
      message: composed.message || 'html-video 工程渲染失败。',
      project: composed.project || rendered.project,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      output_path: composed.output_path,
      rendered_frames: rendered.rendered_frames || [],
      diagnostics,
      duration_check: composed.duration_check,
    };
  }

  return {
    success: true,
    message: 'html-video 工程已渲染。',
    project: composed.project,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    output_path: composed.output_path,
    rendered_frames: rendered.rendered_frames || composed.rendered_frames || [],
    diagnostics,
    duration_check: composed.duration_check,
  };
}

async function materializeHtmlVideoProject(options = {}) {
  const result = await renderHtmlVideoProject({
    ...options,
    skipRender: true,
    mode: 'materialize',
  });
  return {
    ...result,
    message: result.message || 'HTML 已重新生成。',
  };
}

async function renderHtmlVideoFramePreview(options = {}) {
  const frameId = String(options.frameId || options.frame_id || '');
  const draftId = String(options.draftId || options.draft_id || '').trim();
  if (!frameId) {
    return { success: false, message: '缺少要渲染的帧 ID。', diagnostics: [] };
  }
  const frameRenderer = options.services?.frameRenderer || defaultFrameRenderer;
  const materialized = await materializeProject(options);
  const diagnostics = [...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' })];
  if (!materialized.success) {
    return materialized;
  }
  const nextProject = normalizeProject(materialized.project);
  const targetFrame = findFrameByAnyId(nextProject, frameId);
  if (!targetFrame) {
    return {
      success: false,
      message: '未找到要渲染的帧。',
      project: nextProject,
      project_dir: materialized.project_dir,
      html_video_project_path: materialized.html_video_project_path,
      diagnostics,
    };
  }
  let frameToRender = targetFrame;
  let previewName = sanitizePathSegment(canonicalFrameId(targetFrame) || frameId);
  if (draftId) {
    const draft = findDraft(nextProject, frameId, draftId);
    if (!draft || draft.status === 'discarded') {
      return {
        success: false,
        code: 'DRAFT_NOT_FOUND',
        message: '未找到要预览的草稿。',
        project: nextProject,
        project_dir: materialized.project_dir,
        html_video_project_path: materialized.html_video_project_path,
        diagnostics,
      };
    }
    frameToRender = { ...targetFrame, html_path: draft.html_path };
    previewName = `${previewName}-${sanitizePathSegment(draft.id)}`;
  }
  const actualFrameId = canonicalFrameId(targetFrame) || targetFrame.id || frameId;
  const inspectionProject = {
    ...nextProject,
    frames: nextProject.frames.map(frame => (frame === targetFrame ? frameToRender : frame)),
  };
  const preflight = await assetRegistryPreflight({
    projectDir: materialized.project_dir,
    project: nextProject,
    inspectionProject,
  });
  diagnostics.push(...preflight.diagnostics);
  const outputConfig = getOutputConfig(nextProject);
  const previewPath = path.join(materialized.project_dir, 'inspect', 'previews', `${previewName}.mp4`);
  let layoutQa = null;
  if (options.runLayoutQa === true || options.run_layout_qa === true) {
    const layoutQaService = options.services?.layoutQaService || defaultLayoutQaService;
    const sourcePath = path.isAbsolute(frameToRender.html_path)
      ? frameToRender.html_path
      : path.join(materialized.project_dir, frameToRender.html_path);
    layoutQa = await layoutQaService.inspectFrameHtmlLayout({
      htmlPath: sourcePath,
      frame: frameToRender,
      resolution: outputConfig.resolution,
      durationSec: frameToRender.duration_sec,
    });
  }
  const rendered = await frameRenderer.renderFrame(frameToRender, {
    projectDir: materialized.project_dir,
    project: nextProject,
    outputPath: previewPath,
    resolution: outputConfig.resolution,
    fps: outputConfig.fps,
    runLayoutQa: options.runLayoutQa === true || options.run_layout_qa === true,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, {
    stage: 'render',
    sub_stage: 'render',
    frame_id: actualFrameId,
    details: { frame_id: actualFrameId },
  }));
  if (!rendered.success) {
    const policyFailure = rendered.code === 'runtime_visual_asset_policy_violation';
    const policyDiagnostic = (rendered.diagnostics || []).find(item => item?.code === rendered.code);
    const violations = Array.isArray(policyDiagnostic?.details?.violations) ? policyDiagnostic.details.violations : [];
    if (policyFailure) {
      nextProject.asset_usage_report = updateRuntimePolicyViolations(
        buildAssetUsageReport({ project: nextProject, projectDir: materialized.project_dir }),
        actualFrameId,
        violations,
      );
      await saveProject(materialized.project_dir, nextProject);
    }
    diagnostics.push(createDiagnostic({
      code: rendered.code || 'render_failed',
      stage: 'render',
      sub_stage: policyFailure ? 'frame_html' : 'render',
      frame_id: actualFrameId,
      user_message: rendered.message || 'html-video 帧渲染失败。',
      retryable: true,
      repair_action: policyFailure ? 'retry_frame_html' : 'retry_render',
      details: { frame_id: actualFrameId, output_path: rendered.output_path, ...(policyFailure ? { violations } : {}) },
    }));
    return {
      success: false,
      code: rendered.code || 'render_failed',
      message: rendered.message || 'html-video 帧渲染失败。',
      project: nextProject,
      project_dir: materialized.project_dir,
      html_video_project_path: materialized.html_video_project_path,
      diagnostics,
    };
  }
  if (!draftId && nextProject.asset_usage_report?.runtime_policy_violations) {
    nextProject.asset_usage_report = updateRuntimePolicyViolations(nextProject.asset_usage_report, actualFrameId, []);
    await saveProject(materialized.project_dir, nextProject);
  }
  return {
    success: true,
    message: '单帧预览已更新。',
    project: nextProject,
    project_dir: materialized.project_dir,
    html_video_project_path: materialized.html_video_project_path,
    preview_frame_id: frameId,
    preview_draft_id: draftId || null,
    preview_path: rendered.output_path,
    layout_qa: layoutQa || rendered.layout_qa || null,
    diagnostics,
  };
}

async function exportHtmlVideoProject(options = {}) {
  return renderHtmlVideoProject({
    ...options,
    skipRender: false,
    mode: 'export',
  });
}

module.exports = {
  createProject,
  materializeProject,
  materializeHtmlVideoProject,
  renderHtmlVideoFramePreview,
  exportHtmlVideoProject,
  renderHtmlVideoProject,
  renderHtmlVideoFrames,
  composeHtmlVideoProject,
  fitFrameDurationsToCaptions,
  validateReasonableTimelineDuration,
  markRenderCheckpoint,
  markComposeCheckpoint,
  markDurationVerifyCheckpoint,
  markVisualInspectCheckpoint,
  renderCheckpointKey,
  renderProject: renderHtmlVideoProject,
  exportProject: exportHtmlVideoProject,
  rerenderProject: renderHtmlVideoProject,
  applyEditPatch: require('./editPatchService').applyEditPatch,
};
