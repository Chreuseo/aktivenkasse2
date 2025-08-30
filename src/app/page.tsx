// src/app/page.tsx
'use client'
import { useEffect, useState } from 'react'

export default function Page(): JSX.Element {
    const [token, setToken] = useState<string | null>(null)
    const [urlToken, setUrlToken] = useState<string | null>(null)
    const [isDark, setIsDark] = useState<boolean>(false)

    useEffect(() => {
        // Theme initialisieren (localStorage oder prefers-color-scheme)
        const storedTheme = localStorage.getItem('theme')
        const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        const initialDark = storedTheme === 'dark' || (!storedTheme && prefersDark)
        setIsDark(initialDark)
        document.documentElement.classList.toggle('dark', initialDark)

        // 1) Prüfe URL-Parameter: ?sessionToken=...
        const params = new URLSearchParams(window.location.search)
        const foundUrlToken = params.get('sessionToken') || params.get('sessiontoken')
        if (foundUrlToken) {
            setUrlToken(foundUrlToken)
            // Not set automatically to allow explicit "Übernehmen" für Tests
        }

        // 2) Prüfe localStorage
        const lsToken = localStorage.getItem('sessionToken')
        if (lsToken) {
            setToken(lsToken)
            return
        }

        // 3) Prüfe Cookies (sessionToken=...)
        const match = document.cookie.match(/(?:^|;\s*)sessionToken=([^;]+)/)
        if (match) {
            setToken(decodeURIComponent(match[1]))
        }
    }, [])

    const setTestToken = () => {
        const test = 'test-session-token-123'
        localStorage.setItem('sessionToken', test)
        document.cookie = 'sessionToken=' + encodeURIComponent(test) + '; path=/'
        setToken(test)
    }

    const clearToken = () => {
        localStorage.removeItem('sessionToken')
        document.cookie = 'sessionToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
        setToken(null)
    }

    const adoptUrlToken = () => {
        if (!urlToken) return
        localStorage.setItem('sessionToken', urlToken)
        document.cookie = 'sessionToken=' + encodeURIComponent(urlToken) + '; path=/'
        setToken(urlToken)
    }

    const toggleTheme = () => {
        const next = !isDark
        setIsDark(next)
        localStorage.setItem('theme', next ? 'dark' : 'light')
        document.documentElement.classList.toggle('dark', next)
    }

    return (
        <div className="max-w-6xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold">Willkommen!</h1>
                <button
                    onClick={toggleTheme}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
                >
                    {isDark ? 'Dark: an' : 'Dark: aus'}
                </button>
            </div>

            <p>Das ist eine Demo-Seite mit responsive Navigation.</p>

            <div className="mt-6 p-4 border rounded bg-gray-50 dark:bg-gray-800">
                <strong className="block mb-2">SessionToken (Test):</strong>

                {urlToken && (
                    <div className="mb-3">
                        <div className="text-sm mb-2">Token in URL erkannt:</div>
                        <code className="break-all bg-white dark:bg-gray-900 p-2 rounded shadow-sm block mb-2">{urlToken}</code>
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={adoptUrlToken}
                                className="px-3 py-1 bg-green-600 text-white rounded"
                            >
                                Token aus URL übernehmen
                            </button>
                            <button
                                onClick={() => {
                                    navigator.clipboard?.writeText(urlToken)
                                }}
                                className="px-3 py-1 bg-blue-600 text-white rounded"
                            >
                                Kopieren
                            </button>
                        </div>
                    </div>
                )}

                <div className="mb-3">
                    {token ? (
                        <code className="break-all bg-white dark:bg-gray-900 p-2 rounded shadow-sm">{token}</code>
                    ) : (
                        <span>Kein SessionToken gefunden.</span>
                    )}
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={setTestToken}
                        className="px-3 py-1 bg-blue-600 text-white rounded"
                    >
                        Test-Token setzen
                    </button>
                    <button
                        onClick={clearToken}
                        className="px-3 py-1 bg-gray-300 rounded"
                    >
                        Token löschen
                    </button>
                </div>
            </div>
        </div>
    )
}