import Navbar from "@/components/Navbar";
import Link from "next/link";
import { isCliEnabled } from "@/lib/cli-deployment";
import { getSiteConfig } from "@/lib/site-config";
import { getDictionary } from "@/lib/get-dictionary";
import { getTeamInterface } from "@/lib/contest-interface";
import { getDomjudgeContest } from "@/lib/domjudge-contest";
import { SiteFrame } from "@/components/contest/ContestInterface";
import "./contest/domjudge.css";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const site = getSiteConfig();
  const [dict, team] = await Promise.all([getDictionary(), getTeamInterface()]);
  const domjudge = team?.domjudge ? await getDomjudgeContest(team.contestId) : null;
  return (
    <SiteFrame team={team} navigation={
      <Navbar
        domjudge={domjudge ?? undefined}
        siteName={site.name}
        externalLoginLabel={site.externalLoginLabel}
        externalLoginUrl={site.externalLoginUrl}
      />
    } footer={
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto py-6 px-4 text-center">
          {isCliEnabled() && <Link
            href="/cli"
            className="inline-block mb-3 text-xs text-blue-600 hover:underline"
          >
            {dict.footer.installCli}
          </Link>}
          <p className="text-gray-500 text-xs">
            {site.footer && <>{site.footer}<br /></>}
            {dict.footer.poweredBy}{" "}
            <a
              className=" text-gray-800"
              href="https://github.com/CWNU-Open-Source-Community/NovaJudge"
              target="_blank"
            >
              NovaJudge
            </a>{" "}
            {dict.footer.community} © {new Date().getFullYear()}.
          </p>
        </div>
      </footer>
    }>
      {children}
    </SiteFrame>
  );
}
