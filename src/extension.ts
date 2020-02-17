import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  commands,
  Disposable,
  ExtensionContext,
  IndentAction,
  languages,
  TextDocument,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
  WorkspaceFoldersChangeEvent,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  NotificationType,
  ServerOptions,
} from 'vscode-languageclient';
import { RLSConfiguration } from './configuration';
import { SignatureHelpProvider } from './providers/signatureHelpProvider';
import { checkForRls, ensureToolchain, rustupUpdate } from './rustup';
import { startSpinner, stopSpinner } from './spinner';
import { activateTaskProvider, Execution, runRlsCommand } from './tasks';
import { getServerInfo, installServerIfRequired } from './update';
import { checkPylsInstallation } from './pyls';
import { withWsl } from './utils/child_process';
import { uriWindowsToWsl, uriWslToWindows } from './utils/wslpath';
import * as workspace_util from './workspace_util';

interface ProgressParams {
  id: string;
  title?: string;
  message?: string;
  percentage?: number;
  done?: boolean;
}


export async function activate(context: vscode.ExtensionContext) {
  workspace.onDidOpenTextDocument(doc => whenOpeningTextDocument(doc, context));
  workspace.textDocuments.forEach(doc => whenOpeningTextDocument(doc, context));
  workspace.onDidChangeWorkspaceFolders(e =>
    whenChangingWorkspaceFolders(e, context),
  );
}

export async function deactivate() {
  return Promise.all([...workspaces.values()].map(ws => ws.stop()));
}


// Taken from https://github.com/Microsoft/vscode-extension-samples/blob/master/lsp-multi-server-sample/client/src/extension.ts
function whenOpeningTextDocument(
  document: TextDocument,
  context: ExtensionContext,
) {
  if (document.languageId !== 'python') {
    return;
  }

  const uri = document.uri;
  let folder = workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return;
  }

  const folderPath = folder.uri.toString();

  if (!workspaces.has(folderPath)) {
    const workspace = new ClientWorkspace(folder);
    activeWorkspace = workspace;
    workspaces.set(folderPath, workspace);
    workspace.start(context);
  } else {
    const ws = workspaces.get(folderPath);
    activeWorkspace = typeof ws === 'undefined' ? null : ws;
  }
}

// Don't use URI as it's unreliable the same path might not become the same URI.
const workspaces: Map<string, ClientWorkspace> = new Map();
let activeWorkspace: ClientWorkspace | null;
let commandsRegistered: boolean = false;

// We run one RLS and one corresponding language client per workspace folder
// (VSCode workspace, not Cargo workspace). This class contains all the per-client
// and per-workspace stuff.
class ClientWorkspace {
  // FIXME: Don't only rely on lazily initializing it once on startup,
  // handle possible `pysearch-client.*` value changes while extension is running
  private readonly config: RLSConfiguration;
  private lc: LanguageClient | null = null;
  private readonly folder: WorkspaceFolder;
  private disposables: Disposable[];

  constructor(folder: WorkspaceFolder) {
    this.config = RLSConfiguration.loadFromWorkspace(folder.uri.fsPath);
    this.folder = folder;
    this.disposables = [];
  }

  public async start(context: ExtensionContext) {
    startSpinner('PySearch', 'Starting');

    const rlsPath = path.join(__dirname,  '../bin/pysearch');
    const python = this.config.pythonPath;
    const config = this.config.rustupConfig();
    checkPylsInstallation(rlsPath, python, config)
    .then(() => {
    const serverOptions: ServerOptions = async () => {
      await this.autoUpdate();
      return await this.makeRlsProcess();
    };

    const pattern = this.config.multiProjectEnabled
      ? `${this.folder.uri.path}/**`
      : undefined;
    const collectionName = this.config.multiProjectEnabled
      ? `python ${this.folder.uri.toString()}`
      : 'python';
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { language: 'python', scheme: 'file', pattern },
        { language: 'python', scheme: 'untitled', pattern },
      ],
      diagnosticCollectionName: collectionName,
      synchronize: { configurationSection: 'python' },
      // Controls when to focus the channel rather than when to reveal it in the drop-down list
      revealOutputChannelOn: this.config.revealOutputChannelOn,
      initializationOptions: {
        omitInitBuild: true,
        cmdRun: true,
      },
      workspaceFolder: this.folder,
    };

    // Changes paths between Windows and Windows Subsystem for Linux
    if (this.config.useWSL) {
      clientOptions.uriConverters = {
        code2Protocol: (uri: Uri) => {
          const res = Uri.file(uriWindowsToWsl(uri.fsPath)).toString();
          console.log(`code2Protocol for path ${uri.fsPath} -> ${res}`);
          return res;
        },
        protocol2Code: (wslUri: string) => {
          const urlDecodedPath = Uri.parse(wslUri).path;
          const winPath = Uri.file(uriWslToWindows(urlDecodedPath));
          console.log(`protocol2Code for path ${wslUri} -> ${winPath.fsPath}`);
          return winPath;
        },
      };
    }

    // Create the language client and start the client.
    this.lc = new LanguageClient(
      'rust-client',
      'Rust Language Server',
      serverOptions,
      clientOptions,
    );

    const selector = this.config.multiProjectEnabled
      ? { language: 'python', scheme: 'file', pattern }
      : { language: 'python' };

    this.setupProgressCounter();
    this.registerCommands(context, this.config.multiProjectEnabled);
    this.disposables.push(activateTaskProvider(this.folder));
    this.disposables.push(this.lc.start());
    this.disposables.push(
      languages.registerSignatureHelpProvider(
        selector,
        new SignatureHelpProvider(this.lc),
        '(',
        ',',
      ),
    );
    });
  }

  public async stop() {
    if (this.lc) {
      await this.lc.stop();
    }

    this.disposables.forEach(d => d.dispose());
    commandsRegistered = false;
  }

  private registerCommands(
    context: ExtensionContext,
    multiProjectEnabled: boolean,
  ) {
    if (!this.lc) {
      return;
    }
    if (multiProjectEnabled && commandsRegistered) {
      return;
    }

    commandsRegistered = true;

    const restartServer = commands.registerCommand('rls.restart', async () => {
      const ws =
        multiProjectEnabled && activeWorkspace ? activeWorkspace : this;
      await ws.stop();
      return ws.start(context);
    });
    this.disposables.push(restartServer);

    this.disposables.push(
      commands.registerCommand('rls.run', (cmd: Execution) => {
        const ws =
          multiProjectEnabled && activeWorkspace ? activeWorkspace : this;
        runRlsCommand(ws.folder, cmd);
      }),
    );
  }

  private async setupProgressCounter() {
    if (!this.lc) {
      return;
    }

    const runningProgress: Set<string> = new Set();
    await this.lc.onReady();
    stopSpinner('RLS');

    this.lc.onNotification(
      new NotificationType<ProgressParams, void>('window/progress'),
      progress => {
        if (progress.done) {
          runningProgress.delete(progress.id);
        } else {
          runningProgress.add(progress.id);
        }
        if (runningProgress.size) {
          let status = '';
          if (typeof progress.percentage === 'number') {
            status = `${Math.round(progress.percentage * 100)}%`;
          } else if (progress.message) {
            status = progress.message;
          } else if (progress.title) {
            status = `[${progress.title.toLowerCase()}]`;
          }
          startSpinner('RLS', status);
        } else {
          stopSpinner('RLS');
        }
      },
    );
  }

  private async makeRlsProcess(): Promise<child_process.ChildProcess> {
    const cwd = this.folder.uri.fsPath;
    const rlsPath = path.join(__dirname,  '../bin/pysearch');
    const python = this.config.pythonPath;
    const config = this.config.rustupConfig();

    let childProcess: child_process.ChildProcess;
    const env = {};
    childProcess = withWsl(config.useWSL).spawn(
      rlsPath, [
        "-p", python,
      ],
      { env, cwd },
    );

    childProcess.on('error', (err: { code?: string; message: string }) => {
      if (err.code === 'ENOENT') {
        console.error(`Could not spawn RLS: ${err.message}`);
        window.showWarningMessage(`Could not spawn RLS: \`${err.message}\``);
      }
    });

    childProcess.on("close", (code, signal) => {
      if (code === 101 && signal == null) {
        console.error("Unable to start a python language server.");
        window.showWarningMessage("Unable to start a python language server.\n\
              Install by running\n\npip install python-language-server",
          );
      } else if (code !== 0 && signal == null) {
        console.error("Unable to start pysearch");
        window.showWarningMessage("Unable to start pysearch");
      }
    });



    if (this.config.logToFile) {
      const logPathErr = path.join(this.folder.uri.fsPath, `stderr.log`);
      const logStreamErr = fs.createWriteStream(logPathErr, { flags: 'w+' });
      if (childProcess && childProcess.stderr) {
            childProcess.stderr.pipe(logStreamErr);
      }

      const logPathOut = path.join(this.folder.uri.fsPath, `stdout.log`);
      const logStreamOut = fs.createWriteStream(logPathOut, { flags: 'w+' });
      if (childProcess && childProcess.stdout) {
            childProcess.stdout.pipe(logStreamOut);
      }
    }
    return childProcess;
  }

  private async autoUpdate() {
    const rlsPath = path.join(__dirname,  '../bin/pysearch');
    const serverInfo = await getServerInfo(rlsPath, "pysearch");
    getServerInfo(rlsPath, "pysearch")
    .then(serverInfo => installServerIfRequired(rlsPath, serverInfo, "pysearch"));
  }
}

let _sortedWorkspaceFolders: string[] | undefined;

function sortedWorkspaceFolders(): string[] {
  // TODO: decouple the global state such that it can be moved to workspace_util
  if (!_sortedWorkspaceFolders && workspace.workspaceFolders) {
    _sortedWorkspaceFolders = workspace.workspaceFolders
      .map(folder => {
        let result = folder.uri.toString();
        if (result.charAt(result.length - 1) !== '/') {
          result = result + '/';
        }
        return result;
      })
      .sort((a, b) => {
        return a.length - b.length;
      });
  }
  return _sortedWorkspaceFolders || [];
}

function getOuterMostWorkspaceFolder(folder: WorkspaceFolder): WorkspaceFolder {
  // TODO: decouple the global state such that it can be moved to workspace_util
  const sorted = sortedWorkspaceFolders();
  for (const element of sorted) {
    let uri = folder.uri.toString();
    if (uri.charAt(uri.length - 1) !== '/') {
      uri = uri + '/';
    }
    if (uri.startsWith(element)) {
      return workspace.getWorkspaceFolder(Uri.parse(element)) || folder;
    }
  }
  return folder;
}
function whenChangingWorkspaceFolders(
  e: WorkspaceFoldersChangeEvent,
  context: ExtensionContext,
) {
  _sortedWorkspaceFolders = undefined;

  // If a VSCode workspace has been added, check to see if it is part of an existing one, and
  // if not, and it is a Rust project (i.e., has a Cargo.toml), then create a new client.
  for (let folder of e.added) {
    folder = getOuterMostWorkspaceFolder(folder);
    if (workspaces.has(folder.uri.toString())) {
      continue;
    }
    for (const f of fs.readdirSync(folder.uri.fsPath)) {
      if (f === 'Cargo.toml') {
        const workspace = new ClientWorkspace(folder);
        workspaces.set(folder.uri.toString(), workspace);
        workspace.start(context);
        break;
      }
    }
  }

  // If a workspace is removed which is a Rust workspace, kill the client.
  for (const folder of e.removed) {
    const ws = workspaces.get(folder.uri.toString());
    if (ws) {
      workspaces.delete(folder.uri.toString());
      ws.stop();
    }
  }
}
