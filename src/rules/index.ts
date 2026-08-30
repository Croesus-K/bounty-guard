import type { Rule, RuleContext } from './model.js';
import { SEED_RULES } from './seeds.js';

export type { Rule, RuleContext } from './model.js';

/** 当前注册的全部规则（数组顺序即运行顺序） */
export const ALL_RULES: Rule[] = SEED_RULES;

/** 对单个新增行运行全部规则，返回命中的规则列表 */
export function runRules(ctx: RuleContext): Rule[] {
  return ALL_RULES.filter((rule) => rule.detect(ctx));
}
