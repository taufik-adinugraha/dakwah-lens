/**
 * The weekly videos shown on /media/video, newest first. Each is a YouTube
 * upload on the Dakwah-Lens channel, embedded with the privacy-enhanced
 * player (youtube-nocookie.com, allowed by frame-src in next.config.ts).
 *
 * Adding a video: put its YouTube id (the part after /shorts/ or ?v=) at
 * the top, with the title and the short description from its
 * metadata.md (~/Documents/SuksesBerkah/dakwah-lens-videos/), then deploy.
 * The videos are in Indonesian, so the title and blurb are not translated.
 */
export type MediaVideo = {
  /** YouTube video id, 11 characters. */
  youtubeId: string;
  title: string;
  /** One or two sentences: what the video explains. */
  blurb: string;
  /** Monday of the week the video is about, YYYY-MM-DD. */
  week: string;
  /** Vertical (Shorts, 9:16) or wide (16:9). */
  shape: "vertical" | "wide";
};

export const MEDIA_VIDEOS: MediaVideo[] = [];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The list with malformed ids dropped, so a typo can never embed a broken frame. */
export function mediaVideos(): MediaVideo[] {
  return MEDIA_VIDEOS.filter((v) => YOUTUBE_ID.test(v.youtubeId));
}
