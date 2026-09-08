import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { ValueProps } from "./ValueProps";
import { CTABand } from "./CTABand";
import { Footer } from "./Footer";

// generic/public-landing-page.md — shown at "/" for anonymous visitors
// (see app/page.tsx). TopNav is rendered separately, by TopBar.tsx's
// isAnonymousLanding branch, since TopBar is mounted once in the root
// layout above every page — this component owns everything below it.
// No data fetching: every value on this page is static.
export function LandingPage() {
  return (
    <div style={{ background: "var(--paper)", minHeight: "calc(100vh - 68px)" }}>
      <main className="landing-content animate-fade-in-up">
        <Hero />
        <HowItWorks />
        <ValueProps />
      </main>
      <CTABand />
      <Footer />
    </div>
  );
}
