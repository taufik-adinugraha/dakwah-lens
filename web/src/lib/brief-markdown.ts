/**
 * Convert a stored brief (`briefs.content`) into a downloadable Markdown
 * blob. Used by the public brief page's download button.
 *
 * Kept locale-agnostic — the section headings are passed in by the caller
 * so the same util serves both EN and ID exports without duplicate code.
 */

import type { BriefContent } from "@/db/schema";

export type MarkdownHeadings = {
  topic: string;
  segment: string;
  tone: string;
  locale: string;
  situation: string;
  issue: string;
  audience: string;
  audiencePrimary: string;
  audiencePerception: string;
  audienceAngle: string;
  daleel: string;
  recommendations: string;
  khutbah: string;
  social: string;
  disclaimer: string;
  generatedAt: string;
};

export function briefToMarkdown(
  brief: {
    topicTitle: string;
    segment: string;
    tone: string;
    locale: string;
    content: BriefContent;
    createdAt: Date | string;
  },
  segLabel: string,
  toneLabel: string,
  headings: MarkdownHeadings,
): string {
  const c = brief.content;
  const lines: string[] = [];

  lines.push(`# ${brief.topicTitle}`);
  lines.push("");
  lines.push(
    `**${headings.segment}:** ${segLabel} · **${headings.tone}:** ${toneLabel} · **${headings.locale}:** ${brief.locale.toUpperCase()}`,
  );
  lines.push("");

  lines.push(`## ${headings.situation}`);
  lines.push(c.situation_summary ?? "");
  lines.push("");

  lines.push(`## ${headings.issue}`);
  lines.push(c.issue_analysis ?? "");
  lines.push("");

  lines.push(`## ${headings.audience}`);
  if (c.audience_segmentation) {
    lines.push(`**${headings.audiencePrimary}:** ${c.audience_segmentation.primary ?? "—"}`);
    lines.push("");
    lines.push(`**${headings.audiencePerception}:**`);
    lines.push(c.audience_segmentation.perception ?? "—");
    lines.push("");
    lines.push(`**${headings.audienceAngle}:**`);
    lines.push(c.audience_segmentation.angle ?? "—");
  }
  lines.push("");

  if (c.daleel?.length) {
    lines.push(`## ${headings.daleel}`);
    c.daleel.forEach((d, i) => {
      lines.push(`### ${i + 1}. ${d.source}`);
      lines.push("");
      lines.push("> " + d.arabic);
      lines.push("");
      lines.push(d.translation);
      lines.push("");
    });
  }

  if (c.recommendations?.length) {
    lines.push(`## ${headings.recommendations}`);
    c.recommendations.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
    lines.push("");
  }

  if (c.content_templates) {
    lines.push(`## ${headings.khutbah}`);
    lines.push(c.content_templates.khutbah_outline ?? "");
    lines.push("");
    lines.push(`## ${headings.social}`);
    lines.push(c.content_templates.social_caption ?? "");
    lines.push("");
  }

  lines.push("---");
  lines.push(`*${headings.disclaimer}*`);
  lines.push("");
  const date =
    typeof brief.createdAt === "string"
      ? new Date(brief.createdAt)
      : brief.createdAt;
  lines.push(`*${headings.generatedAt}: ${date.toISOString().slice(0, 10)}*`);

  return lines.join("\n");
}

/** Sluggify a topic title to something safe for a filename. */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
