import { notFound } from "next/navigation";
import { getProblemDetail } from "./actions";
import TestInterface from "./client"; // 客户端交互组件
import type { ProblemSample } from "@/lib/problem-samples";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminProblemTestPage({ params }: PageProps) {
  const { id } = await params;
  const problem = await getProblemDetail(Number(id));

  if (!problem) notFound();

  // 类型转换：处理 Prisma JSON
  const formattedProblem = {
    ...problem,
    hint: problem.hint || "",
    sections: problem.sections as unknown as {
      title: string;
      content: string;
    }[],
    samples: problem.samples as unknown as ProblemSample[],
  };

  return <TestInterface problem={formattedProblem} />;
}
