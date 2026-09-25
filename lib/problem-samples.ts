export type CommunicationSampleData = {
  firstOutput: string;
  secondInput: string;
  secondOutput: string;
};

export type ProblemSample = {
  /** 普通题的输入；通信题的第一轮完整输入。 */
  input: string;
  /** 普通题的样例输出；通信题仅供裁判读取的参考答案，不公开展示。 */
  output: string;
  /** 通信题题面展示的两轮示例，不参与判定或生成第二轮实际输入。 */
  communication?: CommunicationSampleData;
};

export function createCommunicationSample(): ProblemSample {
  return {
    input: "",
    output: "",
    communication: { firstOutput: "", secondInput: "", secondOutput: "" },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 保存和导入共用校验；保留原始空白及旧版通信题参考答案。 */
export function normalizeProblemSamples(value: unknown): ProblemSample[] {
  if (!Array.isArray(value)) throw new Error("Samples must be an array.");
  return value.map((sample: unknown, index) => {
    if (!isRecord(sample) || typeof sample.input !== "string" || typeof sample.output !== "string") {
      throw new Error(`Sample ${index + 1}: input and output must be text.`);
    }
    const result: ProblemSample = { input: sample.input, output: sample.output };
    if (sample.communication !== undefined) {
      if (!isRecord(sample.communication)) {
        throw new Error(`Sample ${index + 1}: communication must contain the two-run example.`);
      }
      const communication = sample.communication;
      for (const field of ["firstOutput", "secondInput", "secondOutput"] as const) {
        if (typeof communication[field] !== "string") {
          throw new Error(`Sample ${index + 1}: communication.${field} must be text.`);
        }
      }
      result.communication = {
        firstOutput: communication.firstOutput as string,
        secondInput: communication.secondInput as string,
        secondOutput: communication.secondOutput as string,
      };
    }
    return result;
  });
}

/** 只返回公开字段，避免裁判参考答案进入题面或客户端组件。 */
export function getCommunicationSampleDisplay(sample: ProblemSample) {
  return {
    firstInput: sample.input,
    firstOutput: sample.communication?.firstOutput ?? "",
    secondInput: sample.communication?.secondInput ?? "",
    secondOutput: sample.communication?.secondOutput ?? "",
  };
}

/** 导出给题面抓取工具的普通输入输出样例；通信题展开为两轮展示。 */
export function getPublicProblemSamples(problemType: string, samples: readonly ProblemSample[]) {
  if (problemType !== "communication") {
    return samples.map(({ input, output }) => ({ input, output }));
  }
  return samples.flatMap((sample) => {
    const display = getCommunicationSampleDisplay(sample);
    const runs = [{ input: display.firstInput, output: display.firstOutput }];
    if (display.secondInput || display.secondOutput) {
      runs.push({ input: display.secondInput, output: display.secondOutput });
    }
    return runs;
  });
}
