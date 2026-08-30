/**
 * 共享类型定义：告警（Finding）、LLM 审查请求与结果、Provider 接口。
 * 设计约束：LLM 只负责「复核与解释」已有告警，永远不凭空发明发现——
 * 每个 Finding 必须落到真实代码行上并有规则命中佐证（防幻觉根基）。
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

/** 严重度排序：info < low < medium < high（门禁判定与降级约束的统一基准） */
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };

export interface Finding {
  ruleId: string;
  severity: Severity;
  file: string;
  line: number;
  snippet: string;
  message: string;
  fixHint?: string;
  /** 命中行周边的 add/context 行文本（供 LLM 复核理解语境） */
  contextLines?: string[];
  /** Week 2 起 LLM 复核结果挂载点，纯规则模式不填——LLM 只复核已有告警、不发明发现 */
  review?: LLMReviewResult;
}

export interface LLMReviewRequest {
  ruleId: string;
  severity: Severity;
  snippet: string;
  language: string;
  /** 命中行周边上下文行，辅助 LLM 判断 */
  context?: string[];
}

export type LLMVerdict = 'confirmed' | 'false-positive' | 'unsure';

export interface LLMReviewResult {
  verdict: LLMVerdict;
  /** LLM 可建议修正严重度（只能下调或维持，不允许凭空升级） */
  severity?: Severity;
  explanation: string;
  fixSuggestion?: string;
}

export interface LLMProvider {
  readonly name: string;
  review(request: LLMReviewRequest): Promise<LLMReviewResult>;
}
