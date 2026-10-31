import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Audiences } from "@/components/landing/audiences";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingNav } from "@/components/landing/landing-nav";

export const metadata: Metadata = {
  title: "Oasis Pace",
  description: "Ask questions about a Shopify store's sales, orders, stock and customers, and get answers where every figure is matched to a query result.",
};

// The public front door. A signed-in visitor goes straight to the overview.
export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/overview");

  return (
    <>
      <LandingNav />
      <main>
        <LandingHero />
        <HowItWorks />
        <Audiences />
      </main>
      <LandingFooter />
    </>
  );
}
