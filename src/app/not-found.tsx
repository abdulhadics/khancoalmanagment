import Link from "next/link";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n";

export default function NotFoundPage() {
  return (
    <main className="standalone-page">
      <h1>{messages.common.notFound}</h1>
      <Button asChild>
        <Link href="/">{messages.common.backDashboard}</Link>
      </Button>
    </main>
  );
}
