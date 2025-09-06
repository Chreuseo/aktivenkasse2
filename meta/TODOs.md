# TODOs

* (n) Haushaltsabschluss
* (n) Mailversand
* (n) Datenexport

So, jetzt implementieren wir bitte eine API-Route, die das Mails senden übernimmt. Lager mir die Maillogik sowie die Texte bitte in einen Service aus, dass ich sowohl diese Mails auch von anderer Stelle verwenden kann, als auch generell andere Mails damit versenden kann.

An Nutzer direkt (ohne Verrechnungskonto) wir gesendet, [env - mail.salutation] [prisma - Vorname] [prisma - Nachname],

Info über Kontostand

optionaler Freitext (fett)

Hinweise Zahlungsinformationen: alle BankAccount, mit payment_method = true.

[env - mail.closing]
[Name des Mailauslösers]

Bei Verrechnungskonto ist der Hinweis darauf noch dabei, dass der Kontostand eines Verrechnungskontos, für das er verantworlich ist betreffend ist.
