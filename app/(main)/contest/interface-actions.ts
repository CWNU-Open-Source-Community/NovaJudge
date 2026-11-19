"use server";

import { cookies } from "next/headers";
import { contestInterfaceCookie, getTeamInterface } from "@/lib/contest-interface";

export async function setContestInterface(mode: "domjudge" | "novajudge") {
  if ((mode !== "domjudge" && mode !== "novajudge") || !(await getTeamInterface())) return;
  (await cookies()).set(contestInterfaceCookie, mode, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
    httpOnly: true,
  });
}
