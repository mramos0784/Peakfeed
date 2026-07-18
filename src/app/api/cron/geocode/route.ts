import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimNextJobs, completeJob, failJob } from "@/lib/jobs";
import { geocode } from "@/lib/nominatim";

// Vercel Cron hits this on the schedule in vercel.json (once daily on the
// Hobby plan - sub-daily schedules fail to deploy there entirely, confirmed
// before building this). Verifying CRON_SECRET stops anyone else from
// triggering it, which matters here specifically because a public,
// unauthenticated trigger could be hit repeatedly to exhaust Nominatim's
// budget or hammer the database with claim attempts.
export const maxDuration = 300; // Hobby's max, also its default

// Nominatim's own policy: "scripts run at regular intervals are restricted
// to 4 requests per minute" - a stricter, different number than the 1/sec
// absolute ceiling, and the one that actually applies to a cron job. 16s
// keeps a safety margin above the strict 15s/request minimum. Only paced
// around real requests (geocode()'s fromCache flag) - a cache hit costs
// Nominatim nothing, pacing around it would just waste the daily budget
// for no reason.
const PACE_MS = 16_000;

// 300s / 16s per real request leaves room for actual processing overhead
// (DB round trips, JSON parsing) beyond just the sleep - 15 is a
// conservative fit, not a hard derivation.
const BATCH_SIZE = 15;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const jobs = await claimNextJobs(supabaseAdmin, "geocode", BATCH_SIZE);

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const query = (job.payload as { query?: string }).query;
    if (!query || !job.entry_id) {
      await failJob(supabaseAdmin, job, "Missing query or entry_id in job payload");
      failed++;
      continue;
    }

    try {
      const { result, fromCache } = await geocode(supabaseAdmin, query);
      if (!fromCache) await sleep(PACE_MS);

      if (!result) {
        // Nominatim answered, found nothing - a confirmed negative, not a
        // transient error. Treat as a real, final failure (drives toward
        // permanent "failed" via max_attempts) rather than retrying the
        // exact same unfindable query indefinitely.
        await failJob(supabaseAdmin, job, "Nominatim found no match");
        failed++;
        continue;
      }

      await supabaseAdmin
        .from("entries")
        .update({ latitude: result.latitude, longitude: result.longitude })
        .eq("id", job.entry_id);
      await completeJob(supabaseAdmin, job.id, result);
      succeeded++;
    } catch (err) {
      // Network/HTTP-level failure - genuinely transient, worth retrying
      // with backoff rather than treating as a confirmed negative.
      await failJob(supabaseAdmin, job, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return NextResponse.json({ claimed: jobs.length, succeeded, failed });
}
