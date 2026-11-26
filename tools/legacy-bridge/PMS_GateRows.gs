// =====================================================================
// 7. PMS GATE ROWS (added for PMS)
// PMS writes its gate-in / gate-out rows into this same ledger, with
// "PMS-PENDING" in the Photo_Merge_Pdf column. Every 5 minutes this timer,
// running as the GATE_IN_OUT_DOCS owner, picks those rows up and does
// what submitGateIn does for its own rows:
//   - copies the row's photos / LR copy into GATE_IN_OUT_DOCS with the
//     portal's names (CXRU1040451_Left_Side, ...) and puts those links
//     back into the row,
//   - builds Inspection_<container>.pdf and writes its link into the row,
//   - sends the same notification email.
// It never writes IMS or Container_Repository (PMS handles those).
// A row is claimed before work starts, so it is never processed twice.
//
// SETUP: run setupPmsGateTrigger() ONCE from the editor, logged in as
// the GATE_IN_OUT_DOCS owner (the timer runs as whoever installs it).
// =====================================================================

const PMS_PENDING = "PMS-PENDING";
const PMS_WORKING = "PMS-PROCESSING";
const PMS_NOTIFY_RECIPIENTS = "shivani.dhall@crystalgroup.in,alok.jhawar@crystalgroup.in,mansi.agarwal@crystalgroup.in,pushpa.shetty@crystalgroup.in,auditor@crystalgroup.in";
const PMS_PHOTO_NAMES = ["Left_Side", "Right_Side", "Back_View", "Inside_Front", "Inside_Rear", "Roof", "Floor", "Door_Lock", "Container_Close_up"];

// ⚠️ RUN THIS ONCE MANUALLY (as the GATE_IN_OUT_DOCS owner). Safe to re-run.
function setupPmsGateTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "processPmsGateRows") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("processPmsGateRows").timeBased().everyMinutes(5).create();
  console.log("PMS gate-row timer installed: every 5 minutes.");
}

function processPmsGateRows() {
  const sheet = SpreadsheetApp.openById(CONFIG.LEGACY_SHEET_ID).getSheetByName(CONFIG.LEGACY_SHEET_NAME);
  if (!sheet) return;
  const last = sheet.getLastRow();
  if (last < 2) return;
  const startRow = Math.max(2, last - 150);
  const marks = sheet.getRange(startRow, 26, last - startRow + 1, 1).getValues();
  const started = Date.now();
  for (let i = 0; i < marks.length; i++) {
    if (Date.now() - started > 4 * 60 * 1000) break;
    if (String(marks[i][0]).trim() === PMS_PENDING) processOnePmsRow_(sheet, startRow + i);
  }
}

function pmsFileId_(link) {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(String(link || "")) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(String(link || ""));
  return m ? m[1] : null;
}

// Copies a PMS file into GATE_IN_OUT_DOCS once (a retry reuses the earlier copy).
function pmsCopyIntoFolder_(folder, link, name) {
  const id = pmsFileId_(link);
  if (!id) return null;
  const tag = "pms-source:" + id;
  const same = folder.getFilesByName(name);
  while (same.hasNext()) {
    const x = same.next();
    if (x.getDescription() === tag) return x;
  }
  const copy = DriveApp.getFileById(id).makeCopy(name, folder);
  copy.setDescription(tag);
  return copy;
}

function processOnePmsRow_(sheet, row) {
  const pdfCell = sheet.getRange(row, 26);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    if (String(pdfCell.getValue()).trim() !== PMS_PENDING) return;
    pdfCell.setValue(PMS_WORKING);
  } finally {
    lock.releaseLock();
  }

  const props = PropertiesService.getScriptProperties();
  const failKey = "pmsFail_" + row;
  try {
    const r = sheet.getRange(row, 1, 1, 32).getValues()[0];
    const cNo = String(r[4]).trim();
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const tz = "Asia/Kolkata";
    const dateText = r[3] instanceof Date ? Utilities.formatDate(r[3], tz, "yyyy-MM-dd") : String(r[3]);

    // LR copy (col M) and the 9 photos (cols N..V)
    const lr = pmsCopyIntoFolder_(folder, r[12], `${cNo}_LR_Copy`);
    const photos = PMS_PHOTO_NAMES.map((n, i) => pmsCopyIntoFolder_(folder, r[13 + i], `${cNo}_${n}`));
    // Additional photos (col AC, comma-separated)
    const extraLinks = String(r[28] || "").split(",").map(s => s.trim()).filter(Boolean);
    const extras = extraLinks.map((l, i) => pmsCopyIntoFolder_(folder, l, `${cNo}_Additional_${i + 1}`));

    // Put the GATE_IN_OUT_DOCS links into the row, like the portal's own rows
    sheet.getRange(row, 13, 1, 10).setValues([[
      lr ? lr.getUrl() : r[12],
      ...photos.map((f, i) => (f ? f.getUrl() : r[13 + i]))
    ]]);
    if (extraLinks.length) sheet.getRange(row, 29).setValue(extras.map((f, i) => (f ? f.getUrl() : extraLinks[i])).join(", "));

    // Inspection PDF from the copied images
    const doc = DocumentApp.create(`GateIn_Inspection_${cNo}`);
    const body = doc.getBody();
    body.insertParagraph(0, "Gate-In Inspection Report").setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(`Container: ${cNo} | Status: ${r[2]}`);
    body.appendParagraph(`Date: ${dateText}`);
    body.appendHorizontalRule();
    photos.concat(extras).forEach((f, i) => {
      if (!f) return;
      try {
        const blob = f.getBlob();
        if (String(blob.getContentType()).indexOf("image/") !== 0) return;
        body.appendParagraph(i < PMS_PHOTO_NAMES.length ? PMS_PHOTO_NAMES[i].replace(/_/g, " ") : "Additional Photo").setHeading(DocumentApp.ParagraphHeading.HEADING3);
        const img = body.appendImage(blob);
        const ratio = img.getWidth() / img.getHeight();
        img.setWidth(400);
        img.setHeight(400 / ratio);
      } catch (e) {
        body.appendParagraph("(photo could not be added)");
      }
    });
    doc.saveAndClose();
    const pdf = folder.createFile(doc.getAs(MimeType.PDF)).setName(`Inspection_${cNo}.pdf`);
    DriveApp.getFileById(doc.getId()).setTrashed(true);
    pdfCell.setValue(pdf.getUrl());

    try {
      MailApp.sendEmail({
        to: PMS_NOTIFY_RECIPIENTS,
        subject: `Gate-In Portal: ${r[2]} — ${cNo}`,
        body:
`A new submission has been recorded on the Gate-In Portal (via PMS).

Container No: ${cNo}
Status: ${r[2]}
Date: ${dateText}
Type: ${r[5]}  |  Size: ${r[6]}
Customer: ${r[7]}
Yard Location: ${r[8]}
Transporter: ${r[9]} (${r[10]})  |  Vehicle: ${r[11]}
Remarks: ${r[24]}

Inspection PDF: ${pdf.getUrl()}

Submitted by: ${r[1]}`
      });
    } catch (e) {
      console.error("[PMS ROW] Email failed for row " + row + ": " + e.message);
    }
    props.deleteProperty(failKey);
  } catch (e) {
    const fails = Number(props.getProperty(failKey) || 0) + 1;
    props.setProperty(failKey, String(fails));
    // Retry on the next run; after 3 failures leave a visible note instead.
    pdfCell.setValue(fails >= 3 ? ("PMS-FAILED: " + e.message).substring(0, 200) : PMS_PENDING);
    console.error("[PMS ROW] Row " + row + " failed (" + fails + "): " + e.message);
  }
}
