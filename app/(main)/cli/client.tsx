"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import CodeBlock from "@/components/CodeBlock";
import { useLanguage } from "@/context/LanguageContext";
import { cliInstructions } from "./messages";

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const powershellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function CliText({ text }: { text: string }) {
  return text.split("`").map((part, index) =>
    index % 2 === 0 ? part : <code key={index}>{part}</code>,
  );
}

export default function CliInstructions() {
  const { lang } = useLanguage();
  const copy = cliInstructions[lang];
  const [contest, setContest] = useState<{ id: number; title: string } | null>(null);
  const [loadingContest, setLoadingContest] = useState(true);
  const [contestError, setContestError] = useState(false);
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const installer = origin
    ? `curl -fsSL ${shellQuote(`${origin}/api/cli/install`)} | /bin/bash -s --`
    : "";
  const windowsInstaller = origin
    ? `$installer = Join-Path $env:TEMP 'novajudge-install.ps1'\nInvoke-WebRequest -UseBasicParsing ${powershellQuote(`${origin}/api/cli/install?platform=windows`)} -OutFile $installer\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer`
    : "";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cli/settings", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error("Could not read CLI settings");
        setContest(data.contest);
      })
      .catch(() => {
        if (!controller.signal.aborted) setContestError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingContest(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <header className="bg-white border border-gray-200 shadow-sm rounded-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <CommandLineIcon className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-serif font-bold text-gray-800">
            {copy.title}
          </h1>
        </div>
        <p className="text-gray-600 leading-relaxed">
          <CliText text={copy.intro} />
        </p>
        <div className="mt-4 rounded-sm border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          {loadingContest ? copy.loadingContest : contestError ? copy.contestError : contest
            ? <>{copy.currentContest} · <strong>#{contest.id} · {contest.title}</strong></>
            : copy.noContest}
        </div>
      </header>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-3">
        <h2 className="text-lg font-bold text-gray-800">{copy.proctoringTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.proctoring} />
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">{copy.installTitle}</h2>
        <h3 className="font-semibold text-gray-800">{copy.powershellTitle}</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.windowsRequirements} />
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.windowsInstall} />
        </p>
        {origin ? <CodeBlock code={`${windowsInstaller} -Url ${powershellQuote(origin)}`} />
          : <p className="text-sm text-gray-500">{copy.loadingInstaller}</p>}
        <p className="text-sm text-gray-600">{copy.powershellUseNow}</p>
        <CodeBlock code={'$env:Path = "$env:LOCALAPPDATA\\NovaJudge\\submit;$env:Path"'} />
        <h3 className="font-semibold text-gray-800">macOS</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.macInstall} />
        </p>
        {origin ? (
          <CodeBlock code={`${installer} --url ${shellQuote(origin)}`} />
        ) : (
          <p className="text-sm text-gray-500">{copy.loadingInstaller}</p>
        )}
        <p className="text-sm text-gray-600">
          {copy.macUseNow}
        </p>
        <CodeBlock code={'export PATH="$HOME/.local/bin:$PATH"'} />
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">{copy.linkTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.link} />
        </p>
        <CodeBlock code="submit A.cpp" />
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.linkBeforeSubmit} />
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">{copy.submitTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.problemFromFile} />
        </p>
        <CodeBlock code={'submit A.cpp\nsubmit --problem A main.cpp\nsubmit -y A.cpp\nsubmit --problem A "source file.cpp" --yes\nsubmit --help'} />
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.confirmSubmit} />
        </p>
        <p className="text-sm text-gray-600">{copy.statusAndLogout}</p>
        <CodeBlock code={"submit status\nsubmit logout"} />
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">{copy.printTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.printConfirm} />
        </p>
        <CodeBlock code={'printfile A.cpp\nprintfile -y "source file.py"\nprintfile Main.java --yes\nprintfile Main.java n\nprintfile --help'} />
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.printRequirements} />
        </p>
      </section>

      <section className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">{copy.updateTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <CliText text={copy.update} />
        </p>
        <p className="text-sm text-gray-600">{copy.powershellUninstall}</p>
        {origin && <CodeBlock code={`${windowsInstaller} -Uninstall`} />}
        <p className="text-sm text-gray-600">{copy.macUninstall}</p>
        {origin && <CodeBlock code={`${installer} --uninstall`} />}
        <p className="text-sm text-gray-500">
          {copy.supported}
        </p>
      </section>
    </div>
  );
}
