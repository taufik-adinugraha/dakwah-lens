/**
 * Admin-action audit log writer.
 *
 * Every admin server action under /admin/* calls this once after its
 * effect is persisted. Best-effort: failures are logged to console but
 * never bubble up — losing an audit row is preferable to bouncing the
 * user's action with a misleading error.
 *
 * Action namespace conventions (dot-notation, kept stable so the audit
 * page can filter by exact match):
 *   user.approve / user.reject / user.block / user.reinstate /
 *     user.remove / user.role_change
 *   cost.add / cost.delete
 *   donation.add / donation.delete
 *   rss.add / rss.delete / rss.toggle_enabled / rss.toggle_fetch_body
 *   ingest_query.add / ingest_query.delete / ingest_query.toggle
 *   contact.status_change / contact.delete
 *   fx_rate.update
 *   followup.email_blast / followup.banner_post / followup.dismiss
 *
 * `payload` should carry any pre-fetched display string (target email,
 * vendor name, "from → to" values for changes) so the audit page can
 * render the row without joining back to long-since-deleted targets.
 */

import { db, schema } from "@/db";

export type AdminLogInput = {
  /** Caller's user id. Pulled from the requireAdmin / requireSuperadmin
   *  return value at the action level. */
  actorId: string;
  /** Dot-notation, e.g. `user.approve`. See the namespace conventions
   *  in the file docstring. */
  action: string;
  /** Type of the affected row: `user` / `manual_cost` / `donation` /
   *  `rss_feed` / `ingest_query` / `contact_message` / `setting` /
   *  `admin_followup`. Free text — kept short so the audit filter
   *  stays readable. */
  targetType?: string;
  /** Row id (UUID for most tables, free text for settings — e.g.
   *  `usd_to_idr`). */
  targetId?: string;
  /** Free-form context. JSON serialized as-is into the `payload`
   *  jsonb column. Include enough info that the audit page can render
   *  without joining back to the source table. */
  payload?: Record<string, unknown>;
};

export async function logAdminAction(input: AdminLogInput): Promise<void> {
  try {
    await db.insert(schema.adminLogs).values({
      actorUserId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
    });
  } catch (err) {
    // Never bounce the calling action because of a logging failure.
    console.warn("[admin-log] insert failed:", input.action, err);
  }
}
