/**
 * Autoplay lesson engine — public API. Pure (no React, no Next), see
 * types.ts for the step-id contract and machine.ts for the runtime rules.
 *
 * Typical use (lesson page → client runner):
 *   const quiz = quizAyah(slug, a.ayah);   // content/quiz (src/lib/quiz-content.ts)
 *   const seq = buildAutoplaySequence({ slug, surahName, ayahCount, ayah: a,
 *     introduced: taughtAt(a), exercises: availableExercises(quiz),   // src/lib/curriculum.ts
 *     questions: questionNumbers(quiz), texts: ID_TEXTS, narration, shared,
 *     // the example beats (plan L20): lessonExamples({ ayah: a, introduced, compose, clips, wordAt })
 *     examples });
 *   // client:
 *   const [state, dispatch] = useReducer((s, e) => reduceAutoplay(seq, s, e), seq,
 *     (q) => createAutoplayState(q, { pace }));
 *   // execute state.activity (one at a time), answer with its token;
 *   // send idle_tick while wantsIdleTicks(state); render viewAutoplay(seq, state).
 */
export * from "./types";
export * from "./ids";
export * from "./timing";
export * from "./exercises";
export * from "./examples";
export * from "./curriculum";
export * from "./lessonMap";
export * from "./reminder";
export * from "./zero";
export * from "./narration";
export * from "./texts";
export * from "./sequence";
export * from "./machine";
export * from "./persist";
export * from "./loading";
export * from "./warm";
export * from "./wake";
export * from "./lookahead";
export * from "./prefetch";
export * from "./ahead";
export * from "./voice";
