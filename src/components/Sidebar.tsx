'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard,
  Upload,
  Library,
  Lightbulb,
  MessageSquare,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/ask', label: 'Ask', icon: MessageSquare },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?';

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <>
      {/* Mobile Header */}
      <div className="mobile-header">
        <button className="menu-toggle" onClick={() => setMobileOpen(true)}>
          <Menu size={24} />
        </button>
        <div className="sidebar-logo">
          <div className="logo-text">Visual<span>Brain</span></div>
        </div>
      </div>

      {/* Overlay */}
      <div
        className={`sidebar-overlay ${mobileOpen ? 'show' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-text">Visual<span>Brain</span></div>
          </div>
          <button
            className="menu-toggle"
            onClick={() => setMobileOpen(false)}
            style={{ display: mobileOpen ? 'block' : 'none', marginLeft: 'auto' }}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card" onClick={handleSignOut} title="Sign out">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{user?.displayName || 'User'}</div>
              <div className="user-email">{user?.email || ''}</div>
            </div>
            <LogOut size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </div>
        </div>
      </aside>
    </>
  );
}
