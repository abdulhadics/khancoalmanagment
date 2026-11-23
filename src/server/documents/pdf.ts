import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import PDFDocument from "pdfkit";

import { formatDocumentDate } from "@/domain/document-format";
import { documentPrint } from "@/i18n/messages/print-en";
import type { DocumentProfile } from "./print-data";

export type PdfDocument = InstanceType<typeof PDFDocument>;
type DocumentOptions = {
  profile: DocumentProfile;
  title: string;
  generatedAt: Date;
  preparedBy: string;
  layout: "portrait" | "landscape";
};

export const documentInk = "#201830";
export const documentMutedInk = "#544B62";
export const documentRule = "#DCD3E9";
export const documentTint = "#F1ECF8";
const documentAccent = "#5536AE";
export const documentInset = 42;
const topMargin = 38;
const bottomMargin = 96;

const requirePackage = createRequire(join(process.cwd(), "package.json"));
let interBytes: { regular: Buffer; semibold: Buffer } | undefined;

function resolveFont(relativePath: string): string {
  try {
    return requirePackage.resolve(relativePath);
  } catch {
    // Fallback when running inside Vercel serverless / traced bundles
    const rootPath = join(process.cwd(), "node_modules", relativePath);
    return rootPath;
  }
}

function fontFiles() {
  if (!interBytes) {
    try {
      interBytes = {
        regular: readFileSync(
          resolveFont("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
        ),
        semibold: readFileSync(
          resolveFont("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
        ),
      };
    } catch {
      // If font files cannot be loaded, interBytes stays undefined and PDFKit uses standard fonts
      interBytes = undefined;
    }
  }
  return interBytes;
}

export function printableText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function documentWidth(doc: PdfDocument): number {
  return doc.page.width - 2 * documentInset;
}

export function documentBottom(doc: PdfDocument): number {
  return doc.page.height - bottomMargin;
}

export function drawDocumentField(
  doc: PdfDocument,
  label: string,
  value: string | null,
  x: number,
  y: number,
  width: number,
) {
  doc
    .font("Inter")
    .fillColor(documentMutedInk)
    .fontSize(8)
    .text(label, x, y, { width });
  doc
    .fillColor(documentInk)
    .fontSize(11)
    .text(value ? printableText(value) : documentPrint.missing, x, doc.y + 2, {
      width,
    });
  return doc.y;
}

function addLetterhead(doc: PdfDocument, profile: DocumentProfile) {
  const logo =
    profile.logoMediaType === "image/png" ||
    profile.logoMediaType === "image/jpeg"
      ? profile.logoBytes
      : null;
  if (logo) {
    try {
      doc.image(Buffer.from(logo), documentInset, topMargin, {
        fit: [48, 48],
        align: "center",
        valign: "center",
      });
    } catch {
      // Ignore image rendering errors to allow PDF generation to proceed
    }
  }

  const textOffset = logo ? 62 : 0;
  const left = documentInset + textOffset;
  const width = documentWidth(doc) - textOffset;
  doc
    .font("Inter Semibold")
    .fillColor(documentInk)
    .fontSize(16)
    .text(printableText(profile.name), left, topMargin, { width });
  doc.font("Inter");
  const contact = [
    profile.tagline,
    profile.address,
    profile.phone,
    profile.email,
  ]
    .flatMap((item) => (item ? [printableText(item)] : []))
    .filter(Boolean)
    .join("  |  ");
  if (contact)
    doc
      .fillColor(documentMutedInk)
      .fontSize(8)
      .text(contact, left, doc.y + 4, { width });

  const divider = Math.max(doc.y, topMargin + (logo ? 48 : 20)) + 11;
  doc
    .lineWidth(1.25)
    .strokeColor(documentAccent)
    .moveTo(documentInset, divider)
    .lineTo(documentInset + documentWidth(doc), divider)
    .stroke();
  doc.x = documentInset;
  doc.y = divider + 16;
}

function addPageFooters(doc: PdfDocument, options: DocumentOptions) {
  const pages = doc.bufferedPageRange();
  const date = formatDocumentDate(
    options.generatedAt,
    options.profile.dateFormat,
  );
  const footer = options.profile.footer
    ? printableText(options.profile.footer)
    : "";

  for (let page = pages.start; page < pages.start + pages.count; page += 1) {
    doc.switchToPage(page);
    const width = documentWidth(doc);
    const y = documentBottom(doc) + 11;
    doc.page.margins.bottom = 0;
    doc
      .lineWidth(0.5)
      .strokeColor(documentRule)
      .moveTo(documentInset, y)
      .lineTo(documentInset + width, y)
      .stroke();
    doc.fontSize(7.5).fillColor(documentMutedInk);
    if (footer) {
      doc.text(footer, documentInset, y + 7, { width, height: 38 });
    }
    const metadataY = doc.page.height - 27;
    const author = documentPrint.prepared(printableText(options.preparedBy));
    const generated = documentPrint.generated(date);
    doc.text(`${author}  |  ${generated}`, documentInset, metadataY, {
      width: width - 105,
      height: 14,
      ellipsis: true,
    });
    doc.text(
      documentPrint.page(page + 1, pages.count),
      documentInset + width - 94,
      metadataY,
      {
        width: 94,
        height: 14,
        align: "right",
      },
    );
  }
}

export function renderPdf(
  options: DocumentOptions,
  draw: (doc: PdfDocument) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: options.layout,
      bufferPages: true,
      autoFirstPage: false,
      margins: {
        left: documentInset,
        right: documentInset,
        top: topMargin,
        bottom: bottomMargin,
      },
      info: {
        Title: options.title,
        Creator: "Faisal Coal Dealer",
        CreationDate: options.generatedAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Uint8Array.from(Buffer.concat(chunks))));
    try {
      const fonts = fontFiles();
      if (fonts) {
        doc.registerFont("Inter", fonts.regular);
        doc.registerFont("Inter Semibold", fonts.semibold);
        doc.font("Inter");
      } else {
        doc.registerFont("Inter", "Helvetica");
        doc.registerFont("Inter Semibold", "Helvetica-Bold");
        doc.font("Helvetica");
      }
      doc.on("pageAdded", () => addLetterhead(doc, options.profile));
      doc.addPage();
      draw(doc);
      addPageFooters(doc, options);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
