import { cookies } from "next/headers";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { PageHeader } from "@/components/ui/page-header";
import { parseAppearance } from "@/lib/appearance/cookie";
import { APPEARANCE_COOKIE } from "@/lib/appearance/schemes";

export const metadata = { title: "Settings" };

// Open to every signed-in role. The choice belongs to the person and lives in a cookie in their browser, so this page reads no tenant.
// It passes the saved choice to the form so the server-rendered selection is already the right one.
export default async function SettingsPage() {
  const jar = await cookies();
  const initial = parseAppearance(jar.get(APPEARANCE_COOKIE)?.value);
  return (
    <section>
      <PageHeader title="Appearance" description="Choose how Oasis Pace looks for you. It only changes your own view; everyone else keeps theirs." />
      <AppearanceForm initial={initial} />
    </section>
  );
}
