export const contestLanguages = [
  { value: "c", label: "C", sourceName: "main.c", extensions: ["c"] },
  { value: "cpp", label: "C++", sourceName: "main.cpp", extensions: ["cc", "cpp", "cxx"] },
  { value: "java", label: "Java", sourceName: "Main.java", extensions: ["java"] },
  { value: "pypy3", label: "PyPy3", sourceName: "main.py", extensions: ["py", "py3"] },
];

export function languageFromFilename(filename: string) {
  const extension = filename.match(/\.([^.]+)$/)?.[1].toLowerCase();
  return contestLanguages.find(language => extension && language.extensions.includes(extension))?.value;
}
