import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { formatDocumentDate } from "../../src/domain/document-format";
import {
  maxLogoInputBytes,
  normalizeCompanyLogo,
} from "../../src/server/settings/logo";

describe("company date formatting", () => {
  it("renders each date preference using the Karachi day", () => {
    const instant = new Date("2026-11-20T19:01:00.000Z");
    expect(formatDocumentDate(instant, "dd MMM yyyy")).toBe("21 Nov 2026");
    expect(formatDocumentDate(instant, "dd/MM/yyyy")).toBe("21/11/2026");
    expect(formatDocumentDate(instant, "yyyy-MM-dd")).toBe("2026-11-21");
  });
});

describe("company logo normalization", () => {
  it("decodes a raster and re-encodes it as a bounded PNG", async () => {
    const input = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: "#5536ae",
      },
    })
      .jpeg()
      .toBuffer();
    const file = new File([Uint8Array.from(input)], "logo.jpg", {
      type: "image/jpeg",
    });
    const result = await normalizeCompanyLogo(file);
    expect(result?.logoMediaType).toBe("image/png");
    expect(await sharp(result?.logoBytes).metadata()).toMatchObject({
      format: "png",
      width: 640,
      height: 320,
    });
  });

  it("rejects active markup, a lying content type, truncation, and oversize files", async () => {
    const vector = new File(
      ["<svg xmlns='http://www.w3.org/2000/svg'/>"],
      "vector.svg",
      { type: "image/svg+xml" },
    );
    const invalidJpeg = new File(
      [Uint8Array.from([255, 216, 255])],
      "broken.jpg",
      { type: "image/jpeg" },
    );
    const wrongType = new File(
      [Uint8Array.from([255, 216, 255])],
      "wrong.png",
      { type: "image/png" },
    );
    const tooLarge = new File(
      [new Uint8Array(maxLogoInputBytes + 1)],
      "large.png",
      { type: "image/png" },
    );
    for (const file of [vector, invalidJpeg, wrongType, tooLarge]) {
      await expect(normalizeCompanyLogo(file)).resolves.toBeNull();
    }
  });
});
