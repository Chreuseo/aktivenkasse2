"use client";
import Link from 'next/link';
import { useState } from 'react';

type SubmenuLink = { label: string; href: string };
type MenuKey = 'Allgemein' | 'Benutzer' | 'Bankkonten' | 'Verrechnungskonten' | 'Haushaltsplan' | 'Transaktionen' | 'Prozesse' | 'Konto';

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
        { label: 'Keycloak-Import', href: '/users/keycloak-import' }
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
        { label: 'Auslage erfassen', href: '/transactions/expense/new' },
        { label: 'Auslagenübersicht', href: '/transactions/expenses' },
        { label: 'Letze Transaktionen', href: '/transactions/recent' },
        { label: 'Neue Transaktion', href: '/transactions/new' },
        { label: 'Sammeltransaktionen', href: '/transactions/bulk' }
        ],
    Prozesse: [
        { label: 'Mailversand', href: '/processes/mail' },
        { label: 'Daten-Export', href: '/processes/export' },
        { label: 'geplante Aufgaben', href: '/processes/scheduled-tasks' }
        ],
    Konto: [
        { label: 'Übersicht', href: '/account' },
        { label: 'Einstellungen', href: '/account/settings' },
        { label: 'Abmelden', href: '/api/auth/signout' }
        ],
};

export default function ClientHeader() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [submenuOpen, setSubmenuOpen] = useState<{ [key in MenuKey]?: boolean }>({});

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

    return (
        <header className="bg-gray-800 text-white">
            <nav className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
                <div className="text-xl font-bold">Aktivenkasse { process.env.NEXT_PUBLIC_COMPANY }</div>
                <ul className="hidden md:flex space-x-6">
                    {menuItems.map(item => (
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
                <div className="md:hidden">
                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                        ☰
                    </button>
                </div>
            </nav>
            <div className={`md:hidden bg-gray-800 text-white ${mobileMenuOpen ? 'block' : 'hidden'}`}>
                <ul className="flex flex-col space-y-2 p-4">
                    {menuItems.map(item => (
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
            </div>
        </header>
    );
}