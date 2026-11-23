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
        <div className="brand-logo-container">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt={common.product}
            className="brand-logo-banner"
          />
        </div>
        <div className="brand-text">
          <strong>{common.product}</strong>
          <p>{common.tagline}</p>
        </div>
      </div>
      <div className="auth-content">{children}</div>
    </main>
  );
}
