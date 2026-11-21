import { Database, Truck, Wallet, UsersRound } from "lucide-react";
import Link from "next/link";
import { permissionForDestination } from "@/components/workspace/navigation";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { requireActor } from "@/server/auth/request-context";

const { nav, setup } = messages;

const primaryDestinations = [
  { label: nav.orderEntry, href: "/orders", icon: Truck },
  { label: nav.account, href: "/account", icon: Wallet },
  { label: nav.customers, href: "/customers", icon: UsersRound },
];

export default async function DashboardSetup() {
  const actor = await requireActor();
  const modules = primaryDestinations.filter(({ href }) =>
    can(actor.roleCode, permissionForDestination(href)),
  );
  return (
    <>
      <div className="page-heading">
        <h1>{nav.dashboard}</h1>
        <p>{setup.description}</p>
      </div>

      <section className="setup-panel" aria-labelledby="setup-heading">
        <div className="setup-copy">
          <h2 id="setup-heading">{setup.sectionHeading}</h2>
          <p>{setup.statusDescription}</p>
        </div>
        <div className="setup-illustration" aria-hidden="true">
          <span className="setup-illustration-icon">
            <Database size={32} strokeWidth={1.45} />
          </span>
        </div>
      </section>

      {modules.length > 0 && (
        <section className="module-navigation" aria-labelledby="module-heading">
          <h2 id="module-heading">{setup.moduleHeading}</h2>
          <ul className="module-links">
            {modules.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link href={href}>
                  <Icon aria-hidden="true" size={21} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
