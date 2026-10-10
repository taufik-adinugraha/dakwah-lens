import { connection } from "next/server";

/**
 * BELAJAR_WARIS — the Ilmu Waris (Faraidh) track is hidden on the live site for now (operator,
 * 2026-10-10: "let's hide warisan at the moment"; docs/belajar-plan.md L12). Its code, content
 * and CI checks stay; only what visitors can reach changes:
 *   - src/proxy.ts answers every /{locale}/waris… URL with the module's own 404, so nothing of
 *     the track renders (not its pages, not their titles);
 *   - the hub lists no Ilmu Waris card.
 *
 * `BELAJAR_WARIS=on` shows it again, with no rebuild: unlike BELAJAR_PUBLIC (lib/flags.ts) it is
 * read per request. On the VM, add the line to /srv/dakwah-lens/belajar.env (deploys keep it;
 * deploy.sh rewrites that file only when it must recreate the database credential, and the track
 * is then hidden again) and recreate the container so it reads the file again:
 *   flock -w 1800 /srv/dakwah-lens/.deploy.lock \
 *     docker compose -f /srv/dakwah-lens/belajar/current/docker-compose.yml up -d --force-recreate
 * (a plain `docker restart` keeps the old environment). Any other value, or none (the production
 * default), hides it. CI runs the waris smoke, screenshot and end-to-end checks on a container
 * started with the switch on, and checks that the default container hides the track.
 */
export function warisSwitchOn(): boolean {
  return process.env.BELAJAR_WARIS === "on";
}

/**
 * The switch, for a page: waits for the request first (connection()), so the page renders at
 * request time and never bakes the build machine's value into a prerendered page.
 */
export async function warisVisible(): Promise<boolean> {
  await connection();
  return warisSwitchOn();
}
