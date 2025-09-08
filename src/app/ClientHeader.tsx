"use client";
import Link from 'next/link';
import { useState, useEffect } from 'react';

type SubmenuLink = { label: string; href: string };
type MenuKey = 'Allgemein' | 'Benutzer' | 'Bankkonten' | 'Verrechnungskonten' | 'Haushaltsplan' | 'Transaktionen' | 'Prozesse' | 'Konto';
type FilterMode = 'Standard' | 'Aktive' | 'Erweitert';

const menuItems: MenuKey[] = ['Allgemein', 'Benutzer', 'Bankkonten', 'Verrechnungskonten', 'Haushaltsplan', 'Transaktionen', 'Prozesse', 'Konto'];
const submenuLinks: Record<MenuKey, SubmenuLink[]> = {
    Allgemein: [
        { label: 'Übersicht', href: '/' },
        { label: 'Transaktionen', href: '/transactions/general' }
    ],
    Benutzer: [
        { label: 'Übersicht', href: '/users' },
        { label: 'Neuer Benutzer', href: '/users/new' },
        { label: 'Rollen', href: '/users/roles' },
        { label: 'Keycloak-Import', href: '/users/keycloak-import' },
        { label: 'Deaktivierte Benutzer', href: '/users/deactivated' }
    ],
    Bankkonten: [
        { label: 'Übersicht', href: '/bank-accounts' },
        { label: 'Neues Bankkonto', href: '/bank-accounts/new' }
    ],
    Verrechnungskonten: [
        { label: 'Übersicht', href: '/clearing-accounts' },
        { label: 'Neues Verrechnungskonto', href: '/clearing-accounts/new' },
        { label: 'Funktionen', href: '/clearing-accounts/functions' }
    ],
    Haushaltsplan: [
        { label: 'Übersicht', href: '/budget-plan' },
        { label: 'Neuer Plan', href: '/budget-plan/new' },
        { label: 'Haushaltsabschluss', href: '/budget-plan/finalization' },
        ],
    Transaktionen: [
        { label: 'Auslage erfassen', href: '/advances/new' },
        { label: 'Meine Auslagen', href: '/advances/mine' },
        { label: 'Auslagenübersicht', href: '/advances' },
        { label: 'Letze Transaktionen', href: '/transactions/recent' },
        { label: 'Neue Transaktion', href: '/transactions/new' },
        { label: 'Sammeltransaktion', href: '/transactions/bulk' }
        ],
    Prozesse: [
        { label: 'Mailversand', href: '/processes/mail' },
        { label: 'Mail-Log', href: '/processes/mail-log' },
        { label: 'Daten-Export', href: '/processes/export' }
        ],
    Konto: [
        { label: 'Übersicht', href: '/account' },
        { label: 'Meine Auslagen', href: '/advances/mine' },
        { label: 'Mein Konto', href: '/account/me' },
        { label: 'Abmelden', href: '/api/auth/signout' }
        ],
};

export default function ClientHeader() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [submenuOpen, setSubmenuOpen] = useState<{ [key in MenuKey]?: boolean }>({});
    const [filterMode, setFilterMode] = useState<FilterMode>('Standard');
    const [company, setCompany] = useState<string>("");

    const toggleSubmenu = (key: MenuKey) => {
        setSubmenuOpen(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Funktion zum Schließen aller Menüs
    const closeMenus = () => {
        setSubmenuOpen({});
        setMobileMenuOpen(false);
    };

    // Handler für Link-Klicks
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

    // Firmenname zur Laufzeit laden
    useEffect(() => {
        let cancelled = false;
        async function loadCompany() {
            try {
                const res = await fetch('/api/public-config', { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                const json = await res.json();
                if (!cancelled) setCompany(String(json?.company || ''));
            } catch {
                if (!cancelled) setCompany(String(process.env.NEXT_PUBLIC_COMPANY || ''));
            }
        }
        loadCompany();
        return () => { cancelled = true; };
    }, []);

    // Welche Menüpunkte je Modus angezeigt werden
    const itemsToRender: MenuKey[] = (() => {
        switch (filterMode) {
            case 'Aktive':
                return ['Allgemein', 'Verrechnungskonten', 'Transaktionen', 'Konto'];
            case 'Erweitert':
                return menuItems;
            case 'Standard':
            default:
                return ['Transaktionen', 'Verrechnungskonten', 'Konto'];
        }
    })();

    return (
        <header className="bg-gray-800 text-white">
            <nav className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
                <div className="text-xl font-bold">Aktivenkasse { company }</div>
                <ul className="hidden md:flex space-x-6">
                    {itemsToRender.map(item => (
                        <li key={item} className="relative group">
                            <button
                                className="flex items-center space-x-1"
                                onClick={() => toggleSubmenu(item)}
                            >
                                <span>{item}</span>
                                <span className="transition-transform group-hover:rotate-180">▼</span>
                            </button>
                            <ul className={`absolute menu-dropdown ${submenuOpen[item] ? 'block' : 'hidden'} ...`}>
                                {submenuLinks[item]?.map((link: SubmenuLink) => (
                                    <li key={link.href} className="px-4 py-2 hover:bg-gray-600">
                                        <Link href={link.href} onClick={handleLinkClick}>{link.label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ul>
                {/* Rechts im Desktop-Header: Auswahl der Ansicht */}
                <div className="hidden md:flex items-center gap-2">
                    <label htmlFor="header-filter" className="text-sm text-gray-300">Ansicht</label>
                    <select
                        id="header-filter"
                        className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-sm"
                        value={filterMode}
                        onChange={(e) => { setFilterMode(e.target.value as FilterMode); closeMenus(); }}
                        aria-label="Header-Ansicht auswählen"
                    >
                        <option value="Standard">Standard</option>
                        <option value="Aktive">Aktive</option>
                        <option value="Erweitert">Erweitert</option>
                    </select>
                </div>
                <div className="md:hidden">
                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                        ☰
                    </button>
                </div>
            </nav>
            <div className={`md:hidden bg-gray-800 text-white ${mobileMenuOpen ? 'block' : 'hidden'}`}>
                <ul className="flex flex-col space-y-2 p-4">
                    {itemsToRender.map(item => (
                        <li key={item}>
                            <button className="flex justify-between w-full" onClick={() => toggleSubmenu(item)}>
                                {item} <span>{submenuOpen[item] ? '▲' : '▼'}</span>
                            </button>
                            {submenuOpen[item] && (
                                <ul className="pl-4 mt-1">
                                    {submenuLinks[item]?.map((link: SubmenuLink) => (
                                        <li key={link.href} className="px-4 py-2 hover:bg-gray-600">
                                            <Link href={link.href} onClick={handleLinkClick}>{link.label}</Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
                {/* Unten im mobilen Menü: Auswahl der Ansicht */}
                <div className="p-4 border-t border-gray-700 flex items-center justify-between gap-3">
                    <label htmlFor="header-filter-mobile" className="text-sm text-gray-300">Ansicht</label>
                    <select
                        id="header-filter-mobile"
                        className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-sm w-40"
                        value={filterMode}
                        onChange={(e) => { setFilterMode(e.target.value as FilterMode); closeMenus(); }}
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