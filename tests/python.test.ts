import { describe, expect, it } from 'vitest';
import { ALL_RULES } from '../src/rules/index.js';
import { PYTHON_RULES } from '../src/rules/python.js';
import type { Rule, RuleContext } from '../src/rules/model.js';

function ctx(content: string, context: string[] = [], file = 'src/script.py'): RuleContext {
  return { file, line: 1, content, context };
}

function ruleById(id: string): Rule {
  const rule = ALL_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`缺少规则 ${id}`);
  return rule;
}

/** 该规则对给定 Python 行（与上下文、文件）是否命中 */
const hits = (id: string, content: string, context: string[] = [], file = 'src/script.py') =>
  ruleById(id).detect(ctx(content, context, file));

describe('Python 规则注册', () => {
  it('Python 子集 4 条已注册，总规则数 14', () => {
    expect(PYTHON_RULES).toHaveLength(4);
    expect(ALL_RULES).toHaveLength(14);
  });

  it('Python 规则只在 .py 文件上激活', () => {
    expect(hits('py-dangerous-eval', 'eval(user_input)', [], 'src/app.js')).toBe(false);
    expect(hits('py-dangerous-eval', 'eval(user_input)', [], 'src/app.py')).toBe(true);
  });
});

describe('py-dangerous-eval', () => {
  it('eval / exec / compile 均命中，属性方法与注释不命中', () => {
    expect(hits('py-dangerous-eval', 'result = eval(user_input)')).toBe(true);
    expect(hits('py-dangerous-eval', 'exec(setup_code)')).toBe(true);
    expect(hits('py-dangerous-eval', 'code = compile(source, "f", "exec")')).toBe(true);
    expect(hits('py-dangerous-eval', 'df.query("age > 18")')).toBe(false);
    expect(hits('py-dangerous-eval', 'value = ast.literal_eval(raw)')).toBe(false);
    expect(hits('py-dangerous-eval', '# 老写法：eval(user_input) 已下线')).toBe(false);
  });
});

describe('py-weak-hash-password', () => {
  it('密码语境下的 MD5/SHA1 命中（含上下文窗口）', () => {
    expect(hits('py-weak-hash-password', 'digest = md5(password.encode())')).toBe(true);
    expect(hits('py-weak-hash-password', 'token = sha1(raw)', ['# 校验用户密码'])).toBe(true);
  });

  it('非密码语境不命中', () => {
    expect(hits('py-weak-hash-password', 'etag = md5(payload)')).toBe(false);
  });
});

describe('py-sql-concat', () => {
  it('SQL 拼接（+ / % 元组 / .format / f-string）命中', () => {
    expect(hits('py-sql-concat', 'sql = "SELECT * FROM users WHERE id = " + user_id')).toBe(true);
    expect(hits('py-sql-concat', 'cursor.execute("DELETE FROM logs WHERE id = %s" % (log_id,))')).toBe(true);
    expect(hits('py-sql-concat', 'sql = "UPDATE users SET name = {}".format(name)')).toBe(true);
    expect(hits('py-sql-concat', 'query = f"SELECT * FROM users WHERE name = {name}"')).toBe(true);
  });

  it('参数化查询、静态 SQL、普通加法不命中', () => {
    expect(hits('py-sql-concat', 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))')).toBe(false);
    expect(hits('py-sql-concat', 'cursor.execute("SELECT * FROM users")')).toBe(false);
    expect(hits('py-sql-concat', 'total = price + tax')).toBe(false);
  });
});

describe('py-hardcoded-secret', () => {
  it('密钥形状常量赋长字符串字面量时命中', () => {
    expect(hits('py-hardcoded-secret', 'API_KEY = "sk-live-abcdef123456"')).toBe(true);
    expect(hits('py-hardcoded-secret', "DB_PASSWORD = 'hunter2hunter2'")).toBe(true);
  });

  it('取自环境、占位符、非字面量不命中', () => {
    expect(hits('py-hardcoded-secret', 'API_KEY = os.environ["API_KEY"]')).toBe(false);
    expect(hits('py-hardcoded-secret', 'API_KEY = getenv("API_KEY")')).toBe(false);
    expect(hits('py-hardcoded-secret', 'SECRET_TOKEN = "your-secret-here"')).toBe(false);
    expect(hits('py-hardcoded-secret', 'PASSWORD = load_password()')).toBe(false);
  });
});
