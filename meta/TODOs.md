# TODOs

* (n) Haushaltsabschluss
* (n) Mailversand
* (n) Datenexport

Baust du mir unter Verwendung der vorhandenen CSS eine Mailsendeseite mit folgendem Design:

Oben ist eine Filterzeile beginnend mit einem Dropdown ( Nutzer | Verrechnungskonto), Kontostand: Dropdown ( kleiner | größer | ungleich | Betrag größer ), Eingabefeld €, Button ( Filtern ). Die Felder sollen responsive auch untereinander angezeigt werden.

Unter der Filterzeile ist ein Eingabefeld (Textarea) Bemerkung (optional): Direkt darunter ein Button Senden.

Darunter ist eine Tabelle " Checkbox | Verrechnungskonto | Name | Mail | Kontostand " mit allen dem Filter entsprechenden konten bzw. bei der Auswahl von Verrechnungskonten entsprechend bei Name dem zugehörigen Verantwortlichen. Verrechnungskonten werden nur angezeigt, wenn es einen Verantwortlichen gibt.

Der Button senden ist disabled, bis erstmal gefiltert wurde, die Tabelle befüllt ist und mindestens eine Zeile per Checkbox angewählt ist. Per Klick auf Senden kann dann an alle angewählten eine Mail ausgelöst werden, aber bitte noch nicht umsetzen, die API für die Mails machen wir gleich danach.
