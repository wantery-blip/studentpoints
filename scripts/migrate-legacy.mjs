/**
 * 只在教師自己的電腦、使用 Firebase Admin 憑證執行。
 * 不會讀取、轉存或再次使用舊的明文密碼。
 * 此程式將「舊 teacherId」安全綁定到指定 Firebase Authentication 電子郵件身分。
 * 不修改任何學生分數，不移動原有班級 ID。
 */
import admin from 'firebase-admin';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const param = name => { const i=argv.indexOf(name); return i<0?'':argv[i+1] || ''; };
const legacyId = param('--teacher-id');
const email = param('--email').trim().toLowerCase();
const namespace = param('--namespace') || process.env.VITE_DATA_NAMESPACE || 'default-app-id';
const expectedProjectId = param('--project-id');
const dryRun = argv.includes('--dry-run');
const purge = argv.includes('--purge-plaintext');
if (!legacyId || !expectedProjectId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('用法: node scripts/migrate-legacy.mjs --teacher-id 舊教師ID --email 新登入信箱 --namespace 舊__app_id --project-id Firebase專案ID [--dry-run] [--purge-plaintext]');
  process.exit(2);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('請先在本機設定 GOOGLE_APPLICATION_CREDENTIALS，指向你的 Firebase Admin Service Account JSON；絕不可提交到 GitHub。');
  process.exit(2);
}

const accountInfo = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
if (accountInfo.project_id !== expectedProjectId) {
  console.error('拒絕遷移：Service Account 所屬專案', accountInfo.project_id, '與 --project-id', expectedProjectId, '不一致。');
  process.exit(2);
}
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: expectedProjectId });
const db = admin.firestore();
const base = db.collection('artifacts').doc(namespace).collection('public').doc('data');
const teacherRef = base.collection('teacher_auth').doc(legacyId);
const profileCol = base.collection('teachers');
const classCol = base.collection('classes');
const codeCol = base.collection('class_codes');

const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12), v => chars[v % chars.length]).join('');
};

try {
  const firebaseUser = await admin.auth().getUserByEmail(email);
  if (firebaseUser.disabled) throw new Error('指定 Firebase 帳號已停用');
  const profileRef = profileCol.doc(firebaseUser.uid);
  const [legacyDoc, profileDoc, classSnapshot] = await Promise.all([
    teacherRef.get(), profileRef.get(), classCol.where('teacherId', '==', legacyId).get()
  ]);
  if (profileDoc.exists) {
    const currentId = profileDoc.data()?.teacherId;
    if (currentId !== legacyId && currentId !== firebaseUser.uid) {
      throw new Error('此登入帳號已綁定其他教師，停止遷移以防混用資料');
    }
  }
  const plans = [];
  const used = new Set();
  for (const classDoc of classSnapshot.docs) {
    const previous = String(classDoc.data().classCode || '');
    let code = previous.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(code)) code = makeCode();
    if (used.has(code)) throw new Error('這位教師有重複班級代碼：'+code+'；請先在備份中確認後再處理');
    used.add(code);
    const index = await codeCol.doc(code).get();
    if (index.exists && index.data().classId !== classDoc.id) {
      throw new Error('班級代碼已被其他班級使用：'+code+'。為避免覆寫，已停止。');
    }
    plans.push({ classDoc, oldCode:previous, code });
  }
  console.log('Firebase 專案:', expectedProjectId);
  console.log('資料命名空間:', namespace);
  console.log('綁定教師:', legacyId, '→', email, '(UID:', firebaseUser.uid, ')');
  console.log('班級數量:', plans.length);
  for (const p of plans) console.log('班級', p.classDoc.id, '代碼：',p.oldCode || '(原本無代碼)', '→',p.code);
  if (dryRun) { console.log('僅預演，未更改任何資料。'); process.exit(0); }

  const legacySettings = legacyDoc.exists ? legacyDoc.data() : {};
  // 從舊資料保留信箱／備份網址，絕不寫入明文密碼。
  await profileRef.set({
    teacherId: legacyId,
    email: String(legacySettings.email || email),
    backupUrl: String(legacySettings.backupUrl || ''),
    migratedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  for (const p of plans) {
    const ref=codeCol.doc(p.code);
    await db.runTransaction(async tx => {
      const index=await tx.get(ref);
      if (index.exists && index.data().classId !== p.classDoc.id) throw new Error('同時有其他班級佔用 '+p.code);
      if (!index.exists) tx.create(ref, { classId:p.classDoc.id, teacherId:legacyId, createdAt:admin.firestore.FieldValue.serverTimestamp() });
      if (p.oldCode !== p.code) tx.update(p.classDoc.ref, { classCode:p.code });
    });
  }
  console.log('教師 UID 綁定、班級代碼索引完成；學生與積分資料均未變更。');
  if (purge) {
    if (legacyDoc.exists) {
      await teacherRef.delete();
      console.log('已刪除這位教師的舊 teacher_auth 文件，包含明文密碼。');
    } else console.log('原本就沒有舊 teacher_auth 文件。');
  } else if (legacyDoc.exists) {
    console.log('安全提醒：舊明文密碼仍在 Firestore（新 Rules 已禁止前端存取）。完成登入測試後，加上 --purge-plaintext 重跑以刪除。');
  }
} catch (err) {
  console.error('遷移未完成：', err.message || err);
  process.exitCode = 1;
}
