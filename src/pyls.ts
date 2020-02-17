import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import { window } from 'vscode';
import { runTaskCommand } from './tasks';
import { startSpinner, stopSpinner } from './spinner';
import { RustupConfig } from './rustup'
import { withWsl } from './utils/child_process';

export async function checkPylsInstallation(serverPath: string, python: string, config: RustupConfig) {
  return new Promise((resolve, reject) => {
    const childProcess = cp.spawn(serverPath, ['--check', '-p', python]);
    childProcess.on("exit", async (code, signal) => {
      switch (code) {
        case 0: {
          resolve();
          return;
        }
        case 7: {
          const clicked = await Promise.resolve(
            window.showInformationMessage('Pyls is not installed. Install with pip?', 'Yes'),
          );
          if (clicked) {
            await installPyls(python, config);
            window.showInformationMessage('Pyls successfully installed!');
            resolve();
            return;
          }
          reject();
          return;
        }
        case 8: {
          const err = util.format("'%s' is an invalid python runtime.", python);
          window.showErrorMessage(err);
          reject();
          return;
        }
        default: {
          const err = util.format("Check for pyls exited with unknown error", python);
          console.log(err)
          reject();
          return;
        }
      }
      resolve()
    });
  });
}

async function installPyls(py_runtime: string, config: RustupConfig) {
  startSpinner('PySearch', 'Installing python language server…');
  try {
    const { command, args } = withWsl(config.useWSL).modifyArgs(py_runtime, [
      '-m',
      'pip',
      'install',
      'python-language-server[all]',
    ]);
    await runTaskCommand({ command, args }, 'Installing python language server…');
  } catch (e) {
    console.log(e);
    window.showErrorMessage('Could not install python language server');
    stopSpinner('Could not install python language server');
    throw e;
  }
}