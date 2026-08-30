import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff.js';

/** 多 hunk 修改场景 */
const MODIFY_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,3 +10,3 @@ function render() {',
  '   const a = 1;',
  '-  const b = 2;',
  '+  const b = 20;',
  '   return a + b;',
  '@@ -40,2 +40,3 @@ function other() {',
  '   const x = 1;',
  '+  const y = 2;',
  '   const z = 3;'
].join('\n');

describe('parseDiff', () => {
  it('解析修改文件的路径与两个 hunk', () => {
    const parsed = parseDiff(MODIFY_DIFF);
    expect(parsed.files).toHaveLength(1);
    const file = parsed.files[0];
    expect(file.path).toBe('src/app.ts');
    expect(file.oldPath).toBe('src/app.ts');
    expect(file.isBinary).toBe(false);
    expect(file.hunks).toHaveLength(2);
  });

  it('第一个 hunk 的行号与内容正确', () => {
    const hunk = parseDiff(MODIFY_DIFF).files[0].hunks[0];
    expect(hunk.oldStart).toBe(10);
    expect(hunk.newStart).toBe(10);
    expect(hunk.lines).toHaveLength(4);
    expect(hunk.lines[0]).toMatchObject({ type: 'context', content: '  const a = 1;', newLine: 10, oldLine: 10 });
    expect(hunk.lines[1]).toMatchObject({ type: 'del', content: '  const b = 2;', oldLine: 11 });
    expect(hunk.lines[1].newLine).toBeUndefined();
    expect(hunk.lines[2]).toMatchObject({ type: 'add', content: '  const b = 20;', newLine: 11 });
    expect(hunk.lines[2].oldLine).toBeUndefined();
  });

  it('第二个 hunk 的 add 行号按新起点累计', () => {
    const hunk = parseDiff(MODIFY_DIFF).files[0].hunks[1];
    expect(hunk.newStart).toBe(40);
    const add = hunk.lines.find((l) => l.type === 'add');
    expect(add?.newLine).toBe(41);
    expect(add?.content).toBe('  const y = 2;');
  });

  it('新增文件：oldPath 为空，全部为 add 行', () => {
    const text = [
      'diff --git a/new.js b/new.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.js',
      '@@ -0,0 +1,2 @@',
      '+const a = 1;',
      '+const b = 2;'
    ].join('\n');
    const file = parseDiff(text).files[0];
    expect(file.path).toBe('new.js');
    expect(file.oldPath).toBeUndefined();
    expect(file.hunks[0].oldLines).toBe(0);
    expect(file.hunks[0].lines.map((l) => l.type)).toEqual(['add', 'add']);
    expect(file.hunks[0].lines[1].newLine).toBe(2);
  });

  it('删除文件：path 取旧路径，全部为 del 行', () => {
    const text = [
      'diff --git a/old.js b/old.js',
      'deleted file mode 100644',
      '--- a/old.js',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-const a = 1;',
      '-const b = 2;'
    ].join('\n');
    const file = parseDiff(text).files[0];
    expect(file.path).toBe('old.js');
    expect(file.hunks[0].lines.map((l) => l.type)).toEqual(['del', 'del']);
    expect(file.hunks[0].lines[1].oldLine).toBe(2);
  });

  it('重命名文件：oldPath 与 path 分别取 from/to', () => {
    const text = [
      'diff --git a/before.js b/after.js',
      'similarity index 100%',
      'rename from before.js',
      'rename to after.js'
    ].join('\n');
    const file = parseDiff(text).files[0];
    expect(file.oldPath).toBe('before.js');
    expect(file.path).toBe('after.js');
    expect(file.hunks).toHaveLength(0);
  });

  it('二进制文件标记 isBinary 且无 hunk', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ'
    ].join('\n');
    const file = parseDiff(text).files[0];
    expect(file.isBinary).toBe(true);
    expect(file.hunks).toHaveLength(0);
  });

  it('GIT binary patch 同样标记为二进制', () => {
    const text = ['diff --git a/logo.png b/logo.png', 'GIT binary patch'].join('\n');
    expect(parseDiff(text).files[0].isBinary).toBe(true);
  });

  it('无换行符标记被忽略且不占行号', () => {
    const text = [
      'diff --git a/nl.js b/nl.js',
      '--- a/nl.js',
      '+++ b/nl.js',
      '@@ -1,1 +1,3 @@',
      ' const a = 1;',
      '+const b = 2;',
      '\\ No newline at end of file',
      '+const c = 3;'
    ].join('\n');
    const hunk = parseDiff(text).files[0].hunks[0];
    expect(hunk.lines).toHaveLength(3);
    const adds = hunk.lines.filter((l) => l.type === 'add');
    expect(adds.map((l) => l.newLine)).toEqual([2, 3]);
  });

  it('文件名含空格（git 引号形式）正确解析', () => {
    const text = [
      'diff --git "a/my file.txt" "b/my file.txt"',
      'index 1111111..2222222 100644',
      '--- "a/my file.txt"',
      '+++ "b/my file.txt"',
      '@@ -1 +1 @@',
      '-hello',
      '+world'
    ].join('\n');
    const file = parseDiff(text).files[0];
    expect(file.path).toBe('my file.txt');
    expect(file.hunks[0].lines[1]).toMatchObject({ type: 'add', content: 'world', newLine: 1 });
  });

  it('hunk 正文内以三个连字符开头的内容行不会被误认成文件头', () => {
    const text = [
      'diff --git a/list.md b/list.md',
      '--- a/list.md',
      '+++ b/list.md',
      '@@ -1,2 +1,2 @@',
      ' intro',
      '--- item two',
      '+-- item two (done)'
    ].join('\n');
    const parsed = parseDiff(text);
    expect(parsed.files).toHaveLength(1);
    const lines = parsed.files[0].hunks[0].lines;
    expect(lines[1]).toMatchObject({ type: 'del', content: '-- item two', oldLine: 2 });
    expect(lines[2]).toMatchObject({ type: 'add', content: '-- item two (done)', newLine: 2 });
  });

  it('行数缺省为 1 的短 hunk 头（@@ -3 +3 @@）', () => {
    const text = [
      'diff --git a/solo.js b/solo.js',
      '--- a/solo.js',
      '+++ b/solo.js',
      '@@ -3 +3 @@',
      '-old',
      '+new'
    ].join('\n');
    const hunk = parseDiff(text).files[0].hunks[0];
    expect(hunk.oldStart).toBe(3);
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newStart).toBe(3);
    expect(hunk.newLines).toBe(1);
  });

  it('空文本产出空结果；CRLF 行尾不影响解析', () => {
    expect(parseDiff('').files).toHaveLength(0);
    const crlf = parseDiff(MODIFY_DIFF.replace(/\n/g, '\r\n'));
    expect(crlf.files[0].hunks).toHaveLength(2);
    expect(crlf.files[0].hunks[0].lines[2].content).toBe('  const b = 20;');
  });
});
