const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getNpxCommand, runCommand: defaultRunCommand } = require('./hyperframesRenderer');

async function writeCheck(projectDir, name, result) {
  const checksDir = path.join(projectDir, 'checks');
  await fsp.mkdir(checksDir, { recursive: true });
  const lines = [
    `ok: ${Boolean(result?.ok)}`,
    `code: ${result?.code ?? ''}`,
    `stdout: ${result?.stdout ?? ''}`,
    `stderr: ${result?.stderr ?? ''}`,
    `error: ${result?.error ?? ''}`,
  ];
  await fsp.writeFile(path.join(checksDir, `${name}.txt`), lines.join('\n'), 'utf8');
}

async function runHyperframesCheck(projectDir, name, args, runCommand) {
  let result;
  try {
    result = await runCommand(getNpxCommand(), ['hyperframes', name, ...args], {
      cwd: projectDir,
    });
  } catch (error) {
    result = { ok: false, code: null, error: error.message, stdout: '', stderr: '' };
  }
  await writeCheck(projectDir, name, result);
  return result;
}

function summarizeFailedCheck(result = {}) {
  return result.error || result.stdout || result.stderr || `exit ${result.code}`;
}

async function checkFreeformProject({ projectDir, runCommand = defaultRunCommand } = {}) {
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'index.html'))) {
    return {
      success: false,
      lint: 'failed',
      validate: 'failed',
      inspect: 'failed',
      message: '校验失败：未找到 HyperFrames 工程入口 index.html。',
    };
  }

  const checks = [
    ['lint', []],
    ['validate', []],
    ['inspect', ['--samples', '12']],
  ];
  const summary = {
    success: true,
    lint: 'passed',
    validate: 'passed',
    inspect: 'passed',
    message: '动画工程校验通过。',
  };

  for (const [name, args] of checks) {
    const result = await runHyperframesCheck(projectDir, name, args, runCommand);
    summary[name] = result.ok ? 'passed' : 'failed';
    if (!result.ok && summary.success) {
      summary.success = false;
      summary.message = `动画工程 ${name} 校验失败：${summarizeFailedCheck(result)}`;
      summary.stdout = result.stdout;
      summary.stderr = result.stderr;
    }
  }

  return summary;
}

function getFfmpegCommand() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function runFfmpeg(command, args, options, runCommand) {
  try {
    return await runCommand(command, args, options);
  } catch (error) {
    return { ok: false, code: null, error: error.message, stdout: '', stderr: '' };
  }
}

async function writeVisualReport(reportPath, report) {
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return {
    success: report.success,
    message: report.message,
    report,
    issues: report.issues,
    contact_sheet_path: report.contact_sheet_path,
  };
}

async function inspectRenderedVideo({ projectDir, outputPath, runCommand = defaultRunCommand } = {}) {
  const videoPath = outputPath || (projectDir ? path.join(projectDir, 'output.mp4') : '');
  if (!projectDir || !videoPath || !fs.existsSync(videoPath)) {
    if (projectDir) {
      const checksDir = path.join(projectDir, 'checks');
      const reportPath = path.join(checksDir, 'visual_report.json');
      await fsp.mkdir(checksDir, { recursive: true });
      const report = {
        success: false,
        message: '质检失败：未找到 output.mp4。',
        issues: ['output_missing'],
      };
      return writeVisualReport(reportPath, report);
    }
    return {
      success: false,
      message: '质检失败：未找到 output.mp4。',
    };
  }

  const inspectDir = path.join(projectDir, 'inspect');
  const framesDir = path.join(inspectDir, 'frames');
  const checksDir = path.join(projectDir, 'checks');
  const reportPath = path.join(checksDir, 'visual_report.json');
  const contactSheetPath = path.join(inspectDir, 'contact_sheet.jpg');
  await fsp.rm(framesDir, { recursive: true, force: true });
  await fsp.mkdir(framesDir, { recursive: true });
  await fsp.mkdir(checksDir, { recursive: true });

  const ffmpeg = getFfmpegCommand();
  const framePattern = path.join(framesDir, 'frame_%04d.jpg');
  const extractResult = await runFfmpeg(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-vf',
    'fps=10/3,scale=320:-1',
    framePattern,
  ], { cwd: projectDir }, runCommand);

  if (!extractResult.ok) {
    const report = {
      success: false,
      message: '抽帧质检失败。',
      issues: ['frame_extract_failed'],
      stdout: extractResult.stdout,
      stderr: extractResult.stderr,
      error: extractResult.error,
    };
    return writeVisualReport(reportPath, report);
  }

  await fsp.rm(contactSheetPath, { force: true });
  const sheetResult = await runFfmpeg(ffmpeg, [
    '-y',
    '-framerate',
    '10/3',
    '-i',
    framePattern,
    '-vf',
    "select='not(mod(n,14))',scale=180:-1,tile=5x3",
    '-frames:v',
    '1',
    contactSheetPath,
  ], { cwd: projectDir }, runCommand);
  const hasContactSheet = fs.existsSync(contactSheetPath);
  const success = sheetResult.ok && hasContactSheet;

  const report = {
    success,
    message: success ? '抽帧质检完成。' : '接触表生成失败：未生成 inspect/contact_sheet.jpg。',
    contact_sheet_path: success ? contactSheetPath : '',
    issues: success ? [] : ['contact_sheet_failed'],
    stdout: sheetResult.stdout,
    stderr: sheetResult.stderr,
    error: sheetResult.error,
  };
  return writeVisualReport(reportPath, report);
}

module.exports = {
  checkFreeformProject,
  inspectRenderedVideo,
};
