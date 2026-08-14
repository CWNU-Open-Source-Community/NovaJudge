import { getAwardsPageData } from "./actions";
import AwardsClient from "./AwardsClient";
import { TrophyIcon } from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";

export default async function ContestAwardsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contestId = Number(id);
  const data = await getAwardsPageData(contestId);

  if (data.error || !data.contest) {
    return (
      <div className="max-w-3xl mx-auto mt-16 p-8 bg-white border border-gray-200 rounded-xl text-center">
        <TrophyIcon className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-bold">{data.error || "Not found"}</p>
      </div>
    );
  }

  return (
    <AwardsClient
      contestId={contestId}
      initial={{
        contest: data.contest,
        standings: data.standings || [],
        medal: data.medal || { mode: "ratio", gold: 0, silver: 0, bronze: 0 },
        awards: data.awards || { enabled: false, custom: [] },
        problems: data.problems || [],
        firstSolves: data.firstSolves || [],
      }}
    />
  );
}
