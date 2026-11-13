import path from "node:path";
import type JSZip from "jszip";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { ProblemArchiveError } from "./problem-archive";
import { languageRank, polygonAssetName, polygonPath } from "./polygon-archive";
import type { ProblemSection } from "./problem-section-templates";

export const POLYGON_ASSET_PREFIX = "/api/problems/0/assets/";
interface Statement { path: string; type: string; language: string; charset: string }
type Sample = { input: string; output: string };

const sectionTitles: Record<string, string> = {
  legend: "Problem Description",
  "input-specification": "Input",
  "output-specification": "Output",
  interaction: "Interaction",
  "interaction-specification": "Interaction",
  scoring: "Scoring",
  note: "Note",
  "sample-tests": "Examples",
  "sample-test": "Examples",
};

/** Split Polygon's semantic HTML containers into the editor's native Blocks. */
function statementSections(root: HTMLElement, turndown: TurndownService, hasSamples: boolean): ProblemSection[] {
  const sections: ProblemSection[] = [];
  let title = "Problem Description";
  let content = root.ownerDocument.createElement("div");
  const heading = (element: HTMLElement) => Array.from(element.children)
    .find((child) => child.classList.contains("section-title"));
  const sectionTitle = (element: HTMLElement) => Object.entries(sectionTitles)
    .find(([className]) => element.classList.contains(className))?.[1]
    || heading(element)?.textContent?.trim();
  function flush() {
    const markdown = turndown.turndown(content).trim();
    if (markdown) sections.push({ title, content: markdown });
    content = root.ownerDocument.createElement("div");
  }
  function visit(parent: HTMLElement) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 1) {
        const element = child as HTMLElement;
        if (element.classList.contains("header")) continue;
        if (hasSamples && (element.classList.contains("sample-tests") || element.classList.contains("sample-test"))) continue;
        const nextTitle = sectionTitle(element);
        if (nextTitle) {
          flush();
          title = nextTitle;
          const block = element.cloneNode(true) as HTMLElement;
          // The Block title replaces only its own heading; nested headings stay in the Markdown.
          const label = heading(block);
          if (label) label.parentNode!.removeChild(label);
          content.appendChild(block);
          continue;
        }
        // Some exports add layout wrappers around the semantic containers.
        // Never split inside prose, lists, tables or code just because they contain headings.
        if (["DIV", "SECTION"].includes(element.nodeName) &&
            Array.from(element.querySelectorAll("div, section")).some((descendant) => sectionTitle(descendant as HTMLElement))) {
          visit(element);
          continue;
        }
      }
      content.appendChild(child.cloneNode(true));
    }
  }
  visit(root);
  flush();
  return sections;
}

export async function polygonStatement(options: {
  zip: JSZip;
  prefix: string;
  statements: Statement[];
  samples: Sample[];
  files: Map<string, Buffer>;
  warnings: string[];
  /** Preserve public dialogue/run examples in the statement, separate from private judge samples. */
  preserveExamples?: boolean;
}): Promise<{ sections: ProblemSection[]; samples: Sample[] }> {
  const { zip, prefix, files, warnings } = options;
  let samples = options.samples;
  const available = options.statements.map((statement) => ({ ...statement, path: polygonPath(statement.path) }))
    .filter((statement) => zip.file(prefix + statement.path))
    .sort((a, b) => languageRank(a.language) - languageRank(b.language));
  const html = available.find((statement) => statement.type === "text/html" || /\.html?$/i.test(statement.path));
  // Only statement resources can become public assets; never expose tests or solutions through a link in HTML.
  const statementRoots = new Set(available.map((statement) => path.posix.dirname(statement.path)));
  function resolveResource(base: string, reference: string) {
    let decoded: string;
    try { decoded = decodeURIComponent(reference.split(/[?#]/)[0]); }
    catch { throw new ProblemArchiveError(`Invalid statement resource: ${reference}`); }
    const resolved = polygonPath(path.posix.join(path.posix.dirname(base), decoded.replace(/\\/g, "/")));
    if (![...statementRoots].some((root) => root !== "." && resolved.startsWith(`${root}/`))) {
      throw new ProblemArchiveError(`Statement resource is outside statement directories: ${reference}`);
    }
    return resolved;
  }
  async function asset(name: string): Promise<string> {
    const entry = zip.file(prefix + name);
    if (!entry) throw new ProblemArchiveError(`Missing Polygon statement resource: ${name}`);
    const destination = polygonAssetName(name);
    files.set(`assets/${destination}`, await entry.async("nodebuffer"));
    return POLYGON_ASSET_PREFIX + destination;
  }

  // Statement examples may differ from the judge's marked samples (especially their explanatory formatting).
  const language = html?.language || available[0]?.language;
  const properties = Object.keys(zip.files).filter((name) => name.startsWith(prefix) && name.endsWith("/problem-properties.json"))
    .sort((a, b) => Number(!a.includes(`/${language}/`)) - Number(!b.includes(`/${language}/`)));
  if (properties.length) {
    try {
      const value: unknown = JSON.parse(await zip.files[properties[0]].async("text"));
      if (value && typeof value === "object" && "sampleTests" in value && Array.isArray(value.sampleTests) && value.sampleTests.length) {
        const examples: Sample[] = [];
        for (const sample of value.sampleTests) {
          if (!sample || typeof sample.input !== "string" || typeof sample.output !== "string") throw new Error("Invalid sample");
          examples.push({ input: sample.input, output: sample.output });
        }
        samples = examples;
      }
    } catch {
      warnings.push(options.preserveExamples
        ? "Could not read statement examples; inspect the imported statement before publishing."
        : "Could not read statement examples; using tests marked as samples.");
    }
  }
  const exampleMarkdown = options.preserveExamples ? samples.map((sample, index) => {
    const block = (value: string) => value.split("\n").map((line) => `    ${line}`).join("\n");
    return `## Example ${index + 1}\n\n### Input\n\n${block(sample.input)}\n\n### Output\n\n${block(sample.output)}`;
  }).join("\n\n") : "";
  if (options.preserveExamples) samples = [];
  const exampleSections: ProblemSection[] = exampleMarkdown ? [{ title: "Examples", content: exampleMarkdown }] : [];

  if (html) {
    let source: string;
    try { source = new TextDecoder(html.charset || "utf-8", { fatal: true }).decode(await zip.file(prefix + html.path)!.async("uint8array")); }
    catch { throw new ProblemArchiveError(`Cannot decode Polygon statement: ${html.path} (${html.charset || "UTF-8"}).`); }
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
    turndown.use(gfm);
    // GFM's default plugin preserves headerless tables as raw HTML. Always emit Markdown,
    // so event handlers, scripts and unreplaced resource URLs cannot survive inside a table.
    turndown.addRule("polygon-table", {
      filter: "table",
      replacement: (content) => `\n\n${content.trim()}\n\n`,
    });
    turndown.addRule("polygon-table-row", {
      filter: "tr",
      replacement: (content, element) => {
        const firstRow = element.closest("table")?.querySelector("tr");
        const cells = element.querySelectorAll("th, td").length;
        return `\n${content}${element === firstRow ? `\n|${" --- |".repeat(cells)}` : ""}`;
      },
    });
    turndown.remove(["script", "style", "head", "iframe", "object", "embed", "form", "input", "button"]);
    // Capture the parsed statement DOM through Turndown so section boundaries do not
    // depend on Markdown headings or regular expressions over nested HTML.
    let statementRoot: HTMLElement | undefined;
    turndown.addRule("polygon-statement-root", {
      filter: (element) => {
        if (!statementRoot && element.classList.contains("problem-statement")) statementRoot = element;
        return false;
      },
    });
    // Protect TeX before parsing the DOM, including section fragments converted below.
    source = source.replace(/\${6}([\s\S]*?)\${6}/g, '<polygon-math display="true">$1</polygon-math>')
      .replace(/\${3}([\s\S]*?)\${3}/g, "<polygon-math>$1</polygon-math>");
    const resources = new Set<string>();
    // First pass discovers resource references through parsed DOM attributes, not HTML regular expressions.
    turndown.addRule("polygon-resources", {
      filter: ["img", "a"],
      replacement: (_content, element) => {
        const reference = element.getAttribute(element.nodeName === "IMG" ? "src" : "href") || "";
        if (reference && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(reference)) resources.add(resolveResource(html.path, reference));
        return "";
      },
    });
    turndown.turndown(source);
    const urls = new Map<string, string>();
    for (const name of resources) urls.set(name, await asset(name));
    turndown.addRule("polygon-resources", {
      filter: ["img", "a"],
      replacement: (content, element) => {
        const isImage = element.nodeName === "IMG";
        const reference = element.getAttribute(isImage ? "src" : "href") || "";
        let url = reference;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(reference)) {
          if (!/^(https?:\/\/|#)/i.test(reference)) return content;
        } else if (reference) url = urls.get(resolveResource(html.path, reference)) || "";
        if (!url) return content;
        const label = isImage ? (element.getAttribute("alt") || "").replace(/[\[\]]/g, "") : content;
        return `${isImage ? "!" : ""}[${label}](<${url.replace(/[<>\r\n]/g, "")}>)`;
      },
    });
    turndown.addRule("polygon-chrome", {
      filter: (element) => element.nodeName === "DIV" && (element.classList.contains("header") ||
        (samples.length > 0 && (element.classList.contains("sample-tests") || element.classList.contains("sample-test")))),
      replacement: () => "",
    });
    turndown.addRule("polygon-heading", {
      filter: (element) => element.classList.contains("section-title"),
      replacement: (content) => `\n\n## ${content}\n\n`,
    });
    // A custom element protects TeX from Markdown escaping and decodes HTML entities via textContent.
    turndown.addRule("polygon-math", {
      filter: (element) => element.nodeName === "POLYGON-MATH",
      replacement: (_content, element) => element.getAttribute("display") === "true"
        ? `\n\n$$\n${element.textContent}\n$$\n\n` : `$${element.textContent}$`,
    });
    const sections = statementRoot ? statementSections(statementRoot, turndown, samples.length > 0)
      : [{ title: "Problem Description", content: turndown.turndown(source) }];
    const hasExamples = statementRoot ? Boolean(statementRoot.querySelector(".sample-tests, .sample-test"))
      : /class\s*=\s*["'][^"']*\bsample-tests?\b/i.test(source);
    if (!hasExamples) sections.push(...exampleSections);
    return { sections, samples };
  }

  const pdf = available.find((statement) => statement.type === "application/pdf" || /\.pdf$/i.test(statement.path));
  if (pdf) {
    warnings.push("No HTML statement; the PDF statement is available as an attachment.");
    return { sections: [{ title: "Statement", content: `[Download problem statement (PDF)](${await asset(pdf.path)})` }, ...exampleSections], samples };
  }
  const tex = available.find((statement) => /\.tex$/i.test(statement.path));
  if (tex) {
    warnings.push("Only a LaTeX statement is available. Download the source or add an HTML statement before publishing.");
    return { sections: [{ title: "Statement", content: `[Download problem statement (LaTeX)](${await asset(tex.path)})` }, ...exampleSections], samples };
  }
  warnings.push("No readable statement found. Add a statement before publishing.");
  return { sections: exampleSections, samples };
}
