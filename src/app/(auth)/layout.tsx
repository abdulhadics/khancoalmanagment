import type { ReactNode } from "react";
import { messages } from "@/i18n";

export default function AuthenticationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { common } = messages;
  return (
    <main className="auth-layout">
      <div className="auth-identity">
        <span className="brand-mark brand-mark-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt={common.product}
            width={34}
            height={34}
            className="brand-logo-img"
          />
        </span>
        <div>
          <strong>{common.product}</strong>
          <p>{common.tagline}</p>
        </div>
      </div>
      <div className="auth-content">{children}</div>
    </main>
  );
}
