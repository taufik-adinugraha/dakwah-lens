/**
 * The learning path's data, SERVER ONLY: the list's files as src/lib/kosakata-path-data.ts wants them.
 */
import "server-only";

import { kosakataAyah, kosakataIndex, kosakataPath, kosakataWord } from "./kosakata";
import type { PathSource } from "./kosakata-path-data";

export function pathSource(): PathSource {
  return {
    index: kosakataIndex(),
    path: kosakataPath(),
    word: kosakataWord,
    ayah: (loc) => {
      const a = kosakataAyah(loc);
      return a && { ar: a.ar, text: a.translation.text, footnotes: a.translation.footnotes, surah: a.name, ayah: a.ayah };
    },
  };
}
