/**
 * bounty-guard VS Code 扩展：调用本地 CLI（--format json），
 * 把扫描发现映射为编辑器诊断（Diagnostics API），保存时自动刷新。
 */
const vscode = require('vscode');
const { execFile } = require('node:child_process');

let diagnostics;

function config() {
  return vscode.workspace.getConfiguration('bounty-guard');
}

/** 把 CLI 的 JSON 报告映射为诊断列表 */
function toDiagnostics(workspaceRoot, data) {
  const byUri = new Map();
  for (const finding of data.findings ?? []) {
    const severity =
      finding.severity === 'high'
        ? vscode.DiagnosticSeverity.Error
        : finding.severity === 'medium'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;
    const line = Math.max(0, (finding.line ?? 1) - 1);
    const range = new vscode.Range(line, 0, line, 500);
    const message = finding.fixHint
      ? `[${finding.ruleId}] ${finding.message}（${finding.fixHint}）`
      : `[${finding.ruleId}] ${finding.message}`;
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'bounty-guard';
    const uri = vscode.Uri.joinPath(workspaceRoot.uri, finding.file);
    const entry = byUri.get(uri.toString());
    if (entry) entry.diags.push(diagnostic);
    else byUri.set(uri.toString(), { uri, diags: [diagnostic] });
  }
  return [...byUri.values()].map((entry) => [entry.uri, entry.diags]);
}

function run() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showInformationMessage('bounty-guard：请先打开一个工作区文件夹');
    return;
  }
  const root = folders[0];
  const cli = config().get('cliPath', 'bounty-guard');
  const failOn = config().get('failOn', 'info');
  execFile(
    cli,
    ['scan', '--git', '--format', 'json', '--fail-on', failOn],
    { cwd: root.uri.fsPath, maxBuffer: 16 * 1024 * 1024 },
    (err, stdout) => {
      diagnostics.clear();
      // 门禁语义：有发现时退出码为 1，stdout 仍是完整 JSON——两者都可用
      if (!stdout.trim()) {
        if (err) vscode.window.showWarningMessage(`bounty-guard：${err.message}`);
        return;
      }
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        vscode.window.showWarningMessage('bounty-guard：CLI 输出无法解析（请确认 cliPath 配置）');
        return;
      }
      const byUri = toDiagnostics(root, data);
      for (const [uri, list] of byUri) diagnostics.set(uri, list);
      const count = (data.findings ?? []).length;
      vscode.window.showInformationMessage(
        count === 0 ? 'bounty-guard：未发现安全问题' : `bounty-guard：发现 ${count} 个问题`
      );
    }
  );
}

function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection('bounty-guard');
  context.subscriptions.push(
    vscode.commands.registerCommand('bounty-guard.scan', run),
    diagnostics,
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (config().get('scanOnSave', true)) run();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
