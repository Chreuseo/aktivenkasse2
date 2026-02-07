// Minimaler SEPA Direct Debit XML (pain.008) Generator.
// Fokus: Einzug (CORE), einmalige Sequenz (OOFF) pro Auftrag.

export type SepaXmlDebtor = {
  name: string;
  iban: string;
  bic?: string | null;
  mandateId: string;
  mandateDate: Date;
  amount: number; // > 0
  remittanceInformation: string;
};

export type SepaXmlInput = {
  messageId: string;
  creationDateTime: Date;
  collectionDate: Date;
  creditorName: string;
  creditorId: string;
  initiatingPartyName: string;
  creditorIban: string;
  creditorBic?: string | null;
  paymentInfoId?: string;
  batchBooking?: boolean;
  debtors: SepaXmlDebtor[];
};

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatDate(d: Date): string {
  // YYYY-MM-DD
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(d: Date): string {
  // ISO ohne Millis (bank-freundlich)
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sumAmount(debtors: SepaXmlDebtor[]): number {
  return debtors.reduce((acc, it) => acc + Number(it.amount || 0), 0);
}

function formatAmountEur(n: number): string {
  // SEPA verlangt Punkt als Dezimaltrenner
  return Number(n).toFixed(2);
}

export function buildSepaPain008Xml(input: SepaXmlInput): string {
  if (!input.debtors?.length) throw new Error("Keine SEPA-Positionen");

  for (const d of input.debtors) {
    if (!(Number(d.amount) > 0)) throw new Error(`Ungültiger Betrag für ${d.name}`);
    if (!d.iban?.trim()) throw new Error(`IBAN fehlt für ${d.name}`);
    if (!d.mandateId?.trim()) throw new Error(`Mandatsreferenz fehlt für ${d.name}`);
    if (!Number.isFinite(d.mandateDate?.getTime?.())) {
      throw new Error(`Mandatsdatum ungültig für ${d.name}`);
    }
    if (!d.remittanceInformation?.trim()) throw new Error(`Verwendungszweck fehlt für ${d.name}`);
  }

  const nbOfTxs = input.debtors.length;
  const ctrlSum = sumAmount(input.debtors);

  const pmtInfId = input.paymentInfoId ?? input.messageId;
  const batch = input.batchBooking ?? true;

  // pain.008.001.02 (weit verbreitet)
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(input.messageId)}</MsgId>
      <CreDtTm>${esc(formatDateTime(input.creationDateTime))}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${esc(formatAmountEur(ctrlSum))}</CtrlSum>
      <InitgPty>
        <Nm>${esc(input.initiatingPartyName)}</Nm>
      </InitgPty>
    </GrpHdr>

    <PmtInf>
      <PmtInfId>${esc(pmtInfId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>${batch ? "true" : "false"}</BtchBookg>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${esc(formatAmountEur(ctrlSum))}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>CORE</Cd></LclInstrm>
        <SeqTp>OOFF</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${esc(formatDate(input.collectionDate))}</ReqdColltnDt>

      <Cdtr>
        <Nm>${esc(input.creditorName)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id><IBAN>${esc(input.creditorIban)}</IBAN></Id>
      </CdtrAcct>
      ${input.creditorBic ? `<CdtrAgt><FinInstnId><BIC>${esc(String(input.creditorBic))}</BIC></FinInstnId></CdtrAgt>` : ""}
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${esc(input.creditorId)}</Id>
              <SchmeNm><Prtry>SEPA</Prtry></SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>

      ${input.debtors
        .map((d, idx) => {
          const endToEnd = `${input.messageId}-${idx + 1}`;
          return `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(endToEnd)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${esc(formatAmountEur(d.amount))}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${esc(d.mandateId)}</MndtId>
            <DtOfSgntr>${esc(formatDate(d.mandateDate))}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        ${d.bic ? `<DbtrAgt><FinInstnId><BIC>${esc(String(d.bic))}</BIC></FinInstnId></DbtrAgt>` : ""}
        <Dbtr><Nm>${esc(d.name)}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${esc(d.iban)}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(d.remittanceInformation)}</Ustrd></RmtInf>
      </DrctDbtTxInf>`;
        })
        .join("\n")}

    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>
`;
}
