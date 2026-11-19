import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/.test(hash)) return new Response(null, { status: 404 });
  const logo = await prisma.organizationLogo.findUnique({ where: { hash }, select: { data: true } });
  if (!logo) return new Response(null, { status: 404 });
  return new Response(logo.data, { headers: {
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  } });
}
