/**
 * JudgeEvaluation — result returned by a Judge.
 *
 * When `evaluated` is false the judge did not run (stub / skipped).
 * When `evaluated` is true the remaining fields carry the verdict.
 */
export interface JudgeEvaluation {
  /** Whether the judge actually ran an evaluation. False for stubs. */
  evaluated: boolean;
  /** Numeric quality score produced by the judge. Present when evaluated = true. */
  score?: number;
  /** Free-form reasoning trace from the judge. Present when evaluated = true. */
  reasoning?: string;
  /** Short actionable feedback. Present when evaluated = true. */
  feedback?: string;
}

/**
 * Judge interface — LLM-backed qualitative evaluation.
 *
 * A Judge complements deterministic Scorers with subjective quality signals
 * (e.g. coherence, factual accuracy, tone). Judges are async because they
 * typically call an LLM. Implementations live in future tasks (T8+).
 *
 * @template TInput  - Type of scenario input fed to the judge
 * @template TOutput - Type of scenario output the judge evaluates
 */
export interface Judge<TInput, TOutput> {
  /** Unique name identifying this judge. */
  readonly name: string;
  /**
   * Run the evaluation.
   * Stubs return `{ evaluated: false }` immediately.
   * Real implementations call an LLM and await the response.
   */
  evaluate(input: TInput, output: TOutput): Promise<JudgeEvaluation>;
}

/**
 * No-op Judge stub.
 *
 * Returns `{ evaluated: false }` without calling any LLM.
 * Use this as a placeholder until real judge logic is wired in T8+.
 *
 * @example
 * const judge = createNoOpJudge("quality-judge");
 * const result = await judge.evaluate(input, output);
 * // result === { evaluated: false }
 */
export function createNoOpJudge<TInput, TOutput>(name = "no-op-judge"): Judge<TInput, TOutput> {
  return {
    name,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    evaluate: async (_input: TInput, _output: TOutput): Promise<JudgeEvaluation> => ({
      evaluated: false,
    }),
  };
}

/**
 * Singleton no-op judge typed as `Judge<unknown, unknown>` for use in
 * test harnesses that don't need typed generics.
 */
export const noOpJudge: Judge<unknown, unknown> = createNoOpJudge("no-op-judge");
