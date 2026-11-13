'use client';

import Link from "next/link";
import { useState } from "react";
import {
  PlayIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

export default function ImportProblemsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('native');
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    importedProblems: { id: number; title: string; displayId?: string }[];
    errors: string[];
    warnings?: string[];
  } | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.name.toLowerCase().endsWith('.zip')) {
      setFile(selectedFile);
      setImportResult(null);
    } else {
      toast.error('Please select a ZIP file');
      setFile(null);
    }
  }

  async function handleImport() {
    if (!file) {
      toast.error('Please select a file to import');
      return;
    }

    setIsLoading(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('format', format);

      const response = await fetch('/api/problems/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      if (result.importedProblems.length > 0) {
        toast.success(`Successfully imported ${result.importedProblems.length} problems`);
      }

      if (result.errors.length > 0) {
        result.errors.forEach((error: string) => {
          toast.error(error);
        });
      }

    } catch (error) {
      toast.error((error as Error).message || 'Import failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center mb-6 gap-4">
        <Link
          href="/admin/problems"
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="w-5 h-5" />
          Back to Problem Bank
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-800 mb-6">Import Problems</h1>

      <div className="bg-white shadow rounded-lg p-8 max-w-2xl">
        <div className="space-y-6">
          <div>
            <label htmlFor="import-format" className="block text-sm font-medium text-gray-700 mb-2">Import Format</label>
            <select id="import-format" value={format} disabled={isLoading}
              onChange={(event) => { setFormat(event.target.value); setImportResult(null); }}
              className="w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="native">NovaJudge ZIP</option>
              <option value="polygon">Polygon ZIP (Linux / Windows)</option>
            </select>
          </div>
          {/* File Upload Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select ZIP File
            </label>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                disabled={isLoading}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-100 file:text-blue-700
                  hover:file:bg-blue-200"
              />
            </div>
            {file && (
              <p className="mt-2 text-sm text-gray-500">
                Selected file: {file.name}
              </p>
            )}
          </div>

          {/* Import Button */}
          <div>
            <button
              onClick={handleImport}
              disabled={isLoading || !file}
              className="w-full bg-purple-600 text-white px-6 py-3 rounded shadow hover:bg-purple-700 transition flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Importing...
                </>
              ) : (
                <>
                  <PlayIcon className="w-5 h-5" />
                  Import Problems
                </>
              )}
            </button>
          </div>

          {/* Import Result */}
          {importResult && (
            <div className="mt-8 border-t pt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Import Result</h2>
              
              {importResult.importedProblems.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-green-700 mb-2">
                    Successfully Imported ({importResult.importedProblems.length} problems)
                  </h3>
                  <ul className="bg-green-50 border border-green-200 rounded-md p-4 space-y-2">
                    {importResult.importedProblems.map((problem) => (
                      <li key={problem.id} className="text-sm text-green-800">
                        {problem.displayId && `${problem.displayId} → `}#{problem.id} - {problem.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-red-700 mb-2">
                    Errors ({importResult.errors.length})
                  </h3>
                  <ul className="bg-red-50 border border-red-200 rounded-md p-4 space-y-2">
                    {importResult.errors.map((error, index) => (
                      <li key={index} className="text-sm text-red-800">
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!importResult.warnings?.length && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <h3 className="font-medium mb-2">Review before publishing</h3>
                  <ul className="list-disc pl-5 space-y-1">{importResult.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Instructions</h2>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
              {format === 'polygon' ? (
                <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
                  <li>Upload a Polygon Linux or Windows package containing <code>problem.xml</code>, generated tests, answers, and C++ checker source.</li>
                  <li>A single problem ZIP, a Polygon contest export, multiple problem directories, or an outer ZIP containing problem ZIPs is supported.</li>
                  <li>Contest exports import their problems into the problem bank. Administrators create contests and add the imported problems separately.</li>
                  <li>Imports the title, limits, examples, HTML statement, images, tests, and testlib checker. Chinese statements are preferred, then English.</li>
                  <li>Statement sections become separate editable Blocks, including Problem Description, Input, Output, Interaction, and Note.</li>
                  <li>PDF or LaTeX-only statements are imported as attachments. Review any warnings after import.</li>
                  <li>Interactive and two-run communication problems are supported, including interaction in either the first run or both runs. Include the C++ interactor source when used.</li>
                  <li>File I/O and partial-score packages require manual conversion. Incomplete standard packages are rejected.</li>
                </ul>
              ) : <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
                <li>Create a ZIP file containing one or more problem directories</li>
                <li>Each problem directory should contain:</li>
                <ul className="pl-5 mt-1 space-y-1">
                  <li><code>problem.json</code> - Problem metadata</li>
                  <li><code>data/</code> - Test cases and judge configuration</li>
                  <li><code>assets/</code> - Problem attachments</li>
                </ul>
                <li>The ZIP file structure should match the export format</li>
              </ul>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
