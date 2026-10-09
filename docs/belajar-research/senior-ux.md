# Belajar Al-Qur'an: accessibility audit and spec for older adults (60+)

Audit date: 2026-10-09. Sizes below are estimated from Tailwind v4 defaults: `text-xs` is 12/16px, `text-sm` 14/20px, `text-base` 16/24px, `py-2` is 8px per side. Contrast ratios and CVD distances were computed with the WCAG 2.x relative-luminance formula, Machado-2009 CVD matrices and CIEDE2000. Scripts are in the scratchpad (`contrast.py`, `cvd.py`, `final.py`).

## Six problems that matter most

1. **About 30 secondary texts are 11px, in `ink-faint`.** `ink-faint` is 3.17–3.56:1 on every background the app uses, so it fails WCAG 1.4.3 everywhere. It carries citations, counters, the translation source and the word location. There are 32 `text-[11px]` instances and roughly 25 `text-xs` (12px) uses.
2. **Guided lesson timing is too fast.**
   - `captionMs` (`src/lib/lessonSteps.ts:35-38`) reads at 15 chars/s, which is close to Netflix's *adult TV* subtitle rate (17 cps). Research on older adults suggests ≤14 cps at most.
   - The 12 s cap cuts off long captions. The longest word caption (282 chars) gets 12 s, which is 23.5 cps.
   - The authored structure captions (in the untracked `pipeline/authored/al-fatihah.structure.json`, 236–585 chars) will all hit the cap. Ayah 1 would run at 49 chars/s.
   - The "Dengarkan kata ini: …" caption stays on screen only while the word's audio plays: median 0.95 s with Alafasy, and 17 of 29 words are under 1 s.
   - There is no way to turn auto-advance off, which WCAG 2.2.1 requires.
3. **Two separate players on one page.** `AyahPlayer` and `GuidedLesson` each create their own `useSegmentPlayer`.
   - During the guided lesson the mushaf line never highlights the word being recited.
   - The two can play audio over each other.
   - There are two competing "play" primary actions.
   - Explain steps call `scrollIntoView` on the word card (`GuidedLesson.tsx:92-94`). That card sits far down the page, so the page jumps away and the caption scrolls out of view.
4. **Word cards are overloaded.** Each card shows up to about 17 items: loc code, transliteration, Arabic, gloss, role, case/sign/mahall, root, wazn, "why", sharaf, concepts, kosakata, ikhtilaf, sources and a draft chip. On average a card carries 5.2 citations, about 574 characters of 11px grey text. Across Al-Fatihah's 29 cards that is about 16,600 characters of citation text.
5. **Touch targets are 16–40px.** Primary buttons are about 36–40px. The guided-lesson previous/next buttons are icon-only at 40px. The restart button is icon-only on phones. The speed toggle shows only "1×".
6. **Exercise right/wrong states are colour-only (fails 1.4.1).**
   - "Correct" and "wrong" fills differ by 1.01:1, and either fill differs from white by about 1.1:1.
   - The wrong-answer border is 2.12:1, below 1.4.11's 3:1.
   - The Sortir bins sit disabled at `opacity-70` until a word is selected, so their resting text is 2.76–3.50:1.
   - The score message says "Ulangi kapan saja", but there is no button to repeat an exercise.

---

## 1. Contrast of the current tokens

Backgrounds: paper `#fbfaf6`, paper-deep `#f5f3ec`, white, forest-tint `#eef3ef`. "Guided" is the composite of `forest-tint/40` over paper, `#f6f7f3` (GuidedLesson panel).

| Text token | paper | paper-deep | white | forest-tint | guided | Verdict |
|---|---|---|---|---|---|---|
| ink `#1b1a17` | 16.66 | 15.67 | 17.40 | 15.50 | 16.17 | AAA |
| ink-muted `#5c5a52` | 6.62 | 6.22 | 6.91 | 6.15 | 6.42 | AA only; fails 7:1 everywhere |
| **ink-faint `#8a887e`** | **3.41** | **3.20** | **3.56** | **3.17** | **3.31** | **Fails AA 4.5 everywhere** |
| forest `#0e5a3c` | 7.90 | 7.43 | 8.25 | 7.34 | 7.66 | AAA |
| case-nasb `#9a5b13` (DraftChip text) | 5.18 | 4.87 | 5.41 | 4.82 | 5.03 | AA |
| case-jarr `#1f4e8c` | 7.96 | 7.49 | 8.31 | 7.40 | 7.72 | AAA |
| paper on forest (buttons) | 7.90 (9.87 on forest-hover) | | | | | AAA |

**Case badges.** Text sits on its own `/10` tint. In `CaseBadge` and the Sortir bins the tint is composited over the white card (over paper in brackets).

| Case | Text on own tint | Ring `/30` vs white | Bin text at `opacity-70` (resting state) |
|---|---|---|---|
| raf | 7.01 (6.73) | 1.66 | 3.46 |
| nasb | **4.74 (4.53)**, a 0.03–0.24 margin at 12px | 1.53 | **2.76** |
| jarr | 7.08 (6.80) | 1.66 | 3.50 |
| mabni | 5.97 (5.74) | 1.58 | 3.04 |

WCAG exempts disabled controls from 1.4.3. These bins are still the state the learner has to read before acting.

**Non-text contrast (1.4.11, needs 3:1).**

| Pair | Ratio |
|---|---|
| hairline border vs white / paper / paper-deep (every option button, restart/speed/select, guided prev/next) | **1.27 / 1.22 / 1.15** |
| Selected fill forest-tint vs white | **1.12** |
| Wrong fill paper-deep vs white | **1.11** |
| Correct fill vs wrong fill | **1.01** |
| Wrong border `nasb/50` vs white; dashed draft border | **2.12** |
| Active-word background vs white | **1.12** |
| Active-word text shift, ink to forest | **2.11** |
| Link vs surrounding ink text | **2.11** |
| `decoration-forest/30` underline | **1.66** |
| White button on guided panel | 1.08 |
| Progress fill vs track | 6.48 (OK) |

**CVD distinguishability of the case colours** (CIEDE2000 ΔE between simulated colours; roughly, below 6 is near-identical for small marks and above 12 is reliably distinct side by side).

| | Worst pairs |
|---|---|
| Current | deutan raf–mabni **5.9**, protan raf–mabni **7.5**, tritan raf–jarr **8.2**, protan raf–nasb 14.4 |
| Proposed (§3.3) | tritan raf–jarr 13.8, deutan raf–mabni 14.3, tritan nasb–mabni 15.3, protan raf–nasb 16.0 |

Under current colours, raf (forest) and mabni (grey, identical to `ink-muted`) are effectively the same colour for deuteranopes.

---

## 2. Findings by screen and component

### Global (`globals.css`, `layout.tsx`)
- **No global focus style.** The only explicit focus style is on the AyahPlayer word buttons (`AyahPlayer.tsx:49`); everything else relies on browser defaults (2.4.7).
- **Sticky header with no `scroll-padding-top`.** The header (`layout.tsx:65-66`, fixed `h-14`) can cover focused elements and anchor targets (2.4.11). Only `#practice` has `scroll-mt-20`.
- **No reduced-motion handling anywhere.** `motion-reduce` and `prefers-reduced-motion` appear in no file.
- **`.quran` overrides every line-height utility on Arabic text.** `.quran` (`globals.css:39-43`) is unlayered CSS, and in Tailwind v4 unlayered CSS beats `@layer utilities`. So `leading-*` on any `.quran` element is ignored and line-height is always 2.2: `AyahPlayer.tsx:38` `leading-[2.4]`, `TapWord.tsx:87`, `WordCard.tsx:53/80`, `LabelRole.tsx:67`, `WhyHarakat.tsx:89`. This is harmless today, but Arabic line-height must be set in globals.css, not through utilities.
- **Arabic shown with `font-arabic` (no `.quran`) gets Latin line-heights.** For example `text-lg` gives 28px for 18px vocalised text (WordCard wazn, SharafPanel, ConceptCard examples, StructureSection groups). Stacked harakat (shadda+fatha) get cramped.
- **Header.**
  - The Beta chip is 11px (`layout.tsx:74`).
  - The "Konsep" link is about 20px tall and jargon (`:79`).
  - "Kembali ke Dakwah-Lens" is hidden on phones (`:86`).
  - The footer AI-assisted disclaimer is 14px ink-muted (`:98`). It is a mandatory label and should stay visible and be larger.
  - Footer links are about 20px tall (`:101-105`).
- **AccountChip.** Sign-in is about 28px tall, 12px text (`AccountChip.tsx:49`). The signed-in label is 12px (`:36`).

### Home (`app/[locale]/page.tsx`)
- Eyebrows and section headings are 11px uppercase with 0.18em tracking (`:39`, `:53`, `:91`). This is small, harder to read in capitals, and conflicts in spirit with the NO ALL CAPS rule.
- The primary CTA "Mulai belajar" is about 36px tall (`:72`).
- The status chip is a 12px dashed chip (`:77`). The meta line (`:63`) and principle bodies (`:103`) are 14px muted.

### Surah list (`[surah]/page.tsx`)
- The translation is the key meaning, but it is demoted to 14px ink-muted (`:72`).
- Ayah Arabic is `text-2xl`, only 24px on phones (`:68`).
- The ayah number badge is a fixed `h-7 w-7` with 12px text (`:65`), so it overflows when text grows.
- "Latihan selesai" is 12px (`AyahProgressMark.tsx:13`).
- The translation source is 11px ink-faint at 3.41 (`:86`).
- "Versi data: …" is developer info shown to learners in 12px ink-faint (`:113`).
- Hover translate motion (`:62`, `:79`) is desktop-only, since Tailwind v4 `hover:` applies only on hover-capable devices.
- "Tahukah kamu?" (`messages/id.json:55`, `:67`) is informal "kamu" while the rest of the module uses "Anda".

### Lesson page (`[surah]/[ayah]/page.tsx`)
Current order: breadcrumb → AyahPlayer → GuidedLesson → translation → tafsir → Struktur → Konsep → 29 word cards → 5 stacked exercises → facts → prev/next.
- The **translation is separated from the ayah** by the guided panel (`:138`).
- **Previous/next exists only at the very bottom** (`:274-293`). The previous link is about 20px tall; next is 36px.
- The breadcrumb link is about 20px (`:116`).
- Footnotes are 12px (`:142`); the figcaption (`:147`) and tafsir sources (`:157`) are 11px ink-faint.
- The word grid uses `sm:/lg:` media queries (`:200`). These do not react to a root font-size change, so large text would stay in 2–3 cramped columns.
- `words_intro` says "Ketuk kata pada bacaan di atas", a positional instruction (1.3.3).

### AyahPlayer (`components/lesson/AyahPlayer.tsx`)
- **Tap-to-replay is not discoverable.** The words look like plain text (`:49`); the hover background never shows on phones. The hint sits under the controls in 12px muted (`:111`).
- The active word cue is weak: background 1.12:1, text shift 2.11:1 (`:50`).
- Play is about 36px (`:66`). Restart is icon-only on phones because its label is `hidden sm:inline` (`:78`).
- The speed toggle has a Gauge icon and "1×"/"0.75×" only. It shows the current state, not what it does, and has no label (`:80-92`).
- The reciter `<select>` has only an sr-only label (`:95`).
- The ayah ornament (`:57`) and credit (`:113`) are ink-faint, the credit at 11px.
- Arabic is 1.9rem/2.3rem (30.4/36.8px). This is acceptable; 36px or more is preferred on phones.

### GuidedLesson and lessonSteps
- **Timing.**
  - `captionMs` is 15 cps, min 3 s, max 12 s (`lessonSteps.ts:35-38`).
  - Word-explain captions are 71–282 chars (mean 129). They get a mean 8.1 s; 3 of 29 are capped.
  - Structure captions (once the authored file is built into content) are 236–585 chars, all forced into 12 s, which is 20–49 cps.
  - WCAG 2.2.1's intent text says content "advancing or updating at a rate beyond the user's ability to read… introduces a time limit". Pause exists, but there is no "turn off" option and no ≥10× adjustment.
- **The `recite_word` caption flashes.** It is visible only for the audio segment (`GuidedLesson.tsx:86-88`): median 950 ms with the default Alafasy, as short as 300 ms.
- **Page scroll yank** on explain steps (`:92-94`).
- **Its own player** (`:73`): no highlight on the mushaf line, no speed control, can overlap AyahPlayer audio.
- **Sizes.**
  - The main teaching caption is only 16px (`:174`); the step counter is 12px (`:163`).
  - Previous/next are icon-only 40px SkipBack/SkipForward buttons (`:184`, `:210`). Seniors often misread media skip icons.
  - Primary is about 40px (`:192`, `:200`) and resume about 38px (`:218`). "Ke latihan ↓" is about 20px (`:226`).
  - The captions note is 11px ink-faint and reads as a developer roadmap (`:230`).
- Nothing tells the learner that the lesson will advance by itself.

### WordCard, CaseBadge, DraftChip, SharafPanel
- **WordCard.**
  - Loc "1:1:1" is jargon and 12px ink-faint at 3.56 (`:50`).
  - Transliteration is 14px italic muted (`:51`); italic hurts low-vision reading.
  - The role chip (`:65`) and mahall "(mahall nashb)" (`:72`) are 12px jargon.
  - Root and wazn are 18px vocalised Arabic (`:80`, `:90`).
  - The "why" label is 11px uppercase (`:98`); the why text is 14px (`:101`).
  - Concept chips are about 20px tall (`:113`); the Kosakata link is about 16px (`:119`).
  - The "Pendapat lain" summary is a 20px muted row with only the small default marker (`:128`).
  - Sources are 11px ink-faint (`:142-146`).
- **CaseBadge.** Text is 12px; the shape is a Unicode glyph at 12px, about 8px visible, so ▲ and ▼ can be told apart only by orientation (`CaseBadge.tsx:9-11`). The `none` state is labelled "—" (`cases.ts:44`), which means nothing to a layperson. mabni and majzum use the ink-muted colour (`cases.ts:35`, `:41`).
- **DraftChip.** 11px, dashed border at 2.12:1 (`DraftChip.tsx:5`). It appears on every card and section, 29 or more times per page.
- **SharafPanel.** The summary is 36px muted (`:21`). Labels are 12px (`:27`, `:32`, `:51`, `:55`) and 11px (`:40`, `:45`). Tashrif Arabic is 18px (`:33`); i'lal Arabic is 16px (`:52`, `:54`).

### Exercises
- **ExerciseShell.** The instruction is 14px muted (`:26`). `Feedback` (`:46-48`) shows tone by background only, with no icon.
- **Counters** are 12px ink-faint: `TapWord.tsx:72`, `WhyHarakat.tsx:84`, `LabelRole.tsx:62`, `WaznFactory.tsx:69` (also shows "bab" jargon).
- **LabelRole.** Options are about 38px (`:78`). State is fill/border colour only (`:79-84`).
- **WhyHarakat.** Options are about 45px (`:103`), state colour-only. After a wrong pick the feedback already reveals the correct reason, yet the correct option is not marked, so the learner does not know what to do next.
- **SortCase.**
  - The two-step "tap word, then tap bin" mode is invisible.
  - Bins are disabled at `opacity-70` until a word is selected (`:84-85`). Tapping a bin first does nothing, with no message.
  - Bin and feedback Arabic is 18px (`:90`, `:103`).
- **TapWord.** The Arabic words have no focus style and no affordance. Target and wrong states are background-only at 1.12 and 1.11 (`:97-103`). Play is 36px (`:78`).
- **WaznFactory.** Options are about 42px (`:85`). Root and answer Arabic is 18px (`:74`, `:100`). The note is 11px ink-faint (`:108`).
- "Lanjut"/"Selesai" buttons are about 36px in every exercise.
- After finishing there is **no "Ulangi" button** (score copy at `id.json:107`).
- There are no timers, which is good; keep it that way.

### Library and other pages
- **StructureSection.** Role labels under words are 11px muted (`:37`). The heading is 11px uppercase (`:47`). Group Arabic is 18px (`:53`). Sources are 11px faint (`:68`).
- **ConceptCard.** The chip is 11px (`:39`). Explanation is 14px muted (`:47`). The examples heading is 11px uppercase (`:62`). Example Arabic is 18px (`:77`). "Pelajari konsep ini" is about 20px tall (`:91`). Sources are 11px faint (`:95`).
- **FactCard.** The body is 14px muted (`:20`). Location links are 12px, about 16px tall, comma-separated inline (`:22-36`), so they risk failing 2.5.8's spacing exception when they wrap. Method (`:38`) and sources (`:42`) are 11px faint.
- **konsep.** Headings are 11px uppercase (`konsep/page.tsx:32`). Cards have hover translate (`:40`). Related chips are about 30px (`konsep/[id]/page.tsx:69`).
- **kosakata/[id].** 11–12px ink-faint at `:44`, `:72`, `:91`, `:99`, `:113`. Root Arabic is 18px (`:59`).
- **kredit** (`:35`, `:41`) and **not-found** (`:9`): 11–12px.

### Touch targets (estimated)

| Control | Location | Estimated height |
|---|---|---|
| Header "Konsep", footer links, breadcrumb, previous-ayah link, "Ke latihan", "Pelajari konsep ini" | various | ~20px |
| Concept chips; Kosakata link; FactCard location links | WordCard:113/119; FactCard:27 | 16–20px |
| Sign-in | AccountChip:49 | ~28px |
| Home CTA, AyahPlayer play, exercise Lanjut/Selesai, next-ayah | page:72, AyahPlayer:66, … | ~36px |
| Restart / speed / reciter; LabelRole options; resume | AyahPlayer:75-99; LabelRole:78; Guided:218 | ~38px |
| Guided previous/next (icon-only); Guided primary | Guided:184/210, :192/200 | 40px |
| WaznFactory / WhyHarakat options | | 42–45px |
| Arabic word buttons (AyahPlayer, TapWord, SortCase); Sortir bins | | 63–67px; ≥96px (size OK, affordance poor) |

---

## 3. Spec

### 3.1 Type scale
Body is 18px. NN/g sets a 12pt (16px) minimum for senior-focused sites, so 18px leaves margin for mid-range phones in bright light and for small transliteration marks (ā, ḥ, ’).

Override the Tailwind v4 scale in `@theme` so every existing `text-*` grows at once. Then replace all 32 `text-[10px]`/`text-[11px]` with `text-xs`.

```css
@theme {
  --text-xs: 0.9375rem;  --text-xs--line-height: 1.5;   /* 15px: absolute floor (citations, meta only) */
  --text-sm: 1rem;       --text-sm--line-height: 1.6;   /* 16px: UI labels, chips, counters, instructions */
  --text-base: 1.125rem; --text-base--line-height: 1.7; /* 18px: body, translation, options, "why" */
  --text-lg: 1.25rem;    --text-lg--line-height: 1.55;  /* 20px: gloss, card titles */
  --text-xl: 1.375rem;   --text-xl--line-height: 1.5;   /* 22px: guided caption */
  --text-2xl: 1.625rem;  --text-2xl--line-height: 1.35; /* 26px: H2 */
  --text-3xl: 2rem;      --text-3xl--line-height: 1.25; /* 32px: H1 */
  --text-4xl: 2.5rem;  --text-5xl: 3rem;
  /* Arabic */
  --text-ar-sm: 1.5rem;  /* 24px: floor for ANY vocalised Arabic (inline, chips, tables, roots, wazn) */
  --text-ar-md: 2rem;    /* 32px: exercise words, question words, Sortir chips */
  --text-ar-lg: 2.25rem; /* 36px: word-card headword, ayah on phones */
  --text-ar-xl: 2.75rem; /* 44px: ayah stage ≥640px */
}
```

- **Minimum sizes.** 16px for anything a learner must read or tap. 15px only for citations and metadata, which go behind disclosure (§3.7).
- **Drop the uppercase eyebrows.** Replace `uppercase tracking-[0.18em] text-[11px]` with `text-sm font-semibold` in sentence case.
- **Transliteration** in regular, not italic.
- **Line length.** Body paragraphs `max-w-prose` (about 65ch).
- **Arabic.**
  - Ayah stage: `text-ar-lg` on phones, `sm:text-ar-xl`.
  - Surah list ayat: `text-[1.875rem]` (30px).
  - Word-card headword: `text-ar-lg`.
  - TapWord, SortCase, LabelRole/WhyHarakat question word: `text-ar-md`.
  - Everything else vocalised (feedback, Struktur groups, concept examples, tashrif/i'lal, root, wazn, bins): `text-ar-sm` minimum.
  - Basis: the review in Namoun & Alkhodre (2019) found 14pt the minimum readable Arabic size, 18pt the recommended size, and ≥18pt advised for online Arabic reading (24px), for *unvocalised* text. Harakat are smaller still, so 24px is the floor.
- **Arabic line-height in CSS, not utilities.** Keep `.quran { line-height: 2.2 }`. Add `.arabic-inline { font-family: var(--font-arabic), "Amiri", serif; font-synthesis: none; line-height: 2; }` and use it in place of bare `font-arabic`. Never use `leading-none` on Arabic.

### 3.2 Colour tokens (all ratios computed)

```css
--color-ink:        #1b1a17; /* 15.50–17.40 */
--color-ink-muted:  #4a4840; /* was #5c5a52 → paper 8.77 · paper-deep 8.25 · white 9.16 · forest-tint 8.16 · guided 8.51 (AAA) */
--color-ink-soft:   #5f5d55; /* REPLACES ink-faint for all text → 6.32 · 5.94 · 6.60 · 5.87 · 6.13 (AA, meta only) */
/* delete --color-ink-faint (or keep for purely decorative ornament) so every text use is forced to migrate */
--color-border-ui:  #807e74; /* NEW: borders of interactive controls → 3.90 · 3.67 · 4.07 · 3.63 · 3.79 (≥3:1) */
--color-hairline:   #e7e4da; /* decorative card edges/dividers only */
--color-forest:     #0e5a3c; /* unchanged, 7.34–8.25; paper-on-forest 7.90 */
--color-notice:     #8a4d00; /* draft chip text → 6.40 · 6.02 · 6.68 · 5.95 */
--color-ok-bg:      #e6f0ea; /* "Benar" feedback: forest text 7.08, ink 14.93 */
--color-notice-bg:  #fbefe3; /* "Belum tepat" feedback: ink 15.38, notice text 5.91 (calm amber, not red) */
/* Case: GRAPHIC colours (shape icon + 1.5–2px border); label TEXT is always ink */
--color-case-raf:   #0e5a3c; /* vs white 8.25 */
--color-case-nasb:  #a85f00; /* vs white 4.88 */
--color-case-jarr:  #2563b8; /* vs white 5.91 */
--color-case-mabni: #7a2f5c; /* plum, vs white 8.79 (majzum shares, with ● shape); alt charcoal #2f2d29 gives deutan raf–mabni 11.0 */
```

- **Case chips.**
  - Background: the case colour at 12% over white (`#e2ebe8`, `#f5ece0`, `#e5ecf6`, `#efe6eb`).
  - Label: ink, 13.9–14.9:1.
  - Shape: an inline SVG at `1em` (≥16px) filled with the case colour. Shape vs its tint is 4.17–7.20:1, above 3:1. Order: shape, then label.
  - Border: 1.5px in the case colour.
  - Keep the gesture shapes: ▲ raf, ◆ nasb, ▼ jarr, ■ mabni, ● majzum.
  - `none`: border in `border-ui`, label "tanpa i'rab", wording to be confirmed by the reviewer.
- **Active word** in the mushaf line: forest fill with paper text (7.90:1), replacing tint plus colour shift (1.12 / 2.11).
- **Links in text:** solid 1px forest underline, not `decoration-forest/30` (1.66). Link vs body colour is only 2.11, so the underline has to carry the meaning (1.4.1).
- **Interactive option, select and secondary buttons:** 1.5px `border-ui` border instead of `hairline`.

### 3.3 Targets and spacing
One CSS px is about 1 dp, or 1/160 inch on Android. So 48px is about 7.6 mm and 56px about 8.9 mm. NN/g's 1 cm × 1 cm is about 63px.

- **Primary action, one per screen:** `min-h-14` (56px), `px-6 text-base font-semibold`, `w-full sm:w-auto`.
- **Standard buttons, answer options, segmented controls, disclosure rows:** `min-h-12` (48px).
- **Absolute minimum** for any tappable element, chips and list links included: `min-h-11` (44px, WCAG 2.5.5 AAA). Get it from padding, not from line-height alone.
- **Spacing:** ≥8px (`gap-2`) between adjacent targets, 12px (`gap-3`) in control rows, 16px between previous and next.
- **Icons in buttons:** `h-5 w-5` (20px) to `h-6 w-6`.
- **FactCard locations:** render as a wrapping list of 44px chips, not comma-separated inline links.
- **Fixed heights become min-heights:** header `h-14` → `min-h-14 py-2 flex-wrap`; ayah badge `h-7 w-7` → `min-h-9 min-w-9 px-2`.

### 3.4 Text-size switch ("Ukuran huruf")
- **Where it lives.**
  - In the header, before the account chip: a button with a visible label, "Aa Ukuran huruf" ("Aa Huruf" under 380px), `min-h-11`.
  - Tapping it opens an inline panel under the header: no hover, no modal.
  - The panel is a radio group of three 56px options, each shown in its own size: **Normal · Besar · Sangat besar**, plus "Tutup".
  - The same group is repeated in the lesson's "Pengaturan belajar" panel (§3.5), and as a one-time hint card on Home: "Tulisan kurang jelas? Perbesar di sini."
- **Mechanism.** Set `html[data-text-size]` as a percentage of the browser default, which respects the user's own OS or browser setting:
  - `normal` 100% → body 18px
  - `besar` 112.5% → 20.25px
  - `sangat-besar` 133.33% → 24px

  Everything is rem, so type, Arabic, spacing and targets all scale together. This is why every px text must go.
- **Persistence.** Store in `localStorage` under `belajar:v1:text-size`. To avoid a flash on statically rendered pages, add an inline pre-paint script in `layout.tsx` `<head>`: `try{var s=localStorage.getItem('belajar:v1:text-size');if(s)document.documentElement.dataset.textSize=s}catch(e){}`, and put `suppressHydrationWarning` on `<html>`. The client switch uses `useSyncExternalStore`, as `useProgress` does. Sync to the account later, together with progress.
- **Layout.** Media queries ignore the html font-size (rem in `@media` uses the initial size). Move the card grids to container queries, which follow the root size, so columns collapse as text grows: `<div class="@container"><div class="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">`. Apply this to the word grid (`[ayah]/page.tsx:200`), concepts, facts and konsep.

### 3.5 Guided lesson pacing
- **Setting "Penjelasan berjalan":** **Biasa** (10 cps, default) · **Pelan** (6 cps) · **Tunggu saya** (no auto-advance; a 56px "Lanjut ›" button).
  - Ask once before the first lesson ("Penjelasan berjalan sendiri, atau menunggu Anda?") and keep it in Pengaturan.
  - Persist in `belajar:v1:pace`.
  - "Tunggu saya" is the 2.2.1 "turn off before encountering it" option. Pelan alone (1.7×) would not meet the "≥10×" adjust bullet.
  - Show a static "Berjalan otomatis · Biasa" label. No countdown bar.

```ts
export type Pace = "biasa" | "pelan" | "tunggu";
const CPS = { biasa: 10, pelan: 6 } as const;
export function captionMs(text: string, pace: Exclude<Pace, "tunggu">): number {
  const settle = pace === "pelan" ? 3000 : 2500;       // eyes move from mushaf to caption
  const min = pace === "pelan" ? 6000 : 5000;
  return Math.max(min, settle + (text.length / CPS[pace]) * 1000); // NO upper cap
}
```

  Result for word-explain captions: Biasa mean 15.4 s (max 30.7 s), Pelan mean 24.5 s, against 8.1 s today.
- **Split long captions.** In `buildLessonSteps`, split any caption over 180 chars at sentence boundaries into consecutive explain steps. The ayah-1 structure becomes 5 steps (14/212/171/108/76 chars; the 212-char sentence needs a comma split or an authored shortening).
- **Fix `recite_word`.** Show the word's Arabic (`text-ar-lg`) and transliteration in the stage. Advance only when **both** the audio has finished **and** `captionMs(caption)` has passed. In Pelan, optionally replay the word once after a 1.5 s gap.
- **Remove the page scroll** at `GuidedLesson.tsx:92-94`. Show the word plus its gloss inside the stage instead.
- **Merge AyahPlayer and GuidedLesson into one "stage" with one shared player,** so the mushaf line highlights during guided recitation, audio never overlaps, and imam speed (Biasa 1× / Pelan 0.75×) applies to both.
- **Caption size:** `text-xl` (22px), ink, `min-h` for 4 lines so controls don't jump.
- **Narration audio (ElevenLabs, later):** auto-advance follows the audio end, but "Tunggu saya" must still pause after each step.

### 3.6 Simplification
**Lesson page order (phone):**
1. A 44px "‹ Daftar ayat" button, the title "Al-Fatihah · Ayat 2", and "Ayat 2 dari 7". Add compact previous/next here too.
2. **The stage:**
   - the mushaf line, with words as light chips (paper-deep fill, `border-ui` border) so they look tappable;
   - the line "Ketuk satu kata untuk mendengarnya" above it, 16px, with a speaker icon;
   - the **translation directly under the ayah**, 18px ink;
   - **one primary button "▶ Mulai pelajaran"** (56px, full width);
   - a secondary row with labelled buttons: "Dengar ayat", "Ulang", "Kecepatan: Biasa/Pelan", and the reciter select with a visible label "Suara imam";
   - once started, the caption and labelled step controls: "‹ Sebelumnya", "Jeda", "Berikutnya ›".
3. **Kata demi kata:** simplified cards, one column on phones.
4. **Latihan:** step-through, "Latihan 1 dari 5".
5. **Pelajari lebih dalam,** collapsed, each a 48px disclosure row: Susunan kalimat (Struktur), Konsep baru, Catatan tafsir, Tahukah Anda?
6. **Bottom navigation:** "‹ Ayat 1" and "Ayat 3 ›", both 56px with labels.

**Word card, default (collapsed):**
- A row with "Kata ke-1" and a labelled 44px "▶ Dengar" button
- Arabic `text-ar-lg`
- Transliteration, 16px regular
- Meaning, 20px ink
- "Akhiran:" with the case chip (label, shape and sign), then the why sentence under the heading **"Kenapa akhirnya dibaca {sign}?"**, 18px ink
- The draft marker (15px, readable)
- A full-width 48px button **"Lihat detail kata ini ▾"** (`aria-expanded`), which shows **"Rujukan (6)"** in its label so sources are one tap away

**Word card, expanded:** Peran dalam kalimat · Akar kata + Wazan (pola kata), Arabic at `text-ar-sm` · Kedudukan (mahall, explained) · Konsep (44px chip links) · Sharaf (nested) · Pendapat ulama lain (n) · Rujukan, the full list, each item linked, 15px ink-soft.

**Disclosures.** Every `<details>` summary becomes a 48px row with a chevron icon (rotated, motion-safe) and verb-first text: "Lihat pendapat ulama lain (2)", "Lihat asal-usul bentuk kata (sharaf)".

**Remove from learner view:** "Versi data" (`[surah]/page.tsx:113`) moves to Kredit. Loc codes "1:1:1" become "Kata ke-1". The captions note becomes "Penjelasan tampil sebagai tulisan. Ayat selalu dibacakan oleh imam."

### 3.7 Exercises
- **Options:** text options `min-h-12`, Arabic options `min-h-14` with `text-ar-md`; full width on phones; `gap-3`; `border-ui` border.
- **State is never colour-only.**
  - Chosen correct: 2px forest border, a ✓ icon, and the text "Jawaban benar".
  - Chosen wrong: 2px `#a85f00` border, a ↺ icon, and "Pilihan Anda".
  - After a wrong pick, don't reveal the rule yet: show "Belum tepat — coba pilih yang lain."
  - After 2 misses, offer "Tunjukkan jawaban", which marks the correct option ✓ and shows the rule.
- **Feedback box:** icon + bold first line ("Benar." / "Belum tepat.") + the rule; `ok-bg` / `notice-bg`; `role="status"`.
- **SortCase.**
  - Visible step label: "1. Pilih satu kata → 2. Pilih kelompoknya".
  - Bins stay enabled (no `opacity-70`). Tapping one with nothing selected shows "Pilih satu kata dulu".
  - Bins get a 2px case-colour border, an ink label with the shape icon, and their contents at `text-ar-sm`.
  - The selected word gets a 3px forest border and a "Terpilih" caption.
- **TapWord:** words as chips like the stage. After an answer, the target gets forest fill and paper text with ✓ "Ini yang dibacakan"; a wrong pick gets the `#a85f00` border with "Pilihan Anda".
- **Counters:** "Soal 2 dari 4", 16px ink-muted.
- **Add "Ulangi latihan"** (48px) to the finished state.
- **Keep:** no timers, hearts or sound effects.

### 3.8 Motion and focus (append to globals.css, unlayered on purpose)

```css
html { scroll-padding-top: 5rem; }                       /* 2.4.11: sticky header never hides focus/anchors */
:where(a, button, summary, select, input, [tabindex]):focus-visible {
  outline: 3px solid var(--color-forest); outline-offset: 3px; /* forest vs paper 7.90 / tint 7.34 (2.4.7, 2.4.13) */
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

- In JS, any remaining `scrollIntoView` uses `behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`.
- Replace `hover:-translate-y-0.5` and `group-hover:translate-x-0.5` (`[surah]/page.tsx:62`, `:79`; `konsep/page.tsx:40`) with `hover:border-forest`.

### 3.9 Plain-language strings (`messages/id.json`)
Keep the da'wah terms, but explain them in place with a visible parenthetical. Avoid tooltips, which are hover-only.

| Key | Now | Proposed |
|---|---|---|
| App.nav_concepts | Konsep | Konsep tata bahasa |
| App.beta | Beta | Uji coba |
| Concept.nahwu / sharaf | Nahwu / Sharaf | Nahwu (susunan kalimat) / Sharaf (perubahan bentuk kata) |
| (first i'rab mention) | i'rab | i'rab (perubahan akhir kata karena kedudukannya) |
| Surah/Lesson.facts_heading | Tahukah kamu? | Tahukah Anda? |
| Guided.title | Mode pelajaran | Pelajaran dipandu |
| Guided.start | Mulai | Mulai pelajaran |
| Guided.prev / next (now aria only) | — | visible "Sebelumnya" / "Berikutnya" |
| Guided.captions_note | …suara penjelasan menyusul… | Penjelasan tampil sebagai tulisan. Ayat selalu dibacakan oleh imam. |
| Player speed (now "1×") | 1× / 0.75× | Kecepatan imam: Biasa / Pelan |
| Player.reciter (sr-only) | Qari | visible "Suara imam (qari)" |
| Player.hint_tap | Ketuk sebuah kata… Pilih bacaan Al-Husary (Mu'allim). | "Ketuk satu kata untuk mendengarnya lagi." plus, under the reciter select: "Al-Husary (Mu'allim) memberi jeda untuk menirukan." |
| Lesson.words_intro | …bacaan di atas… | Ketuk kata pada bacaan ayat untuk mendengarnya lagi. |
| Lesson.structure_heading | Struktur ayat | Susunan kalimat ayat (tarkib) |
| Word.why | Kenapa dibaca begitu? | Kenapa akhirnya dibaca {sign}? |
| Word.other_views | Pendapat lain | Pendapat ulama lain |
| Word.wazn | Wazan | Wazan (pola kata) |
| Word.role | Peran | Peran dalam kalimat |
| Word.lemma | Kosakata → | Lihat kata dasarnya |
| mahall text | (mahall nashb) | kedudukannya nashab, meski bentuk akhirnya tetap |
| Exercise.not_yet | Belum tepat. | Belum tepat — coba pilih yang lain. |
| Exercise.sort_title | Sortir akhiran | Kelompokkan menurut akhiran |
| Exercise.role_title | Label peran | Tebak peran kata |
| Exercise.wazn_title | Pabrik wazan | Bentuk-bentuk kata (wazan) |
| Case `none` | — | tanpa i'rab |

Grammar glosses such as the mahall wording and the `none` label should go through the ustadz reviewer, like other content.

---

## 4. Priorities

**P0, do now (small, mechanical, highest impact):**
1. Apply the §3.1 `@theme` type scale, replace the 32 `text-[10px]`/`[11px]`, and raise all vocalised Arabic to at least 24px.
2. Replace `ink-faint` text with `ink-soft`, and darken `ink-muted` to `#4a4840`.
3. Guided pacing:
   - new `captionMs` with no cap, and the Biasa/Pelan/**Tunggu saya** setting (2.2.1);
   - the `recite_word` hold;
   - remove the `scrollIntoView` yank;
   - caption at 22px.
4. Targets: primary 56px, all controls ≥44px. Visible text labels on the guided previous/next, mobile restart, speed toggle and reciter select.
5. Exercise state shown with icon + text + 3:1 borders (1.4.1/1.4.11). Sortir bins always enabled with a hint. Add "Ulangi latihan".
6. Global `:focus-visible`, `scroll-padding-top`, and the reduced-motion block.
7. Word card: move sources, ikhtilaf, sharaf, concepts, role/root/wazn behind one "Lihat detail kata ini · Rujukan (n)" disclosure.

**P1:**
- The text-size switch (§3.4) with container-query grids.
- Merge AyahPlayer and GuidedLesson into one stage with a shared player and highlight.
- The lesson-page reorder with top navigation.
- Case colour redesign with SVG shapes.
- The `border-ui` token on controls; active word as forest fill.
- Plain-language copy and the "Anda" register.
- Remove developer info (Versi data, loc codes).
- Disclosure rows; FactCard location chips.

**P2:**
- Exercises shown one at a time.
- "Lanjutkan: Al-Fatihah ayat 3" on Home.
- Account sync of preferences.
- An optional "Kontras tinggi" mode (ink on white, darker borders).
- Evaluate the "Amiri Quran" face for ayah text, for harakat placement.
- Do **not** colour individual harakat: it splits shaping runs.
- Test with 5 seniors on a mid-range Android outdoors.

## 5. Constraints to flag before implementing
- **Citations (AGENTS.md: "Link back to the source passage in the UI").** Collapsing sources behind "Lihat detail · Rujukan (n)" keeps them one tap away, but it lowers their prominence. **Operator sign-off needed.**
- **Draft markers (plan §8: a visible marker on every unreviewed record).** I kept a per-card draft marker, made readable. Consolidating into one page banner would also need sign-off.
- **AI-assisted label.** The "AI-assisted, not authoritative fatwa" disclaimer stays visible; the spec only raises its size and contrast.
- **Cost:** none (no LLM or API use in any of this).

Sources:
- [W3C WAI: Older Users and Web Accessibility](https://www.w3.org/WAI/older-users/)
- [W3C WAI: Developing Websites for Older People](https://www.w3.org/WAI/older-users/developing/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- WCAG 2.2 Understanding: [1.4.3 Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) (4.5:1 tied to ~20/40 acuity "typical… of elders at roughly age 80"; no rounding), [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), [2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html), [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- NN/g: [Nielsen 2013, Usability for Senior Citizens](https://www.nngroup.com/articles/usability-seniors-improvements/) (43% slower; 55.3% vs 74.5% success; ≥12pt; seniors blamed themselves 90% of the time); [Kane 2019, Usability for Older Adults](https://www.nngroup.com/articles/usability-for-senior-citizens/); [Harley 2019, Touch Target Size](https://www.nngroup.com/articles/touch-target-size/) (1 cm × 1 cm); [Nielsen 2002, Let Users Control Font Size](https://www.nngroup.com/articles/let-users-control-font-size/) (an on-page size control is warranted for senior-targeted sites; use relative units)
- Arabic legibility: [Namoun & Alkhodre 2019, IJACSA 10(4)](https://arxiv.org/pdf/2011.02933) (review: 14pt minimum readable, 18pt recommended, ≥18pt advised for online Arabic); [W3C Arabic & Persian Layout Requirements](https://www.w3.org/TR/alreq/) (Arabic ascenders and descenders extend much further than Latin)
- Reading rate: [Skorupska et al. 2018](https://arxiv.org/pdf/1810.00267) ("required reading speed ought to be in the low range (14 ch/s at most)… or adjustable" for older adults); [Netflix Indonesian Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/216009727-Indonesian-Timed-Text-Style-Guide) (adult 17 cps, children 13 cps)