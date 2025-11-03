"use client";

import React from "react";

/**
 * Hinweis unter Datei-Uploads: zeigt Text und Links zu Adobe Scan (Android/iOS).
 * Sichtbar nur, wenn `visible` true ist.
 */
export default function AttachmentHint({ file }: { file?: File | null }) {
  const isPdf = React.useMemo(() => {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    if (type.includes("pdf")) return true;
    const name = (file.name || "").toLowerCase();
    return name.endsWith(".pdf");
  }, [file]);

  if (!file || isPdf) return null;

  return (
    <div className="message" style={{ marginTop: "0.5rem" }}>
      Belege vorzugsweise komprimiert als pdf (Adobe Scan:&nbsp;
        <a
        href="https://play.google.com/store/apps/details?id=com.adobe.scan.android&hl=de"
        target="_blank"
        rel="noopener noreferrer"
      >
          ➚<u>Android</u>
      </a>
        &nbsp;
        <a
        href="https://apps.apple.com/de/app/adobe-scan-pdf-ocr-scanner/id1199564834"
        target="_blank"
        rel="noopener noreferrer"
      >
          ➚<u>iOS</u>
      </a>
      )
    </div>
  );
}
