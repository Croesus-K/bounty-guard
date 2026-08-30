import type { Severity } from '../types.js';

/**
 * 规则判定上下文：只暴露「单行 + 周边窗口」，规则不做跨文件分析——
 * 这既控制成本，也逼着规则把误报率压在行级判断里。
 */
export interface RuleContext {
  /** 新文件路径（已按 ignore 过滤） */
  file: string;
  /** 新文件中的行号 */
  line: number;
  /** 命中行原文（不含换行符） */
  content: string;
  /** hunk 内命中行前后各至多 3 行的 add/context 行文本（不含命中行自身） */
  context: string[];
}

/** 规则模型：每条规则必须自带中文描述与修复建议 */
export interface Rule {
  id: string;
  severity: Severity;
  message: string;
  fixHint: string;
  /** 返回 true 表示命中；只在新增行上被调用 */
  detect(ctx: RuleContext): boolean;
}
