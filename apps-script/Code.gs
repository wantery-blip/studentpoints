/**
 * 合作型積分平台的 Google Apps Script Web App。
 *
 * 1. 在指定 Google 試算表開啟「擴充功能 → Apps Script」。
 * 2. 以本檔完整取代 Code.gs，然後部署為 Web App。
 * 3. 將 /exec 網址填入平台「設定 → 備份」。
 *
 * 不要把 Firebase Admin 私鑰、教師密碼或任何其他憑證放進這個檔案。
 */
const SPREADSHEET_ID = '1JRGGjf5fGXvxRqDo3aLZjeDMfPhRak_DNgx5GeyIk40';
const CLASS_SHEET_PROPERTY_PREFIX = 'class_sheet_';
const LOG_HEADERS = [
  '操作時間', '類型', '班級', '座號', '學生姓名',
  '變動分數', '原因', '小組', '教師 ID', '學生文件 ID'
];

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!payload.classId || !payload.className) {
      return json_({ ok: false, error: '缺少班級資料' });
    }

    const sheet = getOrCreateClassSheet_(payload);
    if (payload.action === 'score_log') {
      appendScoreLogs_(sheet, payload);
    }
    // class_created 只需確保該班有獨立分頁與欄位列。
    return json_({ ok: true, sheet: sheet.getName() });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error) });
  }
}

function getOrCreateClassSheet_(payload) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const properties = PropertiesService.getDocumentProperties();
  const propertyKey = CLASS_SHEET_PROPERTY_PREFIX + payload.classId;
  const storedSheetId = properties.getProperty(propertyKey);

  if (storedSheetId) {
    const existing = spreadsheet.getSheets().find(sheet => String(sheet.getSheetId()) === storedSheetId);
    if (existing) return existing;
  }

  const baseName = safeSheetName_(payload.className);
  const sheetName = uniqueSheetName_(spreadsheet, baseName, payload.classId);
  const sheet = spreadsheet.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#e0e7ff');
  sheet.autoResizeColumns(1, LOG_HEADERS.length);
  properties.setProperty(propertyKey, String(sheet.getSheetId()));
  return sheet;
}

function appendScoreLogs_(sheet, payload) {
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!records.length) return;

  const occurredAt = payload.occurredAt || new Date().toISOString();
  const rows = records.map(record => [
    occurredAt,
    record.type || '學生加扣分',
    payload.className,
    record.studentNumber || '',
    record.studentName || '',
    Number(record.change) || 0,
    record.reason || '',
    record.groupId === undefined || record.groupId === null ? '' : record.groupId,
    payload.teacherId || '',
    record.studentId || ''
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
}

function safeSheetName_(value) {
  const cleaned = String(value || '未命名班級')
    .replace(/[\[\]*?:\/\\]/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || '未命名班級';
}

function uniqueSheetName_(spreadsheet, baseName, classId) {
  const names = new Set(spreadsheet.getSheets().map(sheet => sheet.getName()));
  if (!names.has(baseName)) return baseName;
  const suffix = ' (' + String(classId).slice(-6) + ')';
  return (baseName.slice(0, 100 - suffix.length) + suffix).slice(0, 100);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
