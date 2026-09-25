import ProblemEditor from "@/components/admin/ProblemEditor";
import { getProblem } from "../actions";
// 1. 引入 getAssets
import { getAssets } from "./assets/actions";
import { notFound } from "next/navigation";
import AssetManager from "@/components/admin/AssetManager";
import type { ProblemSample } from "@/lib/problem-samples";

export default async function EditProblemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const problemId = Number((await params).id);

  // 核心修改：并行获取题目详情和附件列表
  const [problem, assets] = await Promise.all([
    getProblem(problemId),
    getAssets(problemId),
  ]);

  if (!problem) {
    notFound();
  }

  // 核心修改：在传递给组件之前进行数据转换和类型断言
  const formattedProblem = {
    ...problem,
    // 1. 将 Prisma 的 JsonValue 强转为你需要的具体数组类型
    sections: problem.sections as unknown as {
      title: string;
      content: string;
    }[],
    samples: problem.samples as unknown as ProblemSample[],

    // 2. 处理 hint 的 null vs undefined 问题
    // 数据库出来的可能是 null，组件要的是 undefined
    hint: problem.hint ?? undefined,

    // 3. 处理 judgeConfig (如果需要)
    judgeConfig: problem.judgeConfig as unknown as string | undefined,
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2">
        <ProblemEditor initialData={formattedProblem} isEdit={true} />
      </div>

      <div className="xl:col-span-1">
        <AssetManager problemId={problemId} initialAssets={assets} />
      </div>
    </div>
  );
}
