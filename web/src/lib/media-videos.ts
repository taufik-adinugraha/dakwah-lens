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

export const MEDIA_VIDEOS: MediaVideo[] = [
  {
    youtubeId: "3Eu5n4gqGEM",
    title: "Kenapa Banjir Datang di Akhir Tahun?",
    blurb:
      "Banjir sudah datang, padahal puncak musim hujan secara umum baru Desember sampai Februari. Kenapa hujan datang di akhir tahun, kenapa arus yang tampak tenang bisa menyeret kita, dan doa Rasulullah ﷺ saat hujan membawa bahaya.",
    week: "2026-11-23",
    shape: "vertical",
  },
  {
    youtubeId: "HFwVVbLqPY8",
    title: "Kenapa Badak Jawa Mau Dipindah?",
    blurb:
      "Badak Jawa tinggal kurang dari seratus ekor, semuanya di Ujung Kulon. Kenapa ada wacana memindahkan sebagian, kenapa banyak yang menolak, dan pesan Islam tentang menjaga satwa.",
    week: "2026-11-23",
    shape: "vertical",
  },
];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The list with malformed ids dropped, so a typo can never embed a broken frame. */
export function mediaVideos(): MediaVideo[] {
  return MEDIA_VIDEOS.filter((v) => YOUTUBE_ID.test(v.youtubeId));
}
