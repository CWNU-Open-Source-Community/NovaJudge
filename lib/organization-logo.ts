import { createHash } from "node:crypto";
import sharp from "sharp";
import { OrganizationInputError } from "./organizations";

export async function readOrganizationLogo(file: File) {
  if (file.size > 2 * 1024 * 1024) throw new OrganizationInputError("size");
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16_777_216 });
    const { format } = await image.metadata();
    if (!["png", "jpeg", "webp", "svg"].includes(format)) throw new Error("Unsupported image");
    const data = await image.rotate().resize(192, 192, { fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true }).toBuffer();
    return { hash: createHash("sha256").update(data).digest("hex"), data: new Uint8Array(data) };
  } catch {
    throw new OrganizationInputError("image");
  }
}
