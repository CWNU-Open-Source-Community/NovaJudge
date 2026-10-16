import { getCurrentSuper } from "@/lib/auth";

// Server actions can be invoked independently of their admin page or layout.
export async function requireSuperAdmin() {
  const user = await getCurrentSuper();
  if (!user?.isGlobalAdmin) {
    throw new Error("Unauthorized");
  }
  return user;
}
