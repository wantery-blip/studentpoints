import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'class-points-rules-test';
const namespace = 'default-app-id';
const base = `artifacts/${namespace}/public/data`;
const rules = readFileSync(resolve('firestore.rules'), 'utf8');
let testEnv;

const teacherDb = (uid, teacherId) => testEnv.authenticatedContext(uid, {
  email: `${uid}@example.test`,
  firebase: { sign_in_provider: 'password' }
}).firestore();
const studentDb = uid => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'anonymous' }
}).firestore();
const path = (...parts) => `${base}/${parts.join('/')}`;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, path('teachers', 'teacher-a')), { teacherId: 'legacy-a', email: 'teacher-a@example.test', backupUrl: '' });
    await setDoc(doc(db, path('teachers', 'teacher-b')), { teacherId: 'legacy-b', email: 'teacher-b@example.test', backupUrl: '' });
    await setDoc(doc(db, path('classes', 'class-a')), { teacherId: 'legacy-a', name: '甲班', classCode: 'SAFE2026', totalGroups: 4 });
    await setDoc(doc(db, path('classes', 'class-b')), { teacherId: 'legacy-b', name: '乙班', classCode: 'OTHER2026', totalGroups: 4 });
    await setDoc(doc(db, path('class_codes', 'SAFE2026')), { classId: 'class-a', teacherId: 'legacy-a' });
    await setDoc(doc(db, path('class_codes', 'OTHER2026')), { classId: 'class-b', teacherId: 'legacy-b' });
    await setDoc(doc(db, path('student_points', 'student-a')), { name: '王小明', studentNumber: '01', points: 3, classId: 'class-a' });
    await setDoc(doc(db, path('student_points', 'student-b')), { name: '陳小華', studentNumber: '02', points: 8, classId: 'class-b' });
    await setDoc(doc(db, path('point_history', 'history-a')), { classId: 'class-a', studentId: 'student-a', teacherId: 'legacy-a', change: 1, reason: '既有紀錄', type: '學生加扣分', createdAt: new Date() });
    await setDoc(doc(db, path('class_access', 'student-a_class-a')), { uid: 'student-a', classId: 'class-a', code: 'SAFE2026' });
    await setDoc(doc(db, path('teacher_auth', 'legacy-a')), { password: 'never-exposed' });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
});
beforeEach(seed);
after(async () => { await testEnv.cleanup(); });

test('所屬教師可用 increment 更新自己班級學生積分', async () => {
  const db = teacherDb('teacher-a');
  await assertSucceeds(updateDoc(doc(db, path('student_points', 'student-a')), {
    points: increment(2), lastReason: '測試', lastUpdate: new Date()
  }));
  await assertSucceeds(setDoc(doc(db, path('point_history', 'history-new')), {
    classId: 'class-a', studentId: 'student-a', teacherId: 'legacy-a',
    change: 2, reason: '測試', type: '學生加扣分', createdAt: serverTimestamp()
  }));
});

test('其他教師不可讀寫非自己班級，也不可偽造 teacherId', async () => {
  const db = teacherDb('teacher-b');
  await assertFails(getDoc(doc(db, path('student_points', 'student-a'))));
  await assertFails(updateDoc(doc(db, path('student_points', 'student-a')), { points: increment(1) }));
  await assertFails(getDoc(doc(db, path('point_history', 'history-a'))));
  await assertFails(setDoc(doc(db, path('teachers', 'teacher-b')), {
    teacherId: 'legacy-a', email: 'teacher-b@example.test', backupUrl: ''
  }));
});

test('持有授權的匿名學生只可讀自己班級，不可改分或讀取明文密碼', async () => {
  const db = studentDb('student-a');
  await assertSucceeds(getDoc(doc(db, path('student_points', 'student-a'))));
  await assertFails(updateDoc(doc(db, path('student_points', 'student-a')), { points: increment(1) }));
  await assertFails(getDoc(doc(db, path('teacher_auth', 'legacy-a'))));
  await assertFails(deleteDoc(doc(db, path('student_points', 'student-a'))));
});

test('學生不可列舉班級代碼或使用錯誤代碼建立授權', async () => {
  const db = studentDb('student-new');
  await assertFails(getDocs(collection(db, path('class_codes'))));
  await assertFails(setDoc(doc(db, path('class_access', 'student-new_class-a')), {
    uid: 'student-new', classId: 'class-a', code: 'WRONG2026', createdAt: new Date()
  }));
});
