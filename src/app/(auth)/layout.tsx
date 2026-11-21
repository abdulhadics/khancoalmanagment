import { Truck } from "lucide-react";
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
        <span className="brand-mark">
          <Truck aria-hidden="true" size={22} />
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
