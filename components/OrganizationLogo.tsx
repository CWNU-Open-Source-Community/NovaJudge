import Image from "next/image";
import { organizationLogoUrl } from "@/lib/organizations";

export default function OrganizationLogo({ hash }: { hash?: string | null }) {
  if (!hash) return null;
  return <Image src={organizationLogoUrl(hash)} alt="" width={32} height={32}
    unoptimized className="size-8 shrink-0 object-contain" />;
}
