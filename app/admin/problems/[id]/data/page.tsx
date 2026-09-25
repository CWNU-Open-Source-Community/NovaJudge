import { getProblemData } from "./actions";
import DataManagementClient from "./client";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

export default async function ProblemDataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const problemId = Number((await params).id);
  if (!Number.isSafeInteger(problemId) || problemId <= 0) notFound();
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    select: { type: true },
  });
  if (!problem) notFound();
  // 获取初始数据
  const { files, yamlContent } = await getProblemData(problemId);

  return (
    <DataManagementClient
      problemId={problemId}
      problemType={problem.type}
      initialFiles={files}
      initialYaml={yamlContent}
    />
  );
}
