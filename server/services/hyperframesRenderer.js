const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

function getNpxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, shell: process.platform === 'win32', ...options });
    } catch (error) {
      resolve({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on('close', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function renderHyperframesProject({ projectDir, runCommand: runCommandImpl = runCommand } = {}) {
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'index.html'))) {
    return {
      success: false,
      message: '渲染失败：未找到 HyperFrames 工程入口 index.html。',
    };
  }

  let result;
  try {
    result = await runCommandImpl(getNpxCommand(), ['hyperframes', 'render'], {
      cwd: projectDir,
    });
  } catch (error) {
    result = { ok: false, code: null, error: error.message, stdout: '', stderr: '' };
  }

  if (!result.ok) {
    return {
      success: false,
      message: `HyperFrames 渲染失败：${result.error || result.stderr || result.stdout || `exit ${result.code}`}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const outputPath = path.join(projectDir, 'output.mp4');
  const rendersOutput = findLatestRenderedMp4(projectDir);
  if (!fs.existsSync(outputPath) && rendersOutput) {
    await fsp.copyFile(rendersOutput, outputPath);
  }
  if (!fs.existsSync(outputPath)) {
    return {
      success: false,
      message: 'HyperFrames 渲染失败：未生成 output.mp4。',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    success: true,
    output_path: outputPath,
    message: '视频渲染完成。',
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function findLatestRenderedMp4(projectDir) {
  const rendersDir = path.join(projectDir, 'renders');
  if (!fs.existsSync(rendersDir)) return '';
  const files = fs.readdirSync(rendersDir)
    .filter(name => name.toLowerCase().endsWith('.mp4'))
    .map(name => {
      const filePath = path.join(rendersDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files[0]?.filePath || '';
}

module.exports = {
  getNpxCommand,
  runCommand,
  renderHyperframesProject,
  findLatestRenderedMp4,
};
