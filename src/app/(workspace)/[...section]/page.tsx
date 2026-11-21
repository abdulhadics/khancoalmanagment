import { FolderOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  destinations,
  permissionForDestination,
} from "@/components/workspace/navigation";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { requireActor } from "@/server/auth/request-context";

type Props = { params: Promise<{ section: string[] }> };

async function currentDestination({ params }: Props) {
  const { section } = await params;
  const currentPath = `/${section.join("/")}`;
  return destinations.find((item) => item.href === currentPath);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const destination = await currentDestination(props);
  return { title: destination?.label ?? messages.common.notFound };
}

export default async function ModuleSetup(props: Props) {
  const actor = await requireActor();
  const destination = await currentDestination(props);
  if (
    !destination ||
    !can(actor.roleCode, permissionForDestination(destination.href))
  )
    notFound();

  return (
    <>
      <div className="page-heading">
        <h1>{destination.label}</h1>
      </div>
      <section className="module-empty" aria-labelledby="module-empty-heading">
        <FolderOpen aria-hidden="true" size={30} strokeWidth={1.5} />
        <h2 id="module-empty-heading">{messages.setup.moduleHeading}</h2>
        <p>{messages.setup.moduleDescription}</p>
        <Button variant="outline" asChild>
          <Link href="/">{messages.common.backDashboard}</Link>
        </Button>
      </section>
    </>
  );
}
