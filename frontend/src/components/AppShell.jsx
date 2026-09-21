import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { CalendarDays, MessageCircle, Images, Heart, LogOut } from "lucide-react";
import { useSpace } from "@/context/SpaceContext";
import { toast } from "sonner";

const tabs = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays, testid: "nav-tab-calendar" },
  { to: "/chat", label: "Chat", icon: MessageCircle, testid: "nav-tab-chat" },
  { to: "/gallery", label: "Gallery", icon: Images, testid: "nav-tab-gallery" },
];

export default function AppShell() {
  const { code, disconnect } = useSpace();

  return (
    <div className="min-h-screen bg-linen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-linen/80 backdrop-blur-xl border-b border-oatline">
        <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-terra flex items-center justify-center">
              <Heart className="h-5 w-5 text-white" fill="white" />
            </div>
            <span className="font-heading text-xl font-bold text-espresso">We2gether</span>
          </div>
          <div className="flex items-center gap-3">
            <span
              data-testid="pairing-status-badge"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-oat text-espresso text-sm font-semibold tracking-wide"
            >
              <span className="h-2 w-2 rounded-full bg-sage animate-pulse" />
              {code}
            </span>
            <button
              data-testid="disconnect-button"
              onClick={() => {
                disconnect();
                toast("Disconnected from your space");
              }}
              className="p-2 rounded-lg text-espresso/50 hover:text-terra hover:bg-oat transition-colors"
              title="Leave space"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Desktop tab bar */}
      <nav className="hidden sm:block border-b border-oatline bg-white/50">
        <div className="max-w-5xl mx-auto px-5 flex gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={t.testid}
              className={({ isActive }) =>
                `flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                  isActive
                    ? "border-terra text-terra"
                    : "border-transparent text-espresso/50 hover:text-espresso"
                }`
              }
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-5 py-5 pb-28 sm:pb-8">
        <Outlet />
      </main>

      {/* Mobile floating nav */}
      <nav className="sm:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
        <div className="flex items-center gap-1 bg-white/90 backdrop-blur-xl border border-oatline rounded-full px-2 py-2 shadow-xl shadow-espresso/10">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={`${t.testid}-mobile`}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  isActive ? "bg-terra text-white" : "text-espresso/50"
                }`
              }
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
