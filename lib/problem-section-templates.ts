export type ProblemSection = { title: string; content: string };

const standardSections: ProblemSection[] = [
  { title: "Problem Description", content: "" },
  { title: "Input", content: "" },
  { title: "Output", content: "" },
];

// 新建通信题的默认题面，采用两次运行的编码 / 解码示例。
const communicationSections: ProblemSection[] = [
  {
    title: "Problem Description",
    content: "**这是一个通信题**。在这些问题中，你的程序将被运行两次。在两次运行之间，内存中存储的所有变量都将丢失，但第一次运行中提供给你的信息可能对你在第二次运行中正确解决问题非常重要。因此，主要的挑战是找到一种策略，利用有限的输出在两次运行之间进行交流。\n\n在这个问题中，你的任务是找到一种策略，对大小为 $n$ 的数组 $a$ 进行编码和解码。\n\n第一次运行是**编码**阶段。给定 $n$ 和 $a$ 的元素。你的任务是将这个数组编码成一个只包含**小写英文字母**的字符串 $s$ ，并将 $s$ 传递回判题机。然后，你的程序将终止，内存中存储的所有变量都将丢失。\n\n第二次运行是**解码**阶段。判题机给您一个字符串 $s$ （与您在第一次运行时传递给判题机的字符串相同）。您的任务是解码 $s$ ，并确定 $n$ 和数组 $a$ 中最初给出的元素。换句话说，您必须逆转第一次运行时的编码算法。\n",
  },
  {
    title: "First Run",
    content: "您的代码将在每次测试中准确运行两次。第一次运行时，您将执行**编码**。",
  },
  {
    title: "Input",
    content: "输入的第一行首先包含字符串 `first`。这样做的目的是让你的程序识别到这是它的第一次运行，并且它应该作为编码算法。\n\n第二行包含一个整数 $n$ ( $1 \\le n \\le 10^4$ ) 表示数组 $a$ 的长度。\n\n第三行包含 $n$ 个空格分隔的整数 $a_1, a_2, \\ldots, a_n$ ( $1 \\leq a_i \\leq 26$ )。",
  },
  {
    title: "Output",
    content: "输出一行字符串 $s$（$1 \\leq |s| \\leq 10^5$ ，其中 $|s|$ 表示 $s$ 的长度）表示编码后的结果。该字符串必须只包含小写英文字母，打印时不得有空格。\n\n之后，程序将终止。请注意，内存中存储的所有变量都将丢失。",
  },
  {
    title: "Second Run",
    content: "第二次运行时，您将执行**解码**。",
  },
  {
    title: "Input",
    content: "输入的第一行包含字符串 `second`。这样做的目的是为了让你的程序识别这是第二次运行，它应该作为解码算法。\n\n第二行输入包含字符串 $s$ ，即第一次运行时传递给判题机的变量。",
  },
  {
    title: "Output",
    content: "输出一行 $n + 1$ 个整数，格式为 $n\\, a_1\\, a_2\\, \\ldots\\, a_n$ 表示原始数组的长度以及数组本身，中间以空格隔开。",
  },
];

export function createDefaultProblemSections(type: string): ProblemSection[] {
  const template = type === "communication" ? communicationSections : standardSections;
  return template.map((section) => ({ ...section }));
}
