import CodeBlock from "@/components/CodeBlock";

interface CommunicationSampleProps {
  firstInput: string;
  firstOutput: string;
  secondInput: string;
  secondOutput: string;
  index?: number;
  labels?: {
    firstRun: string;
    secondRun: string;
    input: string;
    output: string;
  };
}

const defaultLabels = {
  firstRun: "第一次运行",
  secondRun: "第二次运行",
  input: "样例输入",
  output: "样例输出",
};

export default function CommunicationSample({
  firstInput,
  firstOutput,
  secondInput,
  secondOutput,
  index,
  labels = defaultLabels,
}: CommunicationSampleProps) {
  const suffix = index === undefined ? "" : ` ${index}`;
  const runs = [
    { title: labels.firstRun, input: firstInput, output: firstOutput },
    { title: labels.secondRun, input: secondInput, output: secondOutput },
  ];

  return (
    <div className="space-y-5">
      {runs.map((run, runIndex) => (
        <section key={runIndex} className="min-w-0">
          <h3 className="mb-3 border-l-4 border-blue-600 pl-3 font-serif text-lg font-bold tracking-wide text-blue-800">
            {run.title}{suffix}
          </h3>
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <h4 className="mb-2 text-sm font-semibold text-gray-700">
                {labels.input}
              </h4>
              <CodeBlock code={run.input} />
            </div>
            <div className="min-w-0">
              <h4 className="mb-2 text-sm font-semibold text-gray-700">
                {labels.output}
              </h4>
              <CodeBlock code={run.output} />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
