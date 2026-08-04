// run-backend.js at repo root
const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const venvBin = isWin ? 'Scripts' : 'bin';
const exe = isWin ? 'python.exe' : 'python';

const pythonPath = path.join(__dirname, 'backend', 'venv', venvBin, exe);
const backendDir = path.join(__dirname, 'backend');

const child = spawn(
  pythonPath,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'],
  {
    cwd: backendDir,
    stdio: 'inherit',
  }
);

child.on('exit', (code) => process.exit(code));