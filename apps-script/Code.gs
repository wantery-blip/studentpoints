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
const CLASS_FIELDS = [
  ['班級名稱'], ['班級代碼'], ['Firestore 班級 ID'], ['分組數量'], ['教師 ID'], ['最後備份時間']
];
const STUDENT_HEADERS = [
  '座號', '學生姓名', '性別', '目前積分', '小組', '最後加扣分原因', '最後更新時間', '學生文件 ID'
];
const LOG_HEADERS = [
  '操作時間', '類型', '班級', '座號', '學生姓名',
  '變動分數', '原因', '小組', '教師 ID', '學生文件 ID'
];
const STUDENT_HEADER_ROW = 8;
const STUDENT_DATA_ROW = STUDENT_HEADER_ROW + 1;
const LOG_START_COLUMN = 9;

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!payload.classId || !payload.className) {
      return json_({ ok: false, error: '缺少班級資料' });
    }

    const sheet = getOrCreateClassSheet_(payload);
    ensureClassLayout_(sheet, payload);
    if (payload.action === 'score_log') {
      appendScoreLogs_(sheet, payload);
    } else if (payload.action === 'snapshot') {
      writeSnapshot_(sheet, payload);
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
  properties.setProperty(propertyKey, String(sheet.getSheetId()));
  return sheet;
}

function ensureClassLayout_(sheet, payload) {
  // 首次版本把加扣分表頭放在 A1:J1；將其既有紀錄搬到右側，避免遺失資料。
  const oldHeaders = sheet.getRange(1, 1, 1, LOG_HEADERS.length).getValues()[0];
  if (oldHeaders.join('|') === LOG_HEADERS.join('|')) {
    const oldLastRow = sheet.getLastRow();
    const oldRows = oldLastRow > 1
      ? sheet.getRange(2, 1, oldLastRow - 1, LOG_HEADERS.length).getValues()
      : [];
    sheet.clear();
    if (oldRows.length) {
      sheet.getRange(2, LOG_START_COLUMN, oldRows.length, LOG_HEADERS.length).setValues(oldRows);
    }
  }

  const currentDetails = sheet.getRange(1, 2, CLASS_FIELDS.length, 1).getValues();
  sheet.getRange(1, 1, CLASS_FIELDS.length, 1).setValues(CLASS_FIELDS);
  sheet.getRange(1, 2, CLASS_FIELDS.length, 1).setValues([[
    payload.className || currentDetails[0][0] || ''
  ], [
    payload.classCode || currentDetails[1][0] || ''
  ], [
    payload.classId || currentDetails[2][0] || ''
  ], [
    payload.totalGroups || currentDetails[3][0] || ''
  ], [
    payload.teacherId || currentDetails[4][0] || ''
  ], [
    payload.occurredAt || new Date().toISOString()
  ]]);
  sheet.getRange(STUDENT_HEADER_ROW, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]);
  sheet.getRange(1, LOG_START_COLUMN, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, CLASS_FIELDS.length, 1).setFontWeight('bold').setBackground('#e0e7ff');
  sheet.getRange(STUDENT_HEADER_ROW, 1, 1, STUDENT_HEADERS.length).setFontWeight('bold').setBackground('#e0e7ff');
  sheet.getRange(1, LOG_START_COLUMN, 1, LOG_HEADERS.length).setFontWeight('bold').setBackground('#e0e7ff');
  sheet.autoResizeColumns(1, STUDENT_HEADERS.length);
  sheet.autoResizeColumns(LOG_START_COLUMN, LOG_HEADERS.length);
}

function writeSnapshot_(sheet, payload) {
  const students = Array.isArray(payload.students) ? payload.students : [];
  const clearRows = Math.max(sheet.getLastRow() - STUDENT_HEADER_ROW, 1);
  sheet.getRange(STUDENT_DATA_ROW, 1, clearRows, STUDENT_HEADERS.length).clearContent();
  if (!students.length) return;

  const rows = students.map(student => [
    student.number || '',
    student.name || '',
    student.gender === 'male' ? '男生' : student.gender === 'female' ? '女生' : '',
    Number(student.points) || 0,
    student.groupId === undefined || student.groupId === null ? '' : student.groupId,
    student.lastReason || '',
    student.lastUpdate || '',
    student.id || ''
  ]);
  sheet.getRange(STUDENT_DATA_ROW, 1, rows.length, STUDENT_HEADERS.length).setValues(rows);
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
  const logLastRow = lastNonEmptyRow_(sheet, LOG_START_COLUMN);
  sheet.getRange(Math.max(logLastRow + 1, 2), LOG_START_COLUMN, rows.length, LOG_HEADERS.length).setValues(rows);
}

function lastNonEmptyRow_(sheet, column) {
  const values = sheet.getRange(1, column, sheet.getMaxRows(), 1).getValues();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i][0] !== '') return i + 1;
  }
  return 0;
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
