'use client';

import { useState } from "react";
import { PlayIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { toast } from "sonner";

export default function AdminContestsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('native');
  const [result, setResult] = useState<{
    importedContests: string[];
    importedProblems?: { id: number; title: string; displayId?: string }[];
    errors: string[];
    warnings?: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setResult(null);
      if (selectedFile.name.toLowerCase().endsWith(".zip")) {
        setFile(selectedFile);
      } else {
        setFile(null);
        toast.error("Please upload a ZIP file");
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Please select a ZIP file to upload");
      return;
    }

    setIsLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", format);

      const response = await fetch('/api/contests/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Import failed');
      }

      const result = await response.json();
      setResult(result);
      if (result.importedProblems?.length) toast.success(`Successfully imported ${result.importedProblems.length} problems to the problem bank`);
      if (result.importedContests.length) toast.success(`Successfully imported ${result.importedContests.length} contests`);
      if (result.errors?.length) toast.error(`Import completed with ${result.errors.length} errors. See details below.`);
    } catch (error) {
      toast.error((error as Error).message || 'Import failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/contests"
          className="flex items-center gap-1 text-gray-600 hover:text-gray-800"
        >
          <ArrowLeftIcon className="w-5 h-5" />
          Back to Contests
        </Link>
        <h1 className="text-2xl font-bold text-gray-800">{format === 'polygon' ? 'Import Polygon Contest Problems' : 'Import Contests'}</h1>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-200 p-6">
        <div className="max-w-md mx-auto">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">{format === 'polygon' ? 'Upload Polygon Contest Package' : 'Upload Contest Data'}</h2>
            <p className="text-gray-500 text-sm">
              {format === 'polygon'
                ? 'Import all problems from a Polygon contest export into the problem bank. Administrators create contests and select their problems separately.'
                : 'Upload a NovaJudge export ZIP containing contest information, users, problems, and submissions.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="import-format" className="block text-sm font-medium text-gray-700 mb-2">Import Format</label>
              <select id="import-format" value={format} disabled={isLoading}
                onChange={(event) => { setFormat(event.target.value); setResult(null); }}
                className="w-full rounded-md border border-gray-300 px-3 py-2">
                <option value="native">NovaJudge ZIP</option>
                <option value="polygon">Polygon Contest ZIP (problems only)</option>
              </select>
            </div>
            {format === 'polygon' && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-2">
                <p>Upload the ZIP exported from your Polygon contest, including <code>contest.xml</code> and its complete problem directories or ZIPs. All listed problems are imported together, in package order.</p>
                <p>Supports ordinary, interactive, and two-run communication problems. Include all generated tests, answers, and the C++ checker/interactor sources.</p>
                <p>Packages without <code>contest.xml</code> are imported in filename order. Use Linux or Windows packages with generated tests, answers, and C++ testlib checkers.</p>
                <p>This upload adds problems to the problem bank. After import, create a contest in the admin panel and add the imported problems.</p>
              </div>
            )}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
              <PlayIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Select a ZIP file to import</p>
                <label className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                  Browse files
                  <input
                    type="file"
                    className="sr-only"
                    accept=".zip,application/zip"
                    onChange={handleFileChange}
                    disabled={isLoading}
                  />
                </label>
              </div>
            </div>

            {file && (
              <div className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm text-gray-700">Selected file: {file.name}</p>
                <p className="text-xs text-gray-500">Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading || !file}
                className="flex items-center gap-2 bg-purple-600 text-white px-6 py-2 rounded hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Importing...
                  </>
                ) : (
                  format === 'polygon' ? 'Import Problems' : 'Import Contests'
                )}
              </button>
            </div>
          </form>
          {result && (
            <div className="mt-6 space-y-4" aria-live="polite">
              <h3 className="font-semibold text-gray-800">Import Result</h3>
              {result.importedContests.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p>Successfully imported {result.importedContests.length} contests.</p>
                  <ul className="mt-2 space-y-1">{result.importedContests.map((name, index) => <li key={index}>{name}</li>)}</ul>
                </div>
              )}
              {!!result.importedProblems?.length && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p>Successfully imported {result.importedProblems.length} problems to the problem bank.</p>
                  <ul className="mt-2 space-y-1">{result.importedProblems.map((problem) => (
                    <li key={problem.id}>
                      {problem.displayId && <span>{problem.displayId} → </span>}
                      <Link className="underline" href={`/admin/problems/${problem.id}`}>#{problem.id} — {problem.title}</Link>
                    </li>
                  ))}</ul>
                  <div className="mt-3 flex gap-4">
                    <Link className="underline" href="/admin/problems">Open Problem Bank</Link>
                    <Link className="underline" href="/admin/contests/create">Create Contest</Link>
                  </div>
                </div>
              )}
              {!!result.errors.length && <ul className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-1">
                {result.errors.map((error, index) => <li key={index}>{error}</li>)}
              </ul>}
              {!!result.warnings?.length && <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium mb-2">Review before publishing</p>
                <ul className="space-y-1">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
