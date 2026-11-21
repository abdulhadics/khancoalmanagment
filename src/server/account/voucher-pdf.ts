import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency } from "@/domain/number-display";
import { account } from "@/i18n/messages/account-en";
import { voucherPrint as copy } from "@/i18n/messages/vouchers-en";
import {
  documentInk,
  documentInset,
  documentMutedInk,
  documentRule,
  documentTint,
  documentWidth,
  drawDocumentField,
  renderPdf,
} from "@/server/documents/pdf";
import type { VoucherDocument } from "./voucher";

export function renderPaymentVoucher(data: VoucherDocument) {
  const incoming = data.direction === "IN";
  const title = incoming ? copy.receipt : copy.payment;
  return renderPdf(
    { ...data, title: `${title} - ${data.voucherNo}`, layout: "portrait" },
    (doc) => {
      const width = documentWidth(doc);
      const left = documentInset;
      const date = formatDocumentDate(data.date, data.profile.dateFormat);
      const statusDate = formatDocumentDate(
        data.statusDate,
        data.profile.dateFormat,
      );
      const warning = data.status === "BOUNCED" || data.status === "VOIDED";
      doc
        .font("Inter Semibold")
        .fontSize(24)
        .fillColor(documentInk)
        .text(title, left, doc.y, { width });
      doc
        .font("Inter")
        .fontSize(11)
        .fillColor(documentMutedInk)
        .text(data.voucherNo, left, doc.y + 4, { width });
      doc
        .fontSize(9)
        .fillColor(warning ? "#8A263C" : documentMutedInk)
        .text(
          `${account.statuses[data.status]}  |  ${statusDate}`,
          left,
          doc.y + 5,
          { width },
        );

      const summaryY = doc.y + 20;
      const summaryPad = 14;
      const amount = formatCurrency(data.amount, data.profile);
      const amountWidth = width - 2 * summaryPad;
      doc.rect(left, summaryY, width, 67).fill(documentTint);
      doc
        .fontSize(8)
        .fillColor(documentMutedInk)
        .text(copy.amount, left + summaryPad, summaryY + 12, {
          width: amountWidth,
        });
      doc.font("Inter Semibold").fontSize(23);
      const fitSize = Math.min(
        23,
        (23 * (amountWidth - 1)) / Math.max(1, doc.widthOfString(amount)),
      );
      doc
        .fontSize(fitSize)
        .fillColor(documentInk)
        .text(amount, left + summaryPad, summaryY + 29, { width: amountWidth });
      doc.font("Inter");

      let y =
        drawDocumentField(
          doc,
          incoming ? copy.receivedFrom : copy.paidTo,
          `${data.party.name} (${data.party.code})`,
          left,
          summaryY + 88,
          width,
        ) + 15;
      const gap = 28;
      const column = (width - gap) / 2;
      const right = left + column + gap;
      const fields = [
        [copy.date, date, copy.method, account.methods[data.method]],
        [copy.account, data.bankName, copy.reference, data.referenceNo],
      ] as const;
      for (const [label, value, otherLabel, otherValue] of fields) {
        const leftBottom = drawDocumentField(
          doc,
          label,
          value,
          left,
          y,
          column,
        );
        const rightBottom = drawDocumentField(
          doc,
          otherLabel,
          otherValue,
          right,
          y,
          column,
        );
        y = Math.max(leftBottom, rightBottom) + 15;
      }

      if (data.notes) {
        doc
          .lineWidth(0.5)
          .strokeColor(documentRule)
          .moveTo(left, y + 1)
          .lineTo(left + width, y + 1)
          .stroke();
        drawDocumentField(doc, copy.notes, data.notes, left, y + 13, width);
      }
    },
  );
}
