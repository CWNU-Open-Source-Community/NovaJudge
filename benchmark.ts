import { prisma } from "./lib/prisma";
import { closeJudgeQueue, judgeQueue } from "./lib/queue"; // 确保这一行指向你定义 queue 的文件
import { Verdict } from "@/lib/generated/prisma/enums";

// --- 配置区域 ---
const PROBLEM_ID = 3; // ⚠️ 请确保你的数据库里有 ID 为 1 的题目，且有测试数据！
const TOTAL_REQUESTS = 20; // 模拟并发提交的数量
const BATCH_SIZE = 10; // 每批次并发数 (防止把自己电脑打死)

// 模拟一段正确的 Python 代码 (A + B)
const MOCK_CODE = `
#include <bits/stdc++.h>

using u32 = unsigned;
using i64 = long long;
using u64 = unsigned long long;
using u128 = unsigned __int128;
template<class T>
constexpr T power(T a, i64 b) {
    T res {1};
    for (; b; b /= 2, a *= a) {
        if (b % 2) {
            res *= a;
        }
    }
    return res;
}

constexpr i64 mul(i64 a, i64 b, i64 p) {
    i64 res = a * b - i64(1.L * a * b / p) * p;
    res %= p;
    if (res < 0) {
        res += p;
    }
    return res;
}

template<i64 P>
struct MInt {
    i64 x;
    constexpr MInt() : x {0} {}
    constexpr MInt(i64 x) : x {norm(x % getMod())} {}

    static i64 Mod;
    constexpr static i64 getMod() {
        if (P > 0) {
            return P;
        } else {
            return Mod;
        }
    }
    constexpr static void setMod(i64 Mod_) {
        Mod = Mod_;
    }
    constexpr i64 norm(i64 x) const {
        if (x < 0) {
            x += getMod();
        }
        if (x >= getMod()) {
            x -= getMod();
        }
        return x;
    }
    constexpr i64 val() const {
        return x;
    }
    constexpr MInt operator-() const {
        MInt res;
        res.x = norm(getMod() - x);
        return res;
    }
    constexpr MInt inv() const {
        return power(*this, getMod() - 2);
    }
    constexpr MInt &operator*=(MInt rhs) & {
        if (getMod() < (1ULL << 31)) {
            x = x * rhs.x % int(getMod());
        } else {
            x = mul(x, rhs.x, getMod());
        }
        return *this;
    }
    constexpr MInt &operator+=(MInt rhs) & {
        x = norm(x + rhs.x);
        return *this;
    }
    constexpr MInt &operator-=(MInt rhs) & {
        x = norm(x - rhs.x);
        return *this;
    }
    constexpr MInt &operator/=(MInt rhs) & {
        return *this *= rhs.inv();
    }
    friend constexpr MInt operator*(MInt lhs, MInt rhs) {
        MInt res = lhs;
        res *= rhs;
        return res;
    }
    friend constexpr MInt operator+(MInt lhs, MInt rhs) {
        MInt res = lhs;
        res += rhs;
        return res;
    }
    friend constexpr MInt operator-(MInt lhs, MInt rhs) {
        MInt res = lhs;
        res -= rhs;
        return res;
    }
    friend constexpr MInt operator/(MInt lhs, MInt rhs) {
        MInt res = lhs;
        res /= rhs;
        return res;
    }
    friend constexpr std::istream &operator>>(std::istream &is, MInt &a) {
        i64 v;
        is >> v;
        a = MInt(v);
        return is;
    }
    friend constexpr std::ostream &operator<<(std::ostream &os, const MInt &a) {
        return os << a.val();
    }
    friend constexpr bool operator==(MInt lhs, MInt rhs) {
        return lhs.val() == rhs.val();
    }
    friend constexpr bool operator!=(MInt lhs, MInt rhs) {
        return lhs.val() != rhs.val();
    }
    friend constexpr bool operator<(MInt lhs, MInt rhs) {
        return lhs.val() < rhs.val();
    }
};

template<>
i64 MInt<0>::Mod = 998244353;

constexpr int P = 1000000007;
using Z = MInt<P>;

constexpr int N = 1E5 + 10;

int main() {
	std::ios::sync_with_stdio(false);
	std::cin.tie(nullptr);

	int n;
	std::cin >> n;
	std::vector<i64> a(n);
	for (int i = 0; i < n; i++) {
		std::cin >> a[i];
	}

	std::sort(a.begin(), a.end());

	std::vector<std::vector<int>> fac(N);

	for (int i = 1; i < N; i++) {
		for (int j = i; j < N; j += i) {
			fac[j].push_back(i);
		}
	}

	for (int i = 1; i < N; i++) {
        std::reverse(fac[i].begin(), fac[i].end());
    }

	std::vector<i64> s(N + 1), h(N + 1);

	Z ans = 0;

	for (int i = 0; i < n; i++) {
		int t = a[i];
		for (int d : fac[t]) {
			h[d] = s[d];
		}

		for (int d : fac[t]) {
			for (int td : fac[d]) {
				if (td != d) {
					h[td] -= h[d];
				}
			}
		}

		for (int d : fac[t]) {
			ans += Z(t) * h[d] / d * (n - i - 1);
			s[d] += t;
		}
	}


	std::cout << ans << std::endl;


	return 0;
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
  const globalUser = await prisma.globalUser.findFirst({ select: { id: true } });
  const globalUserId = globalUser?.id;
  let userId: string | undefined;
  if (!globalUserId) {
    console.log("⚠️ 未找到全局管理员，尝试查找普通用户...");
    const normalUser = await prisma.user.findFirst({ select: { id: true } });
    if (!normalUser) {
      console.error("❌ 错误: 数据库没有任何用户，无法创建提交。");
      return;
    }
    userId = normalUser.id;
  }

  console.log(`👤 使用用户 ID: ${globalUserId ?? userId} 进行提交`);

  const startTime = Date.now();

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
              globalUserId,
              userId,
              language: "cpp",
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
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n✅ 压测请求发送完毕!`);
  console.log(`📊 耗时: ${duration.toFixed(2)}s`);
  console.log(`⚡ 平均吞吐: ${(TOTAL_REQUESTS / duration).toFixed(2)} req/s`);
  console.log(`\n👉 现在请观察 worker.ts 的控制台输出，看它处理的速度！`);

  // 关闭连接
  await closeJudgeQueue();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
