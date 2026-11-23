"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n";
import { primaryMenu, settingsItem, type Destination } from "./navigation";

const { common } = messages;

function SidebarNav({
  allowedRoutes,
  onNavigate,
}: {
  allowedRoutes: readonly string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const handleNavigation: NonNullable<LinkProps["onNavigate"]> = (event) => {
    if (
      document.querySelector("main form[data-dirty]") &&
      !window.confirm(common.leaveDraft)
    ) {
      event.preventDefault();
      return;
    }
    onNavigate?.();
  };

  function linkProps(item: Destination) {
    return {
      href: item.href,
      "aria-current": item.href === pathname ? ("page" as const) : undefined,
      onNavigate: handleNavigation,
    };
  }

  return (
    <>
      <Link href="/" className="workspace-brand" onNavigate={handleNavigation}>
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
        <span>
          <strong>{common.product}</strong>
          <small>{common.tagline}</small>
        </span>
      </Link>

      <nav className="sidebar-nav" aria-label={common.navigation}>
        <ul className="nav-list">
          {primaryMenu.map((item) => {
            const Icon = item.icon;
            if ("children" in item) {
              const children = item.children.filter(({ href }) =>
                allowedRoutes.includes(href),
              );
              if (children.length === 0) return null;
              const isCurrent = children.some(
                (child) => child.href === pathname,
              );
              const open = expanded[item.label] ?? isCurrent;
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    className="nav-item"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((previous) => ({
                        ...previous,
                        [item.label]: !open,
                      }))
                    }
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span>{item.label}</span>
                    <ChevronDown
                      className="nav-chevron"
                      aria-hidden="true"
                      size={15}
                    />
                  </button>
                  {open && (
                    <ul className="nav-children">
                      {children.map((child) => (
                        <li key={child.href}>
                          <Link className="nav-item" {...linkProps(child)}>
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }
            if (!allowedRoutes.includes(item.href)) return null;
            return (
              <li key={item.href}>
                <Link className="nav-item" {...linkProps(item)}>
                  <Icon aria-hidden="true" size={18} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {allowedRoutes.includes(settingsItem.href) && (
          <div className="sidebar-settings">
            <Link className="nav-item" {...linkProps(settingsItem)}>
              <settingsItem.icon aria-hidden="true" size={18} />
              {settingsItem.label}
            </Link>
          </div>
        )}
      </nav>
    </>
  );
}

export function DesktopSidebar({ allowedRoutes }: { allowedRoutes: string[] }) {
  return (
    <aside className="desktop-sidebar">
      <SidebarNav allowedRoutes={allowedRoutes} />
    </aside>
  );
}

export function MobileSidebar({ allowedRoutes }: { allowedRoutes: string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <div className="mobile-navigation">
      <Button
        variant="outline"
        size="icon"
        type="button"
        aria-label={common.openNavigation}
        onClick={() => dialog.current?.showModal()}
      >
        <Menu aria-hidden="true" size={20} />
      </Button>
      <dialog
        ref={dialog}
        className="mobile-sidebar"
        aria-label={common.navigation}
        onClick={(event) => {
          if (event.currentTarget === event.target) dialog.current?.close();
        }}
      >
        <div className="mobile-sidebar-content">
          <button
            className="drawer-close"
            type="button"
            aria-label={common.closeNavigation}
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" size={20} />
          </button>
          <SidebarNav
            allowedRoutes={allowedRoutes}
            onNavigate={() => dialog.current?.close()}
          />
        </div>
      </dialog>
    </div>
  );
}
