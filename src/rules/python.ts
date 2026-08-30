import type { Rule } from './model.js';

/**
 * Python 规则子集（多语言第一步）。
 * 只在 .py 文件上运行；判定倾向与 JS 规则一致：宁可漏报不可误报。
 * Python 注释以 # 开头，匹配前简易剔除（字符串含 # 时宁可漏报）。
 */

function isPython(file: string): boolean {
  return file.toLowerCase().endsWith('.py');
}

function stripPyComment(line: string): string {
  return line.split('#')[0];
}

function mentionsAny(code: string, context: string[], word: RegExp): boolean {
  return word.test(code) || context.some((l) => word.test(l));
}

/** P1. Python 动态执行：eval / exec / compile */
const PY_DANGEROUS_EVAL: Rule = {
  id: 'py-dangerous-eval',
  severity: 'high',
  message: '使用动态代码执行（eval / exec / compile），注入面直接暴露给不可信输入',
  fixHint: '改用 ast.literal_eval、json.loads 或查表映射等显式解析',
  detect(ctx) {
    if (!isPython(ctx.file)) return false;
    const code = stripPyComment(ctx.content);
    return (
      /(?:^|[^\w.])eval\s*\(/.test(code) ||
      /(?:^|[^\w.])exec\s*\(/.test(code) ||
      /\bcompile\s*\(/.test(code)
    );
  }
};

/** P2. Python 弱哈希（MD5/SHA1）用于密码 */
const PY_WEAK_HASH_PASSWORD: Rule = {
  id: 'py-weak-hash-password',
  severity: 'high',
  message: '对密码相关数据使用 MD5/SHA1，可被高速暴力破解',
  fixHint: '改用 bcrypt / passlib 的 CryptContext（argon2/bcrypt）并加盐',
  detect(ctx) {
    if (!isPython(ctx.file)) return false;
    const code = stripPyComment(ctx.content);
    if (!/\b(?:md5|sha1)\s*\(/i.test(code)) return false;
    return mentionsAny(code, ctx.context, /(password|passwd|pwd|密码)/i);
  }
};

/** P3. Python SQL 字符串拼接（+ / % 元组 / .format / f-string 插值） */
const PY_SQL_CONCAT: Rule = {
  id: 'py-sql-concat',
  severity: 'high',
  message: 'SQL 语句通过字符串拼接引入变量，存在注入风险',
  fixHint: '改用参数化查询（占位符 + 参数元组）或 ORM 的绑定参数',
  detect(ctx) {
    if (!isPython(ctx.file)) return false;
    const code = stripPyComment(ctx.content);
    const sql =
      /(?:\bselect\b.{0,120}?\bfrom\b|\binsert\s+into\b|\bupdate\s+\S+.{0,60}?\bset\b|\bdelete\s+from\b)/i.test(
        code
      );
    if (!sql) return false;
    const fString = /\bf['"]/.test(code) && /\{/.test(code);
    return /\+/.test(code) || /\bformat\s*\(/.test(code) || /%\s*\(/.test(code) || fString;
  }
};

/** P4. Python 硬编码密钥（模块级常量形态） */
const PY_HARDCODED_SECRET: Rule = {
  id: 'py-hardcoded-secret',
  severity: 'high',
  message: '疑似把密钥/口令硬编码进源码，泄露即失控',
  fixHint: '改从环境变量（os.environ）或密钥管理服务读取，并轮换已泄露的旧值',
  detect(ctx) {
    if (!isPython(ctx.file)) return false;
    const code = ctx.content.split('#')[0];
    const m = code.match(
      /^\s*([A-Za-z0-9_]*(?:secret|api_?key|access_?key|private_?key|password|passwd|token)[A-Za-z0-9_]*)\s*=\s*(['"])(.{8,}?)\2\s*$/i
    );
    if (!m) return false;
    if (/(os\.environ|getenv|config\[|config\.)/i.test(code)) return false;
    if (/(your|example|placeholder|xxx|changeme|<[^>]*>)/i.test(m[3])) return false;
    return true;
  }
};

export const PYTHON_RULES: Rule[] = [
  PY_DANGEROUS_EVAL,
  PY_WEAK_HASH_PASSWORD,
  PY_SQL_CONCAT,
  PY_HARDCODED_SECRET
];
