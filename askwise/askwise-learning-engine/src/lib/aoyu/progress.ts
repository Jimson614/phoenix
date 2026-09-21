/**
 * Global growth progress for the Aoyu companion: the share of tasks the student
 * solved with no hint at all, as the integer 0-100 the stage contract requires.
 *
 * Independence is the persisted learning_sessions.independent flag, which
 * closeSession sets when the task closed at hint level 0. It is a real academic
 * fact, never a timer or an estimate.
 */

/**
 * Below this many real tasks the sample cannot name a stage: one task solved
 * unaided would read as 100 and show the student a fully grown Aoyu. Returning
 * null keeps the companion in its UNKNOWN state instead of inventing a stage.
 */
export const MIN_TASKS_FOR_PROGRESS = 5;

export function independentSolveProgress(
  independentCount: number,
  totalTasks: number
): number | null {
  if (!Number.isInteger(independentCount) || !Number.isInteger(totalTasks)) return null;
  if (independentCount < 0 || totalTasks < 0) return null;
  if (independentCount > totalTasks) return null;
  if (totalTasks < MIN_TASKS_FOR_PROGRESS) return null;
  return Math.round((independentCount / totalTasks) * 100);
}
