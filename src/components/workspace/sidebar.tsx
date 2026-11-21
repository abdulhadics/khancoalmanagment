"use client";

import { ChevronDown, Menu, Truck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n";
import { primaryMenu, settingsItem, type Destination } from "./navigation";

const { common } = messages;

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function linkProps(item: Destination) {
    return {
      href: item.href,
      "aria-current": item.href === pathname ? ("page" as const) : undefined,
      onClick: onNavigate,
    };
  }

  return (
    <>
      <Link href="/" className="workspace-brand" onClick={onNavigate}>
        <span className="brand-mark">
          <Truck aria-hidden="true" size={20} strokeWidth={2.2} />
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
              const isCurrent = item.children.some(
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
                      {item.children.map((child) => (
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
        <div className="sidebar-settings">
          <Link className="nav-item" {...linkProps(settingsItem)}>
            <settingsItem.icon aria-hidden="true" size={18} />
            {settingsItem.label}
          </Link>
        </div>
      </nav>
    </>
  );
}

export function DesktopSidebar() {
  return (
    <aside className="desktop-sidebar">
      <SidebarNav />
    </aside>
  );
}

export function MobileSidebar() {
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
          <SidebarNav onNavigate={() => dialog.current?.close()} />
        </div>
      </dialog>
    </div>
  );
}
