import { prisma } from "./lib/prisma";
import { judgeQueue } from "./lib/queue"; // 确保这一行指向你定义 queue 的文件
import { Verdict } from "@/lib/generated/prisma/enums";

// --- 配置区域 ---
const PROBLEM_ID = 1; // ⚠️ 请确保你的数据库里有 ID 为 1 的题目，且有测试数据！
const TOTAL_REQUESTS = 20; // 模拟并发提交的数量
const BATCH_SIZE = 10; // 每批次并发数 (防止把自己电脑打死)

// 模拟一段正确的 Python 代码 (A + B)
const MOCK_CODE = `
import java.util.*;
public class Main{
public static void main(String args[]){
Scanner cin = new Scanner(System.in);
int a, b;
a = cin.nextInt(); b = cin.nextInt();
System.out.println(a + b);
}
}
`;


async function main() {
  console.log(
    `🚀 开始压力测试: 目标题目 ID=${PROBLEM_ID}, 总请求数=${TOTAL_REQUESTS}`
  );

  // 1. 检查题目是否存在
  const problem = await prisma.problem.findUnique({
    where: { id: PROBLEM_ID },
  });
  if (!problem) {
    console.error(
      `❌ 错误: 数据库中找不到 ID 为 ${PROBLEM_ID} 的题目。请修改代码中的 PROBLEM_ID。`
    );
    return;
  }

  // 2. 检查是否有用户 (我们需要挂在一个用户或管理员名下，这里假设用第一个找到的 Admin)
  let user = await prisma.globalUser.findFirst();
  if (!user) {
    console.log("⚠️ 未找到全局管理员，尝试查找普通用户...");
    const normalUser = await prisma.user.findFirst();
    if (!normalUser) {
      console.error("❌ 错误: 数据库没有任何用户，无法创建提交。");
      return;
    }
    // 临时 mock 一个 ID
    user = { id: normalUser.id } as any;
  }

  console.log(`👤 使用用户 ID: ${user?.id} 进行提交`);

  const startTime = Date.now();
  let completed = 0;

  // 3. 批量循环提交
  for (let i = 0; i < TOTAL_REQUESTS; i += BATCH_SIZE) {
    const batchPromises = [];
    const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_REQUESTS - i);

    console.log(`📦 正在推送第 ${i + 1} - ${i + currentBatchSize} 个任务...`);

    for (let j = 0; j < currentBatchSize; j++) {
      batchPromises.push(
        (async () => {
          // A. 写入数据库 (模拟 Pending 状态)
          const submission = await prisma.submission.create({
            data: {
              problemId: PROBLEM_ID,
              globalUserId: user?.id, // 或者 userId: ...
              language: "java",
              code: MOCK_CODE,
              codeLength: MOCK_CODE.length,
              verdict: Verdict.PENDING,
              displayId: -1,
            },
          });

          // B. 推送任务到 Redis 队列
          await judgeQueue.add("judge", {
            submissionId: submission.id,
          });

          return submission.id;
        })()
      );
    }

    await Promise.all(batchPromises);
    completed += currentBatchSize;
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n✅ 压测请求发送完毕!`);
  console.log(`📊 耗时: ${duration.toFixed(2)}s`);
  console.log(`⚡ 平均吞吐: ${(TOTAL_REQUESTS / duration).toFixed(2)} req/s`);
  console.log(`\n👉 现在请观察 worker.ts 的控制台输出，看它处理的速度！`);

  // 关闭连接
  await judgeQueue.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
