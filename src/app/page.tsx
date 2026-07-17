import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WaitlistForm from "@/components/WaitlistForm";

const STEPS = [
  "Collect the best of what the internet has to offer.",
  "Rank what you collect.",
  "Submit your votes.",
  "Share and explore other lists, or create lists of your own.",
];

// Logged-in users land in the app exactly as before (redirect to /lists).
// Logged-out visitors get the waitlist homepage instead of a redirect to
// /login — see docs/adr/0002-waitlist-homepage.md for why this route
// carries both jobs.
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/lists");

  return (
    <div className="wl-page">
      <header className="wl-hero">
        <Link href="/login" className="wl-login-link">Log in</Link>
        <div className="wl-logo">PEAKFEED</div>
        <p className="wl-tagline">The people decide what peaks.</p>
      </header>

      <section className="wl-steps">
        {STEPS.map((step, i) => (
          <div key={step} className="wl-step">
            <span className="wl-step-num">{i + 1}</span>
            <p className="wl-step-text">{step}</p>
          </div>
        ))}
      </section>

      <p className="wl-oneliner">
        Rank the best of what you find: songs, restaurants, venues, events, and issues that matter.
      </p>

      <section className="wl-proto-section">
        <div className="wl-proto-frame">
          <iframe
            src="/reference/peakfeed_v2.html"
            title="PeakFeed interactive prototype"
            loading="lazy"
          />
        </div>
      </section>

      <section className="wl-form-section">
        <h2 className="wl-form-title">Get early access</h2>
        <WaitlistForm />
      </section>
    </div>
  );
}
