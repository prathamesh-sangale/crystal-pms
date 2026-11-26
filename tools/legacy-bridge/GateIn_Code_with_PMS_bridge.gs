// ====================================================================
// 🏢 GATE-IN PORTAL BACKEND: 3-SHEET ARCHITECTURE
// ====================================================================

// ⚠️ SYSTEM CONFIGURATION - EXACT SHEET IDs MAPPED
const CONFIG = {
  // SHEET 1: The Source (Read-only checklist & UI Status)
  REPO_SHEET_ID: "1c1KJtLdULXttMV1F0GSry9om42InJGQXsX2xEQSygIU",

  // SHEET 2: The Ledger (Legacy Form Submissions)
  LEGACY_SHEET_ID: "1J4R3cfEX5FYgo8WqodufCCAzmlcNkpunRDp_jALTKl4",
  LEGACY_SHEET_NAME: "CONTAINER GATE-IN/ GATE-OUT",

  // SHEET 3: The Vault (Master Inventory)
  MASTER_SHEET_ID: "1qgAe0QOx93SRd8isBFCr5o1khnCBX0G2DM42nSuiRFo",
  MASTER_SHEET_NAME: "Master Sheet",

  // 📁 PDF & PHOTO STORAGE
  DRIVE_FOLDER_ID: "1ZgdbdifVvIyi0FzsBTiqRnzes_fbTMa-",

  // SHEET 4: Purchase FMS — pre-existing inspection photos from Container Survey (Stage 3)
  PURCHASE_FMS_SHEET_ID: "1M-2SOUTiYuJqTUVKSNKRVxwL3IOmNPkU8qbXsARI01I",
  PURCHASE_FMS_TAB: "Stage 3"
};

// Normalizes a container number for comparison only (strips spaces, uppercases)
// so "FCIU 4942198" and "FCIU4942198" are treated as the same container.
// Never use this for what gets WRITTEN to a sheet — only for matching.
function normContainerNo(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

// ====================================================================
// 1. ROUTER: Serves the Web App
// ====================================================================
function doGet(e) {
  const indentId = e.parameter.indent || "Unknown";
  const containerNo = e.parameter.container || "Unknown";

  let template = HtmlService.createTemplateFromFile('GateIn_UI');
  template.indentId = indentId;
  template.containerNo = containerNo;

  return template.evaluate()
      .setTitle('Crystal Group - Gate In Portal')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ====================================================================
// 2. FORM AUTO-FETCHER (Reads Sheet 1)
// ====================================================================
function fetchContainerSpecs(indentId, containerNo) {
  try {
    const email = Session.getActiveUser().getEmail() || "";
    const ss = SpreadsheetApp.openById(CONFIG.REPO_SHEET_ID);
    const repo = ss.getSheetByName("Container_Repository");

    let specs = { type: "", size: "", customer: "", email: email };

    if (repo) {
      const data = repo.getDataRange().getValues();
      const h = data[0].map(x => String(x).trim());
      const rId = h.indexOf("Indent_ID");
      const rCno = h.indexOf("Container_Number");

      if (rId > -1 && rCno > -1) {
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][rId]).trim() === indentId && normContainerNo(data[i][rCno]) === normContainerNo(containerNo)) {
             specs.type = h.indexOf("Machinery") > -1 ? data[i][h.indexOf("Machinery")] : "";
             specs.size = h.indexOf("Size") > -1 ? data[i][h.indexOf("Size")] : "";
             specs.customer = h.indexOf("Client_Name") > -1 ? data[i][h.indexOf("Client_Name")] : "Crystal Group";
             break;
          }
        }
      }
    }
    return { success: true, data: specs };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ====================================================================
// 3. MASTER CHECKLIST FETCHER (Reads Sheet 1)
// ====================================================================
function fetchIndentContainers(indentId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.REPO_SHEET_ID);
    const repo = ss.getSheetByName("Container_Repository");
    let containers = [];

    if (repo) {
      const data = repo.getDataRange().getValues();
      const h = data[0].map(x => String(x).trim());
      const rId = h.indexOf("Indent_ID");
      const rCno = h.indexOf("Container_Number");
      const rType = h.indexOf("Machinery");
      const rSize = h.indexOf("Size");
      const rCust = h.indexOf("Client_Name");
      const rStat = h.indexOf("Status");

      if (rId > -1 && rCno > -1) {
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][rId]).trim() === indentId) {
             let cNo = String(data[i][rCno]).trim();
             if (cNo && !cNo.includes("[WIP]") && !cNo.includes("UNASSIGNED")) {
                 containers.push({
                     cNo: cNo,
                     type: rType > -1 ? data[i][rType] : "",
                     size: rSize > -1 ? data[i][rSize] : "",
                     customer: rCust > -1 ? data[i][rCust] : "Crystal Group",
                     status: rStat > -1 ? String(data[i][rStat]).trim() : "Pending"
                 });
             }
          }
        }
      }
    }
    return { success: true, data: containers, email: Session.getActiveUser().getEmail() || "" };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ====================================================================
// 3B. ALL-INDENTS PENDING FETCHER
// Source of truth = Master Sheet (Current = "Stock"). A container is
// "Pending" only if it has NEVER had an "Inward (Gate-In)" row logged
// in the Legacy ledger — i.e. physically in stock but no Gate-In was
// ever filed for it.
// ====================================================================
function fetchAllPendingContainers() {
  try {
    // Step 1: Build the set of container numbers that already have a Gate-In on record
    const extSs = SpreadsheetApp.openById(CONFIG.LEGACY_SHEET_ID);
    const extSheet = extSs.getSheetByName(CONFIG.LEGACY_SHEET_NAME);
    const gatedInSet = {};
    if (extSheet) {
      const extData = extSheet.getDataRange().getValues();
      const extHead = extData[0].map(x => String(x).trim());
      const eStatusIdx = extHead.indexOf("Status");
      const eContainerIdx = extHead.indexOf("Container No");
      if (eStatusIdx > -1 && eContainerIdx > -1) {
        for (let i = 1; i < extData.length; i++) {
          let status = String(extData[i][eStatusIdx]).trim();
          let cNo = normContainerNo(extData[i][eContainerIdx]);
          if (cNo && status === "Inward (Gate-In)") gatedInSet[cNo] = true;
        }
      }
    }

    // Step 2: Scan Master Sheet for Current = "Stock" containers missing from that set
    const mSs = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const mSheet = mSs.getSheetByName(CONFIG.MASTER_SHEET_NAME) || mSs.getSheets()[0];
    const mData = mSheet.getDataRange().getValues();
    const mHead = mData[0].map(x => String(x).trim());

    const cIdx = mHead.indexOf("Container No");
    const tIdx = mHead.indexOf("Product Type");
    const currIdx = mHead.indexOf("Current");
    const depotIdx = mHead.indexOf("Depot");
    const sizeIdx = mHead.indexOf("Size");
    const indentIdx = mHead.indexOf("Ref ID (Indent ID)");

    let containers = [];
    if (cIdx > -1 && currIdx > -1) {
      for (let i = 1; i < mData.length; i++) {
         let cNo = String(mData[i][cIdx]).trim();
         let current = String(mData[i][currIdx]).trim();
         let looksLikeContainer = /^[A-Za-z]{4}\d{6,7}/.test(normContainerNo(cNo));
         if (cNo && looksLikeContainer && current.toUpperCase() === "STOCK" && !gatedInSet[normContainerNo(cNo)]) {
            containers.push({
                cNo: cNo,
                indentId: indentIdx > -1 ? String(mData[i][indentIdx]).trim() : "",
                type: tIdx > -1 ? mData[i][tIdx] : "",
                size: sizeIdx > -1 ? mData[i][sizeIdx] : "",
                customer: depotIdx > -1 ? mData[i][depotIdx] : "",
                status: "Pending"
            });
         }
      }
    }
    return { success: true, data: containers };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ====================================================================
// 3C. EXISTING PHOTO FETCHER
// Looks up a container in Purchase FMS "Stage 3" (Container Survey) and
// returns any already-captured photo links that match our form's fields,
// so staff doesn't have to re-upload photos that already exist.
// Mapping (fixed columns, confirmed by user):
//   S  = CONTAINER BODY PAINT PHOTO - LEFT SIDE   -> Left_Side
//   R  = CONTAINER BODY PAINT PHOTO - RIGHT SIDE  -> Right_Side
//   AB = Door Inside                              -> Inside_Front
//   AC = Back Side View - from Inside             -> Inside_Rear
//   AA = Top View from inside - Roof              -> Roof
//   X  = FLOORING INSIDE - PHOTOS                 -> Floor
//   M  = Photo with Container Number              -> Container_Close_up
// Back_View and Door_Lock have no equivalent in Purchase FMS — they stay
// manual-upload-only.
// ====================================================================
function colLetterToIndex(letter) {
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}

const PURCHASE_FMS_PHOTO_COLS = {
  Left_Side: "S",
  Right_Side: "R",
  Inside_Front: "AB",
  Inside_Rear: "AC",
  Roof: "AA",
  Floor: "X",
  Container_Close_up: "M"
};

function fetchExistingPhotos(containerNo) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PURCHASE_FMS_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PURCHASE_FMS_TAB);
    if (!sheet) return { success: false };

    const data = sheet.getDataRange().getValues();
    const head = data[0].map(x => String(x).trim());
    const cIdx = head.indexOf("CONTAINER NUMBER");
    if (cIdx === -1) return { success: false };

    for (let i = data.length - 1; i > 0; i--) {
      if (normContainerNo(data[i][cIdx]) === normContainerNo(containerNo)) {
        let photos = {};
        Object.keys(PURCHASE_FMS_PHOTO_COLS).forEach(key => {
          let idx = colLetterToIndex(PURCHASE_FMS_PHOTO_COLS[key]);
          let v = String(data[i][idx] || "").trim();
          if (v) photos[key] = v;
        });
        if (Object.keys(photos).length > 0) return { success: true, photos: photos };
        return { success: false };
      }
    }
    return { success: false };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ====================================================================
// 4. THE MASTER PROCESSOR (PDF Engine + 3-Sheet Writes)
// ====================================================================
function submitGateIn(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: "System busy. Try again in 30 seconds." };

  try {
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);

    // --- STEP A: Process Images & Generate PDF ---
    let photoUrls = [];
    let doc = DocumentApp.create(`GateIn_Inspection_${payload.containerNo}_${payload.indentId}`);
    let docBody = doc.getBody();

    docBody.insertParagraph(0, `Gate-In Inspection Report`)
           .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    docBody.appendParagraph(`Container: ${payload.containerNo} | Indent: ${payload.indentId}`);
    docBody.appendParagraph(`Date: ${new Date().toLocaleString()}`);
    docBody.appendHorizontalRule();

    const photoKeys = [
      "Left_Side", "Right_Side", "Back_View", "Inside_Front",
      "Inside_Rear", "Roof", "Floor", "Door_Lock", "Container_Close_up"
    ];

    photoKeys.forEach(key => {
      let url = "";
      if (payload[key] && payload[key].base64) {
        let blob = Utilities.newBlob(Utilities.base64Decode(payload[key].base64), payload[key].mime, `${payload.containerNo}_${key}`);
        let file = folder.createFile(blob);
        url = file.getUrl();
        docBody.appendParagraph(key.replace(/_/g, " ")).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        let img = docBody.appendImage(blob);
        let ratio = img.getWidth() / img.getHeight();
        img.setWidth(400);
        img.setHeight(400 / ratio);
      } else if (payload.existingPhotos && payload.existingPhotos[key]) {
        // Reused from a prior Purchase FMS survey — not re-uploaded, not embedded in this PDF.
        url = payload.existingPhotos[key];
      }
      photoUrls.push(url);
    });

    let additionalUrls = [];
    if (payload.Additional_Photos && payload.Additional_Photos.length > 0) {
       docBody.appendParagraph("Additional Photos").setHeading(DocumentApp.ParagraphHeading.HEADING3);
       payload.Additional_Photos.forEach((photo, index) => {
           let blob = Utilities.newBlob(Utilities.base64Decode(photo.base64), photo.mime, `${payload.containerNo}_Additional_${index + 1}`);
           let file = folder.createFile(blob);
           additionalUrls.push(file.getUrl());

           let img = docBody.appendImage(blob);
           let ratio = img.getWidth() / img.getHeight();
           img.setWidth(400);
           img.setHeight(400 / ratio);
       });
    }

    doc.saveAndClose();
    let pdfBlob = doc.getAs(MimeType.PDF);
    let finalPdf = folder.createFile(pdfBlob).setName(`Inspection_${payload.containerNo}.pdf`);
    let finalPdfUrl = finalPdf.getUrl();
    DriveApp.getFileById(doc.getId()).setTrashed(true);

    let lrCopyUrl = "";
    if (payload.LR_Copy && payload.LR_Copy.base64) {
      let lrBlob = Utilities.newBlob(Utilities.base64Decode(payload.LR_Copy.base64), payload.LR_Copy.mime, `${payload.containerNo}_LR_Copy`);
      lrCopyUrl = folder.createFile(lrBlob).getUrl();
    }

    let ptiVideoUrl = "";
    if (payload.ptiCheck === "Yes" && payload.PTI_Video && payload.PTI_Video.base64) {
      let ptiBlob = Utilities.newBlob(Utilities.base64Decode(payload.PTI_Video.base64), payload.PTI_Video.mime, `${payload.containerNo}_PTI_Video`);
      ptiVideoUrl = folder.createFile(ptiBlob).getUrl();
    }

    // Porta Cabin checklist item photos (optional, one per item)
    let portaCabinPhotoUrls = [];
    if (payload.portaCabinPhotos) {
      Object.keys(payload.portaCabinPhotos).forEach(itemName => {
        let p = payload.portaCabinPhotos[itemName];
        if (p && p.base64) {
          let pBlob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mime, `${payload.containerNo}_PortaCabin_${itemName}`);
          let pUrl = folder.createFile(pBlob).getUrl();
          portaCabinPhotoUrls.push(`${itemName}: ${pUrl}`);
        }
      });
    }
    const portaCabinPhotosStr = portaCabinPhotoUrls.join(", ");

    // --- STEP B: The Ledger Write (Sheet 2) ---
    const timestamp = new Date();
    const dateOnly = Utilities.formatDate(timestamp, "Asia/Kolkata", "dd-MM-yyyy");
    const additionalUrlsStr = additionalUrls.join(", ");

    const externalRow = [
      timestamp, payload.email, payload.status, payload.date,
      payload.containerNo, payload.type, payload.size, payload.customer,
      payload.location, payload.transporterName, payload.transporterNo, payload.vehicleNo,
      lrCopyUrl, ...photoUrls, payload.repairRequired, payload.repairBudget,
      payload.remarks, finalPdfUrl,
      payload.ptiCheck, ptiVideoUrl, additionalUrlsStr,
      payload.yardLocation2, payload.portaCabinChecklist || "", portaCabinPhotosStr
    ];

    const extSs = SpreadsheetApp.openById(CONFIG.LEGACY_SHEET_ID);
    const extSheet = extSs.getSheetByName(CONFIG.LEGACY_SHEET_NAME);
    if (extSheet) extSheet.appendRow(externalRow);

    // --- STEP B.1: Email Notification ---
    try {
      const NOTIFY_RECIPIENTS = "shivani.dhall@crystalgroup.in,alok.jhawar@crystalgroup.in,mansi.agarwal@crystalgroup.in,pushpa.shetty@crystalgroup.in,auditor@crystalgroup.in";
      const subject = `Gate-In Portal: ${payload.status} — ${payload.containerNo}`;
      const body =
`A new submission has been recorded on the Gate-In Portal.

Container No: ${payload.containerNo}
Indent: ${payload.indentId}
Status: ${payload.status}
Date: ${payload.date}
Type: ${payload.type}  |  Size: ${payload.size}
Customer: ${payload.customer}
Yard Location: ${payload.location}
Transporter: ${payload.transporterName} (${payload.transporterNo})  |  Vehicle: ${payload.vehicleNo}
PTI Check: ${payload.ptiCheck}
Repair Required: ${payload.repairRequired}  |  Est. Budget: ${payload.repairBudget}
Remarks: ${payload.remarks}

Inspection PDF: ${finalPdfUrl}

Submitted by: ${payload.email}`;

      MailApp.sendEmail({
        to: NOTIFY_RECIPIENTS,
        subject: subject,
        body: body
      });
    } catch (e) {
      console.error("[EMAIL] Notification failed: " + e.message);
    }

    // 🚦 GATE-OUT vs GATE-IN: the Master Inventory is touched ONLY on a Gate-IN.
    const isGateOut = String(payload.status || "").trim() === "Outward (Gate-Out)";

    // --- STEP C: The Vault Update (Sheet 3 - Strict Double Match) --- GATE-IN ONLY ---
    if (!isGateOut) {
      const mSs = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
      const mSheet = mSs.getSheetByName(CONFIG.MASTER_SHEET_NAME) || mSs.getSheets()[0];
      const mData = mSheet.getDataRange().getValues();
      const mHead = mData[0].map(x => String(x).trim());

      const cIdx = mHead.indexOf("Container No");
      const tIdx = mHead.indexOf("Product Type");

      const statIdx = mHead.indexOf("Status");
      const currIdx = mHead.indexOf("Current");
      const dateIdx = mHead.indexOf("IN STOCK DATE");
      const locIdx = mHead.indexOf("Location");
      const depotIdx = mHead.indexOf("Depot");

      if (cIdx > -1 && tIdx > -1) {
        for (let i = 1; i < mData.length; i++) {
           if (normContainerNo(mData[i][cIdx]) === normContainerNo(payload.containerNo) &&
               String(mData[i][tIdx]).trim() === payload.type) {
              if (statIdx > -1) mSheet.getRange(i+1, statIdx+1).setValue("Stock");
              if (currIdx > -1) mSheet.getRange(i+1, currIdx+1).setValue("Stock");
              if (dateIdx > -1) mSheet.getRange(i+1, dateIdx+1).setValue(dateOnly);
              if (locIdx > -1) mSheet.getRange(i+1, locIdx+1).setValue("JNPT");
              if (depotIdx > -1) mSheet.getRange(i+1, depotIdx+1).setValue("Crystal Yard New");
              break;
           }
        }
      }
    } else {
      console.log("[GATE-OUT] Master Inventory intentionally NOT touched for " + payload.containerNo);
    }

    // --- STEP D: Update Sheet 1 (Container_Repository) ---
    const rSs = SpreadsheetApp.openById(CONFIG.REPO_SHEET_ID);
    const rSheet = rSs.getSheetByName("Container_Repository");
    if (rSheet) {
       const rData = rSheet.getDataRange().getValues();
       const rHead = rData[0].map(x => String(x).trim());
       const rCidx = rHead.indexOf("Container_Number");
       const rSidx = rHead.indexOf("Status");
       if (rCidx > -1 && rSidx > -1) {
         for (let i = 1; i < rData.length; i++) {
           if (normContainerNo(rData[i][rCidx]) === normContainerNo(payload.containerNo)) {
             let repoStatus = (payload.status === "Outward (Gate-Out)") ? "MARKED GATE-OUT" : "MARKED GATE-IN";
             rSheet.getRange(i+1, rSidx+1).setValue(repoStatus);
             break;
           }
         }
       }
    }

    // --- STEP E: THE AUTO-MATH ENGINE & WEBHOOK PING (WITH HEAVY LOGGING) ---
    try {
        if (isGateOut) {
          console.log("[GATE-OUT] Auto-close webhook skipped — pipeline/Master untouched on Gate-Out.");
          return { success: true, pdf: finalPdfUrl };
        }
        SpreadsheetApp.flush();

        const repoData = rSheet.getDataRange().getValues();
        const rHead = repoData[0].map(x => String(x).trim());
        let totalCount = 0;
        let verifiedCount = 0;

        for (let i = 1; i < repoData.length; i++) {
            let rId = String(repoData[i][rHead.indexOf("Indent_ID")]).trim();
            let cNo = String(repoData[i][rHead.indexOf("Container_Number")]).trim();
            let cStat = String(repoData[i][rHead.indexOf("Status")]).trim();

            if (rId === payload.indentId && cNo && !cNo.includes("[WIP]") && !cNo.includes("UNASSIGNED")) {
                totalCount++;
                if (cStat.includes("MARKED") || normContainerNo(cNo) === normContainerNo(payload.containerNo)) {
                    verifiedCount++;
                }
            }
        }

        console.log(`[DEBUG SENDER] Indent: ${payload.indentId} | Total Found: ${totalCount} | Verified Counted: ${verifiedCount}`);

        if (totalCount > 0 && verifiedCount >= totalCount) {
            console.log("[DEBUG SENDER] Math hit 100%. Preparing to fire webhook.");

            const MAIN_PORTAL_WEBHOOK_URL = "https://script.google.com/a/macros/crystalgroup.in/s/AKfycbx33LK-GR6JJhDVsNAwxVC5th_lZBFymgj4-9-r8343sCyVPH5qB74-VcqyzdOnyxc/exec";

            const webhookPayload = {
                action: "auto_close_pipeline",
                indentId: payload.indentId,
                totalCount: totalCount
            };

            const options = {
                method: "post",
                contentType: "application/json",
                payload: JSON.stringify(webhookPayload),
                muteHttpExceptions: true
            };

            const response = UrlFetchApp.fetch(MAIN_PORTAL_WEBHOOK_URL, options);
            console.log(`[DEBUG SENDER] Webhook HTTP Code: ${response.getResponseCode()}`);
            console.log(`[DEBUG SENDER] Webhook Response Body: ${response.getContentText()}`);
        } else {
            console.log("[DEBUG SENDER] Math did not reach 100%. Webhook skipped.");
        }
    } catch(e) {
        console.error("[DEBUG SENDER] CRASH in Step E: " + e.message);
    }

    return { success: true, pdf: finalPdfUrl };

  } catch (e) {
    console.error("Gate-In Error: " + e.message);
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ====================================================================
// 5. INDEPENDENT MODE AUTO-FETCHER (Searches by Container Number)
// ====================================================================
function findIndentByContainerNo(cNo) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.REPO_SHEET_ID);
    const repo = ss.getSheetByName("Container_Repository");
    if (!repo) return { success: false };

    const data = repo.getDataRange().getValues();
    const h = data[0].map(x => String(x).trim());
    const cIdx = h.indexOf("Container_Number");
    const iIdx = h.indexOf("Indent_ID");
    const custIdx = h.indexOf("Client_Name");

    if (cIdx === -1 || iIdx === -1) return { success: false };

    for (let i = data.length - 1; i > 0; i--) {
      if (normContainerNo(data[i][cIdx]) === normContainerNo(cNo)) {
        return {
          success: true,
          indentId: data[i][iIdx],
          customer: custIdx > -1 ? data[i][custIdx] : ""
        };
      }
    }
    return { success: false };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ====================================================================
// 6. GATE-IN / GATE-OUT REPORTING (on-demand download + scheduled email)
// ====================================================================
const REPORT_RECIPIENTS_TO = "shivani.dhall@crystalgroup.in,mansi.agarwal@crystalgroup.in,pushpa.shetty@crystalgroup.in";
const REPORT_RECIPIENTS_CC = "pc@crystalgroup.in";

function csvEscape(v) {
  let s = (v === null || v === undefined) ? "" : String(v);
  if (s.indexOf(",") > -1 || s.indexOf('"') > -1 || s.indexOf("\n") > -1) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Builds the report's raw data (shared by the on-demand download and the
// scheduled emails) from the Legacy ledger, filtered to [startDateStr, endDateStr]
// inclusive (both "yyyy-MM-dd").
function buildGateReport(startDateStr, endDateStr) {
  const extSs = SpreadsheetApp.openById(CONFIG.LEGACY_SHEET_ID);
  const extSheet = extSs.getSheetByName(CONFIG.LEGACY_SHEET_NAME);
  if (!extSheet) return { success: false, message: "Ledger sheet not found." };

  const data = extSheet.getDataRange().getValues();
  const head = data[0].map(x => String(x).trim());
  const dateIdx = head.indexOf("Date (Inward/Outward)");
  const statusIdx = head.indexOf("Status");

  const startDate = new Date(startDateStr + "T00:00:00");
  const endDate = new Date(endDateStr + "T23:59:59");

  // Every column from the ledger is carried through as-is — including all
  // 9 inspection photo links, LR Copy, PTI Video, the merged PDF, repair
  // notes and remarks — so the report is never missing a field the ledger has.
  let rows = [];
  let inwardCount = 0, outwardCount = 0;

  for (let i = 1; i < data.length; i++) {
    let rawDate = dateIdx > -1 ? data[i][dateIdx] : null;
    if (!rawDate) continue;
    let rowDate = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
    if (isNaN(rowDate.getTime()) || rowDate < startDate || rowDate > endDate) continue;

    let status = statusIdx > -1 ? String(data[i][statusIdx] || "").trim() : "";
    if (status === "Inward (Gate-In)") inwardCount++;
    else if (status === "Outward (Gate-Out)") outwardCount++;

    rows.push(data[i]);
  }

  let csvLines = [];
  csvLines.push("Gate-In / Gate-Out Report");
  csvLines.push(`Date Range:,${startDateStr},to,${endDateStr}`);
  csvLines.push(`Total Inward (Gate-In):,${inwardCount}`);
  csvLines.push(`Total Outward (Gate-Out):,${outwardCount}`);
  csvLines.push("");
  csvLines.push(head.map(csvEscape).join(","));
  rows.forEach(r => csvLines.push(r.map(csvEscape).join(",")));

  return {
    success: true,
    csv: csvLines.join("\n"),
    head: head,
    rows: rows,
    inwardCount: inwardCount,
    outwardCount: outwardCount,
    rowCount: rows.length
  };
}

// Called from the portal's Report card — writes the report into a single,
// reusable Google Sheet (cleared and rewritten each time) and returns its
// URL, so clicking the button always opens cleanly in the browser instead
// of depending on the user's local file associations for a CSV download.
function getOrCreateReportSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty("REPORT_SHEET_ID");
  let ss = null;
  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("Gate-In / Gate-Out Report");
    props.setProperty("REPORT_SHEET_ID", ss.getId());
  }
  return ss;
}

function generateGateReportSheet(startDateStr, endDateStr) {
  try {
    const result = buildGateReport(startDateStr, endDateStr);
    if (!result.success) return result;

    const ss = getOrCreateReportSheet();
    const sheet = ss.getSheets()[0];
    sheet.clear();
    sheet.setName(`Report ${startDateStr} to ${endDateStr}`.substring(0, 100));

    const numCols = result.head.length;
    const pad = (row) => {
      let p = row.slice();
      while (p.length < numCols) p.push("");
      return p;
    };

    const allRows = [
      pad(["Gate-In / Gate-Out Report"]),
      pad(["Date Range:", startDateStr, "to", endDateStr]),
      pad(["Total Inward (Gate-In):", result.inwardCount]),
      pad(["Total Outward (Gate-Out):", result.outwardCount]),
      pad([]),
      pad(result.head)
    ].concat(result.rows.map(r => pad(r)));

    sheet.getRange(1, 1, allRows.length, numCols).setValues(allRows);
    sheet.getRange(1, 1).setFontWeight("bold").setFontSize(14);
    sheet.getRange(6, 1, 1, numCols).setFontWeight("bold").setBackground("#f1f3f7");
    sheet.autoResizeColumns(1, numCols);

    return { success: true, url: ss.getUrl() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// Called from the portal's Report card — returns CSV text + filename for the
// browser to download directly (no file is saved on Drive).
function generateGateReportCSV(startDateStr, endDateStr) {
  try {
    const result = buildGateReport(startDateStr, endDateStr);
    if (!result.success) return result;
    return {
      success: true,
      csv: result.csv,
      filename: `Gate_Report_${startDateStr}_to_${endDateStr}.csv`
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function sendGateReportEmail(startDateStr, endDateStr, periodLabel) {
  const result = buildGateReport(startDateStr, endDateStr);
  if (!result.success) {
    console.error("[REPORT] Failed to build " + periodLabel + " report: " + result.message);
    return;
  }
  const filename = `Gate_Report_${periodLabel}_${startDateStr}_to_${endDateStr}.csv`;
  const blob = Utilities.newBlob(result.csv, "text/csv", filename);

  MailApp.sendEmail({
    to: REPORT_RECIPIENTS_TO,
    cc: REPORT_RECIPIENTS_CC,
    subject: `Gate-In/Gate-Out ${periodLabel} Report — ${startDateStr} to ${endDateStr}`,
    body:
`Attached is the ${periodLabel} Gate-In / Gate-Out report for ${startDateStr} to ${endDateStr}.

Total Inward (Gate-In): ${result.inwardCount}
Total Outward (Gate-Out): ${result.outwardCount}
Total Entries: ${result.rowCount}

This is an automated report from the Gate-In Portal.`,
    attachments: [blob]
  });
}

// Fired daily by a time-based trigger (see setupReportTriggers below).
function sendDailyGateReport() {
  const tz = "Asia/Kolkata";
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  sendGateReportEmail(today, today, "Daily");
}

// Fired monthly by a time-based trigger — covers the FULL previous calendar month.
function sendMonthlyGateReport() {
  const tz = "Asia/Kolkata";
  const now = new Date();
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startStr = Utilities.formatDate(firstOfLastMonth, tz, "yyyy-MM-dd");
  const endStr = Utilities.formatDate(lastOfLastMonth, tz, "yyyy-MM-dd");
  sendGateReportEmail(startStr, endStr, "Monthly");
}

// ⚠️ RUN THIS ONCE MANUALLY from the Apps Script editor (pick it in the
// function dropdown next to "Run" and click Run) to install the schedule.
// Safe to re-run — it clears any previously-installed report triggers first,
// so it never creates duplicates. The hour below is interpreted in this
// project's timezone (Project Settings > Time zone) — make sure that's set
// to Asia/Kolkata, or the report will fire at the wrong clock time.
function setupReportTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "sendDailyGateReport" || fn === "sendMonthlyGateReport") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("sendDailyGateReport")
    .timeBased()
    .atHour(17)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger("sendMonthlyGateReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();

  console.log("Report triggers installed: Daily ~5 PM, Monthly ~9 AM on the 1st (project timezone).");
}

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
