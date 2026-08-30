import { describe, expect, it } from 'vitest';
import { matchGlob } from '../src/glob.js';

describe('matchGlob', () => {
  it('dir/** 匹配目录本身与其下任意深度内容', () => {
    expect(matchGlob('node_modules/a/b.js', ['node_modules/**'])).toBe(true);
    expect(matchGlob('node_modules', ['node_modules/**'])).toBe(true);
  });

  it('dir/** 不匹配其他目录下的同名子目录（整体锚定语义）', () => {
    expect(matchGlob('src/node_modules/x.js', ['node_modules/**'])).toBe(false);
  });

  it('单星号不跨目录段', () => {
    expect(matchGlob('dist/a.js', ['dist/*'])).toBe(true);
    expect(matchGlob('dist/a/b.js', ['dist/*'])).toBe(false);
    expect(matchGlob('app.ts', ['*.ts'])).toBe(true);
    expect(matchGlob('src/app.ts', ['*.ts'])).toBe(false);
  });

  it('**/ 前缀可匹配零层或多层目录', () => {
    expect(matchGlob('a.test.ts', ['**/*.test.ts'])).toBe(true);
    expect(matchGlob('x/y/a.test.ts', ['**/*.test.ts'])).toBe(true);
  });

  it('? 匹配段内单个字符', () => {
    expect(matchGlob('a.js', ['?.js'])).toBe(true);
    expect(matchGlob('ab.js', ['?.js'])).toBe(false);
    expect(matchGlob('x/a.js', ['?/a.js'])).toBe(true);
  });

  it('Windows 反斜杠路径按 / 归一化', () => {
    expect(matchGlob('dist\\a.js', ['dist/*'])).toBe(true);
    expect(matchGlob('node_modules\\a\\b.js', ['node_modules/**'])).toBe(true);
  });

  it('任一模式命中即命中；全不命中为 false', () => {
    expect(matchGlob('docs/a.md', ['src/**', 'docs/**'])).toBe(true);
    expect(matchGlob('other/a.md', ['src/**', 'docs/**'])).toBe(false);
  });
});
