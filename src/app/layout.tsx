import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@/app/globals.css";
import { messages } from "@/i18n";

export const metadata: Metadata = {
  title: {
    default: messages.common.product,
    template: "%s | Faisal Coal Dealer",
  },
  description: messages.setup.description,
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/logo.png", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/logo.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
