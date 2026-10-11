/**
 * Autoplay lesson engine — public API. Pure (no React, no Next), see
 * types.ts for the step-id contract and machine.ts for the runtime rules.
 *
 * Typical use (lesson page → client runner):
 *   const quiz = quizAyah(slug, a.ayah);   // content/quiz (src/lib/quiz-content.ts)
 *   const seq = buildAutoplaySequence({ slug, surahName, ayahCount, ayah: a,
 *     introduced: conceptsIntroducedIn(a.loc), exercises: availableExercises(quiz),
 *     questions: questionNumbers(quiz), texts: ID_TEXTS, narration, shared });
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
export * from "./narration";
export * from "./texts";
export * from "./sequence";
export * from "./machine";
export * from "./persist";
