import { Buffer } from "node:buffer";
import { CliDeviceError } from "@/lib/cli-device-policy";

export const PRINT_FILE_MAX_BYTES = 120_000;
export const PRINT_FILE_MAX_CHARACTERS = 100_000;
// Allow even fully escaped JSON for a maximum-sized source, but bound the
// incoming stream independently of Content-Length and the decoded source.
export const PRINT_FILE_MAX_JSON_BYTES = 1_048_576;

const languages: Record<string, "c" | "cpp" | "java" | "pypy3"> = {
  ".c": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".java": "java", ".py": "pypy3",
};

function isControl(character: string) {
  const value = character.charCodeAt(0);
  return value < 32 || (value >= 127 && value <= 159);
}

function isLoneSurrogate(character: string) {
  // Array.from iterates Unicode code points, leaving only unpaired surrogate
  // code units in this range. JSON escapes can introduce these in valid UTF-8.
  const value = character.codePointAt(0)!;
  return value >= 0xd800 && value <= 0xdfff;
}

export function validatePrintFile(body: Record<string, unknown>) {
  const sourceFilename = typeof body.sourceFilename === "string" ? body.sourceFilename : "";
  if (!sourceFilename || sourceFilename.length > 255 || /[/\\:]/.test(sourceFilename) ||
      Array.from(sourceFilename).some((character) => isControl(character) || isLoneSurrogate(character))) {
    throw new CliDeviceError("Provide a filename without a path or control characters (maximum 255 characters).", 400, "INVALID_PRINT_FILENAME");
  }
  const extension = sourceFilename.slice(sourceFilename.lastIndexOf(".")).toLowerCase();
  const language = languages[extension];
  if (!language) {
    throw new CliDeviceError("Only .cpp, .c, .cc, .cxx, .java and .py source files can be printed.", 400, "INVALID_PRINT_EXTENSION");
  }
  const code = typeof body.code === "string" ? body.code : "";
  if (code.length > PRINT_FILE_MAX_CHARACTERS || Buffer.byteLength(code, "utf8") > PRINT_FILE_MAX_BYTES) {
    throw new CliDeviceError("Print files must not exceed 120000 UTF-8 bytes or 100000 characters.", 413, "PRINT_FILE_TOO_LARGE");
  }
  if (!code.trim() || Array.from(code).some((character) => isLoneSurrogate(character) ||
      (isControl(character) && !["\t", "\n", "\r"].includes(character)))) {
    throw new CliDeviceError("Provide non-empty text without binary or control characters.", 400, "INVALID_PRINT_CONTENT");
  }
  return { sourceFilename, code, language };
}

export async function readPrintFileJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new CliDeviceError("Content-Type must be application/json.", 415, "INVALID_CONTENT_TYPE");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > PRINT_FILE_MAX_JSON_BYTES) {
    throw new CliDeviceError("Print request is too large.", 413, "PRINT_FILE_TOO_LARGE");
  }
  if (!request.body) throw new CliDeviceError("A JSON object is required.", 400, "INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PRINT_FILE_MAX_JSON_BYTES) {
        await reader.cancel();
        throw new CliDeviceError("Print request is too large.", 413, "PRINT_FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch {
    throw new CliDeviceError("Invalid JSON request.", 400, "INVALID_JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CliDeviceError("A JSON object is required.", 400, "INVALID_JSON");
  }
  return body as Record<string, unknown>;
}
