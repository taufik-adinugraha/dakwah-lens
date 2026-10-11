import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { OG_SIZE } from "@/lib/share";

import type { CardText } from "./text";

/**
 * Draws a share card (Open Graph / Twitter image, 1200×630 PNG) for the hub, the Qur'an track
 * and every lesson: the Dakwah-Lens logo and wordmark, the card's words (lib/og/text.ts — Latin
 * only: satori cannot shape Arabic) and the module's address. Colours are the module's tokens
 * (globals.css): paper, ink, forest, with the forest-tint wash of the pages' glow.
 *
 * Fonts are files in the repo, assets/og/ (Inter Regular, Fraunces Medium: the site's body and
 * display faces, static instances as Google Fonts serves them, SIL OFL 1.1, licence beside
 * them). With its own fonts, satori never fetches one: next/og's default face has no ḥ ṣ ṭ ḍ,
 * and a missing glyph makes it download a fallback from Google at render time.
 *
 * Read from process.cwd(), the app root both in `next build` (where every card is drawn: the
 * og routes are force-static, dynamicParams false) and in the standalone server (the Dockerfile
 * copies assets/ next to public/, in case a card is ever drawn at request time).
 */
const PAPER = "#fbfaf6";
const INK = "#1b1a17";
const INK_MUTED = "#4a4840";
const INK_SOFT = "#5f5d55";
const FOREST = "#0e5a3c";
const FOREST_TINT = "#eef3ef";

type Assets = { inter: Buffer; fraunces: Buffer; logo: string };
let assets: Promise<Assets> | null = null;

function loadAssets(): Promise<Assets> {
  assets ??= (async () => {
    const root = process.cwd();
    const [inter, fraunces, logo] = await Promise.all([
      readFile(join(root, "assets/og/Inter-Regular.ttf")),
      readFile(join(root, "assets/og/Fraunces-Medium.ttf")),
      readFile(join(root, "public/dakwah-lens-logo-short-removebg.png")),
    ]);
    return { inter, fraunces, logo: `data:image/png;base64,${logo.toString("base64")}` };
  })();
  return assets;
}

export async function cardResponse(card: CardText): Promise<ImageResponse> {
  const { inter, fraunces, logo } = await loadAssets();
  // Long lines step down a size so the longest ayah (Al-Fatihah 7) still fits the card.
  const translitSize = (card.translit?.length ?? 0) > 48 ? 30 : 36;
  const bodySize = card.body.length > 110 ? 28 : 32;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "52px 72px 40px",
          backgroundColor: PAPER,
          backgroundImage: `linear-gradient(135deg, ${FOREST_TINT} 0%, ${PAPER} 62%)`,
          borderBottom: `14px solid ${FOREST}`,
          color: INK,
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori draws a plain <img>, not next/image */}
          <img src={logo} width={92} height={91} alt="" />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 22 }}>
            <div style={{ fontFamily: "Fraunces", fontSize: 38, lineHeight: 1.1, color: FOREST }}>Dakwah-Lens</div>
            <div style={{ fontSize: 26, lineHeight: 1.3, marginTop: 4, color: INK_MUTED }}>{card.eyebrow}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ fontFamily: "Fraunces", fontSize: 66, lineHeight: 1.12 }}>{card.title}</div>
          {card.translit ? (
            <div style={{ fontSize: translitSize, lineHeight: 1.3, marginTop: 18, color: FOREST }}>{card.translit}</div>
          ) : null}
          <div style={{ fontSize: bodySize, lineHeight: 1.4, marginTop: 18, color: card.translit ? INK : INK_MUTED }}>
            {card.body}
          </div>
          {card.source ? (
            <div style={{ fontSize: 20, lineHeight: 1.3, marginTop: 10, color: INK_SOFT }}>{card.source}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: INK_SOFT }}>
          <div>{card.disclaimer}</div>
          <div>dakwah-lens.id/belajar</div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: inter, weight: 400, style: "normal" },
        { name: "Fraunces", data: fraunces, weight: 500, style: "normal" },
      ],
      headers: { "cache-control": "public, max-age=86400" },
    },
  );
}
