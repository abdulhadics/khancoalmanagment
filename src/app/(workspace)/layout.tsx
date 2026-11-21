import { CalendarDays } from "lucide-react";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { DesktopSidebar, MobileSidebar } from "@/components/workspace/sidebar";
import { formatBusinessDate } from "@/domain/business-date";
import { messages } from "@/i18n";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  const today = formatBusinessDate(new Date());

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        {messages.common.skip}
      </a>
      <DesktopSidebar />
      <div className="workspace-body">
        <header className="workspace-toolbar">
          <MobileSidebar />
          <span className="workspace-label">{messages.common.workspace}</span>
          <span className="workspace-date">
            <CalendarDays aria-hidden="true" size={17} />
            {today}
          </span>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
