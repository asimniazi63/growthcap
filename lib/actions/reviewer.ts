// The reviewer demo logins (a GC partner for both brands and a client viewer) approve writes as a dry run: the card shows the
// exact change and the ledger records it, but the store is never touched. They are the Clerk user ids in REVIEWER_USER_IDS
// (comma-separated, set by Asim once the reviewer accounts exist). With the variable empty, nobody is a reviewer.
type Env = Record<string, string | undefined>;

export function isReviewer(userId: string, env: Env = process.env): boolean {
  return (env.REVIEWER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}
