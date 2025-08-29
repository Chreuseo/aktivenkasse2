Nutzer
    - Name
    - Vorname
    - Mail
    - keycloak-id
    -> Konto

Rollen (Rechte)
    - Haushaltsplan
    - Konten
    - Hilfskonten
    - Bankkonten
    - Haushalte
    - Transaktionen

    Enum: { Keine / Eigene ansehen / Alle Ansehen / Alle ändern }

Bankkonto
    - Name
    - Bank
    - Kontoinahber
    - IBAN
    - BIC
    -> Konto

Hilfskonto
    - Name
    -> Konto


Konto
    - Betrag
    - Zinsrechnung
    - Typ

Mail
    - Datum
    - Mailadresse
    - Betreff
    - Text
    - Anhang
    -> Nutzer

Transaktion
    - Datum
    - Wertstellung
    - Betreff
    - Referenz
    - Sammeltransaktion
    - Betrag
    - Konto 1 Negativ
    - Konto 1
    - Konto 1 Saldo nach
    - Konto 2 Negativ
    - Konto 2
    - Konto 2 Saldo nach
    -> Beleg

Auslagen
    - Nutzer
    - Datum
    - Wertstellung
    - Betreff
    - Referenz
    - Betrag
    - bearbeitender Nutzer
    - Bearbeitungsdatum
    - Status { offen / angenommen / abgelehnt }
    -> Beleg

Sammeltransaktion
    - Datum
    - Wertstellung
    - Betreff
    -> Beleg

Beleg
    - Datum
    - Name
    - Dateityp
    - blob

Fälligkeiten
    - Konto
    - am
    - bis
    - abgerechnet

Aufgaben
    - Tasktyp
    - lastRun
    - nextRun
    - cron
    - Status
    - createdAt
    - updatedAt
    - payload1
    - payload2

TaskLog
    - Tasktyp
    - Datum Uhrzeit
    - Ergebnis 
