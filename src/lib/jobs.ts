import type { SupabaseClient } from "@supabase/supabase-js";

// Generic background job queue - not geocoding-specific. job_type is what
// makes it reusable: the async Wikidata enrichment job
// api-integrations-addendum.md describes (never built - see the status
// report) is the same shape of problem and can reuse this table with
// job_type = "wikidata_enrich" instead of a second one-off queue later.
export type JobType = "geocode";

export type ClaimedJob = {
  id: string;
  entry_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

// Called with the requesting user's own (RLS-scoped) client, not the admin
// client - entries get created inside a normal user request, and the RLS
// policy on `jobs` allows any signed-in user to insert. Failures are logged,
// never thrown: a failed enqueue means an entry never gets a map pin, not
// that entry creation itself should fail. "Never block on geocoding" extends
// to "never let the queueing step block or fail the save." Both failure
// shapes are checked - the Supabase client resolves (doesn't throw) on a
// query-level failure like an RLS rejection, it only throws on something
// like a dropped connection, so the try/catch alone would miss the former.
export async function enqueueJob(
  supabase: SupabaseClient,
  params: { jobType: JobType; entryId: string; payload: Record<string, unknown> }
): Promise<void> {
  try {
    const { error } = await supabase.from("jobs").insert({
      job_type: params.jobType,
      entry_id: params.entryId,
      payload: params.payload,
    });
    if (error) console.error("enqueueJob failed", error);
  } catch (err) {
    console.error("enqueueJob failed", err);
  }
}

// Atomic claim, one row at a time: each UPDATE re-checks status = 'pending'
// at the moment it runs, so if two workers somehow raced on the same row,
// only one UPDATE actually matches and returns a row - the other affects
// zero rows and is silently skipped. This is what makes a separate global
// lock unnecessary, not just careful sequencing.
export async function claimNextJobs(
  supabaseAdmin: SupabaseClient,
  jobType: JobType,
  limit: number
): Promise<ClaimedJob[]> {
  const { data: candidates } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("job_type", jobType)
    .eq("status", "pending")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  const claimed: ClaimedJob[] = [];
  for (const c of candidates ?? []) {
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id, entry_id, payload, attempts, max_attempts")
      .maybeSingle();
    if (job) claimed.push(job as ClaimedJob);
  }
  return claimed;
}

export async function completeJob(
  supabaseAdmin: SupabaseClient,
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  await supabaseAdmin
    .from("jobs")
    .update({ status: "done", result, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

// Exponential backoff, capped at an hour - mostly theoretical on the
// current once-daily Hobby cron schedule (the next attempt is a day away
// regardless), but correct and ready if this ever moves to a more frequent
// Pro-plan schedule. Permanently fails (status = 'failed', never retried
// again) once max_attempts is reached - the entry's coordinate just stays
// null forever at that point, per the "no coarser fallback" requirement.
export async function failJob(
  supabaseAdmin: SupabaseClient,
  job: ClaimedJob,
  error: string
): Promise<void> {
  const attempts = job.attempts + 1;
  const permanent = attempts >= job.max_attempts;
  const backoffMinutes = Math.min(60, 2 ** attempts);
  await supabaseAdmin
    .from("jobs")
    .update({
      status: permanent ? "failed" : "pending",
      attempts,
      last_error: error,
      next_run_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
