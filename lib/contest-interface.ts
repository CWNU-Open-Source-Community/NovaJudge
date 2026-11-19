import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";

export const contestInterfaceCookie = "novajudge-contest-ui";

export const getTeamInterface = cache(async () => {
  // getCurrentUser verifies the contest account and gives a valid global session precedence.
  const team = await getCurrentUser();
  if (team?.role !== "TEAM" || !team.contestId) return null;
  const domjudge = (await cookies()).get(contestInterfaceCookie)?.value === "domjudge";
  return { contestId: team.contestId, userId: team.userId, domjudge };
});

export async function usesDomjudge(contestId: number) {
  const team = await getTeamInterface();
  return team?.contestId === contestId && team.domjudge;
}
