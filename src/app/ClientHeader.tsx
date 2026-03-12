"use client";
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

type FilterMode = 'Standard' | 'Aktive' | 'Erweitert';

type MenuLink = { type: 'link'; label: string; href: string };
type MenuGroup = { type: 'group'; label: string; children: MenuGroupChild[] };

type MenuGroupChild =
    | { type: 'link'; label: string; href: string }
    | { type: 'group'; label: string; children: { label: string; href: string }[] };

type MenuItem = MenuLink | MenuGroup;

const menu: MenuItem[] = [
    { type: 'link', label: 'Übersicht', href: '/' },
    {
        type: 'group',
        label: 'Finanzen',
        children: [
            {
                type: 'group',
                label: 'Transaktionen',
                children: [
                    { label: 'Übersicht', href: '/transactions/general' },
                    { label: 'Neue Transaktion', href: '/transactions/new' },
                    { label: 'Sammeltransaktion', href: '/transactions/bulk' },
                    { label: 'Letzte Transaktionen', href: '/transactions/recent' },
                    { label: 'Künftige Transaktionen', href: '/transactions/future' },
                    { label: 'Belegupload', href: '/attachments/upload' },
                ],
            },
            {
                type: 'group',
                label: 'Auslagen',
                children: [
                    { label: 'Auslage erfassen', href: '/advances/new' },
                    { label: 'Auslagenübersicht', href: '/advances' },
                ],
            },
            {
                type: 'group',
                label: 'Rückstellungen',
                children: [
                    { label: 'Übersicht', href: '/allowances/all' },
                    { label: 'Neue Rückstellung', href: '/allowances/new' },
                    { label: 'Rückstellung erstatten', href: '/allowances/return' },
                ],
            },
            {
                type: 'group',
                label: 'Budget/Haushalt',
                children: [
                    { label: 'Übersicht', href: '/budget-plan' },
                    { label: 'Neuer Plan', href: '/budget-plan/new' },
                    { label: 'Haushaltsabschluss', href: '/budget-plan/finalization' },
                ]
            },
        ],
    },
    {
        type: 'group',
        label: 'Konten',
        children: [
            {
                type: 'group',
                label: 'Bankkonten',
                children: [
                    { label: 'Übersicht', href: '/bank-accounts' },
                    { label: 'Neues Bankkonto', href: '/bank-accounts/new' },
                ],
            },
            {
                type: 'group',
                label: 'Verrechnungskonten',
                children: [
                    { label: 'Übersicht', href: '/clearing-accounts' },
                    { label: 'Neues Verrechnungskonto', href: '/clearing-accounts/new' },
                    { label: 'Funktionen', href: '/clearing-accounts/functions' },
                ],
            },
            {
                type: 'group',
                label: 'Benutzer',
                children: [
                    { label: 'Übersicht', href: '/users' },
                    { label: 'Neuer Benutzer', href: '/users/new' },
                    { label: 'Rollen', href: '/users/roles' },
                    { label: 'Keycloak-Import', href: '/users/keycloak-import' },
                    { label: 'Deaktivierte Benutzer', href: '/users/deactivated' },
                ],
            },
        ],
    },
    {
        type: 'group',
        label: 'Prozesse & Automatisierung',
        children: [
            {
                type: 'group',
                label: 'Zahlungen',
                children: [{ label: 'SEPA-XML', href: '/processes/sepa-xml' }],
            },
            {
                type: 'group',
                label: 'Mail',
                children: [
                    { label: 'Mailversand', href: '/processes/mail' },
                    { label: 'Mail-Log', href: '/processes/mail-log' },
                ],
            },
            {
                type: 'group',
                label: 'Zinsen',
                children: [{ label: 'Zinsrechnung', href: '/interests' }],
            },
            {
                type: 'group',
                label: 'Spenden/Zuwendungen',
                children: [
                    { label: 'Zuwendungsbescheide', href: '/processes/donations' },
                    { label: 'Zuwendungsbescheid erstellen', href: '/processes/donations/create' },
                ],
            },
            {
                type: 'group',
                label: 'Daten',
                children: [
                    { label: 'Daten-Export', href: '/processes/export' },
                    { label: 'Nachrechenaufgabe', href: '/processes/recalculate' },
                ],
            },
        ],
    },
    {
        type: 'group',
        label: 'Mein Bereich',
        children: [
            { type: 'link', label: 'Übersicht', href: '/account' },
            { type: 'link', label: 'Mein Konto', href: '/account/me' },
            { type: 'link', label: 'Meine Auslagen', href: '/advances/mine' },
            { type: 'link', label: 'Auslage erfassen', href: '/advances/new' },
            { type: 'link', label: 'Meine Spenden', href: '/account/donations' },
            { type: 'link', label: 'Abmelden', href: '/api/auth/signout' },
        ],
    },
];

export default function ClientHeader() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Single-open state:
    // - openTop: welches Top-Level-Menü ist offen (nur für type=group)
    // - openSub: welches Submenü (Ebene 2) ist offen (nur wenn es wieder eine group ist)
    const [openTop, setOpenTop] = useState<string | null>(null);
    const [openSub, setOpenSub] = useState<string | null>(null);

    const [filterMode, setFilterMode] = useState<FilterMode>('Standard');
    const [webTitle, setWebTitle] = useState<string>("");

    const headerRef = useRef<HTMLElement | null>(null);

    const closeMenus = () => {
        setOpenTop(null);
        setOpenSub(null);
        setMobileMenuOpen(false);
    };

    const handleLinkClick = () => {
        closeMenus();
    };

    // Filter-Auswahl aus localStorage laden
    useEffect(() => {
        try {
            const saved = typeof window !== 'undefined' ? window.localStorage.getItem('headerFilterMode') : null;
            if (saved === 'Standard' || saved === 'Aktive' || saved === 'Erweitert') {
                setFilterMode(saved);
            }
        } catch {
            // ignore
        }
    }, []);

    // Filter-Auswahl speichern
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('headerFilterMode', filterMode);
            }
        } catch {
            // ignore
        }
    }, [filterMode]);

    // Firmenname + Web-Titel zur Laufzeit laden
    useEffect(() => {
        let cancelled = false;
        async function loadPublicConfig() {
            try {
                const res = await fetch('/api/public-config', { cache: 'no-store' });
                const json = res.ok ? await res.json() : null;
                if (cancelled) return;
                setWebTitle(String(json?.webTitle || ''));
            } catch {
                if (!cancelled) {
                    setWebTitle(String((process.env as any).NEXT_PUBLIC_WEB_TITLE || ''));
                }
            }
        }
        loadPublicConfig();
        return () => {
            cancelled = true;
        };
    }, []);

    // Optional: Klick außerhalb schließt Menüs (Desktop + Mobile)
    useEffect(() => {
        function onPointerDown(e: PointerEvent) {
            const el = headerRef.current;
            if (!el) return;
            if (!el.contains(e.target as Node)) {
                setOpenTop(null);
                setOpenSub(null);
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('pointerdown', onPointerDown);
            return () => window.removeEventListener('pointerdown', onPointerDown);
        }
    }, []);

    // Welche Menüpunkte je Modus angezeigt werden
    const menuToRender: MenuItem[] = (() => {
        switch (filterMode) {
            case 'Aktive':
                return menu.filter(i =>
                    (i.type === 'link' && i.label === 'Übersicht') ||
                    (i.type === 'group' && ['Finanzen', 'Konten', 'Budget/Haushalt', 'Mein Bereich'].includes(i.label))
                );
            case 'Erweitert':
                return menu;
            case 'Standard':
            default:
                return menu.filter(i =>
                    (i.type === 'group' && ['Konten', 'Mein Bereich'].includes(i.label))
                );
        }
    })();

    const toggleTop = (label: string) => {
        setOpenSub(null);
        setOpenTop(prev => (prev === label ? null : label));
    };

    const toggleSub = (label: string) => {
        setOpenSub(prev => (prev === label ? null : label));
    };

    return (
        <header ref={headerRef} className="bg-gray-800 text-white sticky top-0 z-100">
            <nav className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
                <div className="text-xl font-bold">{webTitle || ""}</div>

                {/* Desktop Navigation */}
                <ul className="hidden md:flex space-x-6">
                    {menuToRender.map((item) => {
                        if (item.type === 'link') {
                            return (
                                <li key={item.href} className="relative">
                                    <Link href={item.href} onClick={handleLinkClick} className="flex items-center space-x-1 hover:underline">
                                        <span>{item.label}</span>
                                    </Link>
                                </li>
                            );
                        }

                        const topOpen = openTop === item.label;

                        return (
                            <li key={item.label} className="relative">
                                <button
                                    className="flex items-center space-x-1"
                                    onClick={() => toggleTop(item.label)}
                                    aria-haspopup="menu"
                                    aria-expanded={topOpen}
                                >
                                    <span>{item.label}</span>
                                    <span className="transition-transform">{topOpen ? '▲' : '▼'}</span>
                                </button>

                                {/* Ebene 2: Dropdown */}
                                <ul
                                    className={`absolute left-0 mt-2 w-64 bg-gray-700 rounded shadow-lg py-2 z-110 ${topOpen ? 'block' : 'hidden'}`}
                                    role="menu"
                                >
                                    {item.children.map((child) => {
                                        if (child.type === 'link') {
                                            return (
                                                <li key={child.href} role="none">
                                                    <Link
                                                        href={child.href}
                                                        onClick={handleLinkClick}
                                                        className="block w-full px-4 py-2 hover:bg-gray-600"
                                                        role="menuitem"
                                                    >
                                                        {child.label}
                                                    </Link>
                                                </li>
                                            );
                                        }

                                        const subOpen = openSub === child.label;
                                        return (
                                            <li key={child.label} className="relative" role="none">
                                                <button
                                                    className="flex w-full items-center justify-between px-4 py-2 hover:bg-gray-600"
                                                    onClick={() => toggleSub(child.label)}
                                                    aria-haspopup="menu"
                                                    aria-expanded={subOpen}
                                                >
                                                    <span>{child.label}</span>
                                                    <span className="ml-2">{subOpen ? '◀' : '▶'}</span>
                                                </button>

                                                {/* Ebene 3: Flyout nach rechts */}
                                                <ul
                                                    className={`absolute top-0 left-full ml-1 w-72 bg-gray-700 rounded shadow-lg py-2 z-120 ${subOpen ? 'block' : 'hidden'}`}
                                                    role="menu"
                                                >
                                                    {child.children.map((link) => (
                                                        <li key={link.href} role="none">
                                                            <Link
                                                                href={link.href}
                                                                onClick={handleLinkClick}
                                                                className="block w-full px-4 py-2 hover:bg-gray-600"
                                                                role="menuitem"
                                                            >
                                                                {link.label}
                                                            </Link>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        );
                    })}
                </ul>

                {/* Rechts im Desktop-Header: Auswahl der Ansicht */}
                <div className="hidden md:flex items-center gap-2">
                    <label htmlFor="header-filter" className="text-sm text-gray-300">Ansicht</label>
                    <select
                        id="header-filter"
                        className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-sm"
                        value={filterMode}
                        onChange={(e) => {
                            setFilterMode(e.target.value as FilterMode);
                            setOpenTop(null);
                            setOpenSub(null);
                        }}
                        aria-label="Header-Ansicht auswählen"
                    >
                        <option value="Standard">Standard</option>
                        <option value="Aktive">Aktive</option>
                        <option value="Erweitert">Erweitert</option>
                    </select>
                </div>

                {/* Mobile Hamburger */}
                <div className="md:hidden">
                    <button
                        onClick={() => {
                            setMobileMenuOpen(!mobileMenuOpen);
                            setOpenTop(null);
                            setOpenSub(null);
                        }}
                        aria-label="Menü öffnen/schließen"
                    >
                        ☰
                    </button>
                </div>
            </nav>

            {/* Mobile Navigation (Accordion, 3 Ebenen) */}
            <div
                className={`md:hidden bg-gray-800 text-white fixed left-0 right-0 top-16 z-100 kc-dropdown-scroll ${mobileMenuOpen ? 'block' : 'hidden'}`}
            >
                <ul className="flex flex-col space-y-2 p-4">
                    {menuToRender.map((item) => {
                        if (item.type === 'link') {
                            return (
                                <li key={item.href}>
                                    <Link href={item.href} onClick={handleLinkClick} className="block w-full px-2 py-2 hover:bg-gray-700 rounded">
                                        {item.label}
                                    </Link>
                                </li>
                            );
                        }

                        const topOpen = openTop === item.label;

                        return (
                            <li key={item.label}>
                                <button
                                    className="flex justify-between w-full px-2 py-2 hover:bg-gray-700 rounded"
                                    onClick={() => toggleTop(item.label)}
                                    aria-expanded={topOpen}
                                >
                                    {item.label} <span>{topOpen ? '▲' : '▼'}</span>
                                </button>

                                {topOpen && (
                                    <ul className="pl-3 mt-1 space-y-1">
                                        {item.children.map((child) => {
                                            if (child.type === 'link') {
                                                return (
                                                    <li key={child.href}>
                                                        <Link
                                                            href={child.href}
                                                            onClick={handleLinkClick}
                                                            className="block w-full px-2 py-2 hover:bg-gray-700 rounded"
                                                        >
                                                            {child.label}
                                                        </Link>
                                                    </li>
                                                );
                                            }

                                            const subOpen = openSub === child.label;
                                            return (
                                                <li key={child.label}>
                                                    <button
                                                        className="flex justify-between w-full px-2 py-2 hover:bg-gray-700 rounded"
                                                        onClick={() => toggleSub(child.label)}
                                                        aria-expanded={subOpen}
                                                    >
                                                        {child.label} <span>{subOpen ? '▲' : '▼'}</span>
                                                    </button>

                                                    {subOpen && (
                                                        <ul className="pl-3 mt-1">
                                                            {child.children.map((link) => (
                                                                <li key={link.href}>
                                                                    <Link
                                                                        href={link.href}
                                                                        onClick={handleLinkClick}
                                                                        className="block w-full px-2 py-2 hover:bg-gray-700 rounded"
                                                                    >
                                                                        {link.label}
                                                                    </Link>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* Unten im mobilen Menü: Auswahl der Ansicht */}
                <div className="p-4 border-t border-gray-700 flex items-center justify-between gap-3">
                    <label htmlFor="header-filter-mobile" className="text-sm text-gray-300">Ansicht</label>
                    <select
                        id="header-filter-mobile"
                        className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-sm w-40"
                        value={filterMode}
                        onChange={(e) => {
                            setFilterMode(e.target.value as FilterMode);
                            setOpenTop(null);
                            setOpenSub(null);
                        }}
                        aria-label="Header-Ansicht auswählen (mobil)"
                    >
                        <option value="Standard">Standard</option>
                        <option value="Aktive">Aktive</option>
                        <option value="Erweitert">Erweitert</option>
                    </select>
                </div>
            </div>
        </header>
    );
}