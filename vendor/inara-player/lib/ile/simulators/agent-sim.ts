// Copied from inara-next lib/ile/simulators/agent-sim.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the branching agent simulator decision game.
 */

export type AgentAction = {
  id: string;
  code: string;
  label: string;
  correct: boolean;
  /** Shown + logged when this action is the right pick. */
  result: string;
  /** Shown + logged when this action is wrong. */
  consequence: string;
};

export type AgentStep = {
  id: string;
  think: string;
  /** Observation from the previous correct action (omit on step 1). */
  observation?: string;
  actions: AgentAction[];
};

export type LogEntry =
  | { kind: "goal"; text: string }
  | { kind: "think"; text: string }
  | { kind: "act"; text: string }
  | { kind: "observe"; text: string }
  | { kind: "warn"; text: string };

export function correctAction(step: AgentStep): AgentAction | undefined {
  return step.actions.find((a) => a.correct);
}

export function actionById(step: AgentStep, actionId: string): AgentAction | undefined {
  return step.actions.find((a) => a.id === actionId);
}

/** First-try score: count of steps where the first pick was correct. */
export function firstTryScore(firstPickCorrect: readonly boolean[]): number {
  return firstPickCorrect.filter(Boolean).length;
}

export function isAgentComplete(stepIndex: number, stepCount: number): boolean {
  return stepCount > 0 && stepIndex >= stepCount;
}

/** Build the initial log with the goal. */
export function initialLog(goal: string): LogEntry[] {
  return [{ kind: "goal", text: goal }];
}
