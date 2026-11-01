import { SignIn } from "@clerk/nextjs";

// The layout above centres this and adds the brand. Clerk's own shadow and outer border are dropped so the form sits flat on the page.
export default function SignInPage() {
  return (
    <SignIn
      fallbackRedirectUrl="/overview"
      appearance={{
        variables: { borderRadius: "10px" },
        elements: { rootBox: "w-full", cardBox: "w-full rounded-2xl border border-line shadow-none" },
      }}
    />
  );
}
