/**
 * PMS Gate Bridge (Google Apps Script web app)
 * =============================================
 * Runs as the OWNER of the GATE_IN_OUT_DOCS folder, so files land there
 * exactly like the old Gate-In portal's do. PMS's own service account can't
 * create files in that personal My Drive folder; this script does it for PMS.
 *
 * It does only three things, and nothing else:
 *   1. action "copy":     copies PMS's uploaded files into GATE_IN_OUT_DOCS
 *                         with the old portal's names (CXRU1040451_Left_Side, ...)
 *   2. action "pdfEmail": builds the inspection PDF in GATE_IN_OUT_DOCS, writes
 *                         its link into the gate-ledger row PMS appended
 *                         (column Z, Photo_Merge_Pdf), and sends the same email
 *                         as the old portal.
 * It never touches IMS, Container_Repository, or any other ledger cell.
 *
 * SETUP (once):
 *   - Project Settings > Script Properties: add BRIDGE_SECRET = the same long
 *     random value PMS has as LEGACY_BRIDGE_SECRET.
 *   - Project Settings > Time zone: Asia/Kolkata.
 *   - Deploy > New deployment > Web app: Execute as "Me", Who has access
 *     "Anyone". The secret is what protects it; without it every call is refused.
 */

const BRIDGE = {
  DRIVE_FOLDER_ID: '1ZgdbdifVvIyi0FzsBTiqRnzes_fbTMa-',
  NOTIFY_RECIPIENTS: 'shivani.dhall@crystalgroup.in,alok.jhawar@crystalgroup.in,mansi.agarwal@crystalgroup.in,pushpa.shetty@crystalgroup.in,auditor@crystalgroup.in',
  PDF_COLUMN: 26, // Z: Photo_Merge_Pdf
};

function doGet() {
  return out_({ ok: true, service: 'PMS Gate Bridge' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'Request is not JSON.' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
  if (!secret || req.secret !== secret) return out_({ ok: false, error: 'unauthorized' });
  try {
    if (req.action === 'copy') return out_(copyFiles_(req));
    if (req.action === 'pdfEmail') return out_(pdfEmail_(req));
    return out_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '');
}

/** Copies each file once; a retry reuses the copy it already made (matched by its description). */
function copyFiles_(req) {
  var folder = DriveApp.getFolderById(BRIDGE.DRIVE_FOLDER_ID);
  var links = {};
  (req.files || []).forEach(function (f) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(String(f.fileId))) return;
    var name = String(f.name).replace(/[\\\/]/g, '_');
    var tag = 'pms-source:' + f.fileId;
    var copy = null;
    var same = folder.getFilesByName(name);
    while (same.hasNext()) {
      var x = same.next();
      if (x.getDescription() === tag) { copy = x; break; }
    }
    if (!copy) {
      copy = DriveApp.getFileById(f.fileId).makeCopy(name, folder);
      copy.setDescription(tag);
    }
    links[f.key] = copy.getUrl();
  });
  return { ok: true, links: links };
}

/**
 * Builds the PDF and sends the email for one ledger row. The row's PDF cell
 * is claimed first, so a repeated call never builds or emails twice; if
 * anything fails the claim is released so a later retry can finish it.
 */
function pdfEmail_(req) {
  var sheet = SpreadsheetApp.openById(req.ledgerSheetId).getSheetByName(req.ledgerTab);
  if (!sheet) return { ok: false, error: 'Ledger tab not found.' };
  var row = Number(req.ledgerRow);
  if (!(row >= 2)) return { ok: false, error: 'Bad ledger row.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var pdfCell = sheet.getRange(row, BRIDGE.PDF_COLUMN);
  try {
    var containerCell = sheet.getRange(row, 5).getValue();
    if (norm_(containerCell) !== norm_(req.containerNo)) return { ok: false, error: 'Ledger row does not match the container.' };
    var existing = String(pdfCell.getValue() || '').trim();
    if (existing) return { ok: true, skipped: existing };
    pdfCell.setValue('Building PDF...');
  } finally {
    lock.releaseLock();
  }

  try {
    var folder = DriveApp.getFolderById(BRIDGE.DRIVE_FOLDER_ID);
    var s = req.summary || {};
    var doc = DocumentApp.create('GateIn_Inspection_' + req.containerNo);
    var body = doc.getBody();
    body.insertParagraph(0, 'Gate-In Inspection Report').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Container: ' + req.containerNo + (s.indent ? ' | Indent: ' + s.indent : '') + (s.order ? ' | Order: ' + s.order : ''));
    body.appendParagraph('Status: ' + (s.status || '') + ' | Date: ' + (s.date || ''));
    body.appendHorizontalRule();
    (req.photoFileIds || []).forEach(function (id) {
      try {
        var file = DriveApp.getFileById(id);
        var blob = file.getBlob();
        if (String(blob.getContentType()).indexOf('image/') !== 0) return;
        body.appendParagraph(file.getName()).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        var img = body.appendImage(blob);
        var ratio = img.getWidth() / img.getHeight();
        img.setWidth(400);
        img.setHeight(400 / ratio);
      } catch (e) {
        body.appendParagraph('(photo could not be added: ' + id + ')');
      }
    });
    doc.saveAndClose();
    var pdf = folder.createFile(doc.getAs(MimeType.PDF)).setName('Inspection_' + req.containerNo + '.pdf');
    DriveApp.getFileById(doc.getId()).setTrashed(true);
    var pdfUrl = pdf.getUrl();
    pdfCell.setValue(pdfUrl);

    MailApp.sendEmail({
      to: BRIDGE.NOTIFY_RECIPIENTS,
      subject: 'Gate-In Portal: ' + (s.status || '') + ' — ' + req.containerNo,
      body:
        'A new submission has been recorded on the Gate-In Portal (via PMS).\n\n' +
        'Container No: ' + req.containerNo + '\n' +
        (s.indent ? 'Indent: ' + s.indent + '\n' : '') +
        (s.order ? 'Order: ' + s.order + '\n' : '') +
        'Status: ' + (s.status || '') + '\n' +
        'Date: ' + (s.date || '') + '\n' +
        'Type: ' + (s.type || '') + '  |  Size: ' + (s.size || '') + '\n' +
        'Customer: ' + (s.customer || '') + '\n' +
        'Yard Location: ' + (s.location || '') + '\n' +
        'Transporter: ' + (s.transporter || '') + '  |  Vehicle: ' + (s.vehicle || '') + '\n' +
        'Remarks: ' + (s.remarks || '') + '\n\n' +
        'Inspection PDF: ' + pdfUrl + '\n\n' +
        'Submitted by: ' + (s.by || ''),
    });
    return { ok: true, pdfUrl: pdfUrl };
  } catch (err) {
    pdfCell.setValue('');
    throw err;
  }
}
