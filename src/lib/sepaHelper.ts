// sepaHelper.ts
export class SEPAHelper {
    // Wandelt Buchstaben in Zahlen gemäß IBAN (A=10, ..., Z=35)
    private static charToNumber(char: string): string {
        const code = char.toUpperCase().charCodeAt(0);
        if (code >= 65 && code <= 90) { // A-Z
            return (code - 55).toString(); // 'A' -> '10'
        } else if (code >= 48 && code <= 57) { // 0-9
            return char;
        }
        throw new Error(`Invalid character: ${char}`);
    }

    private static mod97(ibanNumeric: string): number {
        // Modulo 97 rechnen mit Teilstrings (max. 9 Stellen), damit kein Überlauf entsteht
        let remainder = 0;
        for (let i = 0; i < ibanNumeric.length; i += 9) {
            const part = remainder.toString() + ibanNumeric.substr(i, 9);
            remainder = parseInt(part, 10) % 97;
        }
        return remainder;
    }

    // Async falls z.B. Prüfung gegen DB gewünscht
    static async validateIban(iban: string | null): Promise<boolean> {
        if (!iban) return false;
        const ibanTrimmed = iban.replace(/\s+/g, ''); // Leerzeichen entfernen

        // Länder-Code (Buchstaben vorne)
        const match = ibanTrimmed.match(/^([A-Za-z]+)(\d{2})([A-Za-z0-9]+)$/);
        if (!match) return false;

        const [, country, checkDigits, rest] = match;

        // Rearrangement für IBAN-Prüfung: alles hinter Ländercode+Prüfziffer + Ländercode + Prüfziffer
        const toCheck = rest + country + checkDigits;

        // Buchstaben zu Zahlen wandeln
        let numericIban = '';
        for (const char of toCheck) {
            numericIban += SEPAHelper.charToNumber(char);
        }

        // Modulo 97 - Überlauf vermeiden
        const isValid = SEPAHelper.mod97(numericIban) === 1;
        return isValid;
    }
}
