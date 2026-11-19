import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDoc,
  getDocs,
  setDoc,
  onSnapshot, 
  serverTimestamp,
  query,
  where,
  increment,
  runTransaction,
  writeBatch
} from 'firebase/firestore';
import { 
  User, 
  Lock, 
  Plus, 
  Trash2, 
  Award, 
  LogOut, 
  UserPlus, 
  History,
  ArrowRight,
  CheckCircle,
  Settings,
  X,
  Users,
  List,
  Zap,
  Edit3,
  BarChart3,
  Download,
  Mail,
  AtSign,
  CloudUpload,
  Globe,
  Loader2,
  Crown,
  ChevronDown,
  PlusCircle,
  School,
  Copy,
  Pencil,
  Search,
  ArrowLeft,
  Hash,
  LayoutGrid, 
  Upload,
  FileInput,
  AlertCircle,
  Info
} from 'lucide-react';

// --- Firebase Configuration & Initialization ---
// 從環境變數讀取 Firebase 設定，並提供安全預設值以防編譯錯誤
// Firebase 網頁應用程式設定。請在根目錄的 .env 填入 Firebase Console 提供的值。
// 注意：Firebase 的網頁設定本來就會包含在前端檔案中；真正的資料保護必須依靠 Firestore 規則。
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
};
if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
  throw new Error('請先建立 .env 並填寫 VITE_FIREBASE_* 設定；參考 README.md');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// 這是 Firestore 資料路徑中的命名空間，並非 Firebase Web App ID。
// 沿用舊專案資料時，務必與原本的 __app_id 完全相同。
const appId = import.meta.env.VITE_DATA_NAMESPACE || 'default-app-id';

// Firestore 一個 batch 最多可寫入 500 筆。保留餘裕，避免大型班級匯入時失敗。
const MAX_BATCH_WRITES = 450;
// 此信箱是唯一可在網站內審核教師申請的主要管理者。Firebase Auth
// 的 email 不可被其他帳號冒用，規則亦會再次限制此權限。
const PRIMARY_ADMIN_EMAIL = 'wantery@gmail.com';

const BUILT_IN_PRESETS = [
  { presetKey: 'positive', label: '優良', value: 1 },
  { presetKey: 'negative', label: '違規', value: -1 }
];

const resolveActionPresets = (storedPresets) => {
  const defaults = BUILT_IN_PRESETS.map(fallback =>
    storedPresets.find(preset => preset.presetKey === fallback.presetKey) || fallback
  );
  return [...defaults, ...storedPresets.filter(preset => !preset.presetKey)];
};

const groupContribution = (student, groupPoints, divisor) => {
  if (student.groupId == null) return 0;
  return Number(groupPoints[student.groupId] || 0) / (Number(divisor) || 1);
};

const totalPointsFor = (student, groupPoints = {}, divisor = 1) =>
  Number(student.points || 0) + groupContribution(student, groupPoints, divisor);

const formatPoints = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/\.00$/, '');

const normalizeSeatNumber = (value) => {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
};

const parseBatchStudents = (input) => input
  .split(/\r?\n/)
  .map((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return null;

    // 支援「01 王小明」、「01,王小明」、「01. 王小明」與僅輸入姓名。
    const numbered = line.match(/^(\d+)\s*[,.、，\t ]+(.+)$/);
    if (numbered) {
      return { studentNumber: numbered[1], name: numbered[2].trim(), line: index + 1 };
    }
    if (/^\d+$/.test(line)) return { studentNumber: '', name: '', line: index + 1 };
    return { studentNumber: '', name: line, line: index + 1 };
  })
  .filter(Boolean);

// Apps Script Web App 的 no-cors 回應不可讀取；記錄失敗不得影響 Firestore 正式加扣分。
const postSheetEvent = (url, payload) => {
  if (!url) return;
  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload)
  }).catch((error) => console.error('Google 試算表記錄請求失敗', error));
};

// 儲存空間可能在無痕瀏覽、瀏覽器限制或 iframe 中不可用；不可因此讓畫面崩潰。
const readLocal = (key) => {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) || '' : ''; }
  catch { return ''; }
};
const writeLocal = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch { /* 不支援儲存時僅保留當前分頁狀態 */ }
};
const removeLocal = (key) => {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
};
const initialStudentClass = () => {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'student' ? params.get('class_id') || '' : '';
};

// 只更新 Firestore 文件有改變的學生，維持其他學生物件參照，減少卡片重繪。
const applyStudentChanges = (byId: Map<string, any>, snapshot: any) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'removed') byId.delete(change.doc.id);
    else byId.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
  });
  return Array.from(byId.values()).sort((a, b) =>
    (parseInt(a.studentNumber, 10) || 0) - (parseInt(b.studentNumber, 10) || 0)
  );
};


// --- UI Feedback Context (取代原生 alert 與 confirm，提供更佳的使用者體驗) ---
const UIContext = createContext(null);

function useUI() {
  return useContext(UIContext);
}

// --- Main Application Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [teacherProfile, setTeacherProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // 教師授權必須來自 Firebase Auth UID + 伺服器可驗證的教師設定，不採用 localStorage。
  const teacherId = (user && !user.isAnonymous && teacherProfile) ? teacherProfile.teacherId : '';
  const isLoggedIn = Boolean(teacherId);
  // 直接連結仍支援；若此瀏覽器沒有對應班級的授權，學生必須先輸入班級代碼。
  const [viewMode, setViewMode] = useState(() => initialStudentClass() ? 'student-dashboard' : 'teacher');
  const [studentViewClassId, setStudentViewClassId] = useState(initialStudentClass);

  // 全域提示訊息 (Toast) 與確認對話框 (Confirm Modal) 狀態
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // 顯示非阻斷式通知訊息
  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  // 自動關閉 Toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 顯示自訂確認視窗
  const askConfirm = useCallback((title, message, onConfirm, isDanger = false) => {
    setConfirmDialog({ title, message, onConfirm, isDanger });
  }, []);
  const uiValue = useMemo(() => ({ notify, askConfirm }), [notify, askConfirm]);

  // 初次啟動時恢復 Firebase 本機 session，不會因縮小或切換分頁主動登出。
  // 匿名登入僅供學生查分，不具有教師身分。
  useEffect(() => {
    removeLocal('teacher_id'); // 清理舊版不具權限效力的教師登入旗標。
    let active = true;
    let anonymousInProgress = false;
    let unsubscribeProfile = () => {};
    let unsubscribeAuth = () => {};
    const observeAuth = async (currentUser) => {
      unsubscribeProfile();
      unsubscribeProfile = () => {};
      if (!active) return;
      setUser(currentUser);
      setTeacherProfile(null);
      setAuthError('');
      if (currentUser && !currentUser.isAnonymous) {
        const profileRef = doc(db, 'artifacts', appId, 'public', 'data', 'teachers', currentUser.uid);
        unsubscribeProfile = onSnapshot(profileRef, snap => {
          if (!active || auth.currentUser?.uid !== currentUser.uid) return;
          setTeacherProfile(snap.exists() ? snap.data() : null);
          setAuthReady(true);
        }, err => {
          console.error('讀取教師權限失敗', err);
          if (active) {
            setTeacherProfile(null);
            setAuthError('無法讀取教師授權，請檢查 Firestore 安全規則。');
            setAuthReady(true);
          }
        });
        return;
      }
      if (currentUser?.isAnonymous) {
        setAuthReady(true);
        return;
      }
      if (anonymousInProgress) return;
      anonymousInProgress = true;
      try {
        if (active && !auth.currentUser) await signInAnonymously(auth);
      } catch (err) {
        console.error('匿名登入失敗', err);
        if (active) {
          setAuthError('學生匿名驗證失敗，請在 Firebase Authentication 啟用「匿名」。');
          setAuthReady(true);
        }
      } finally {
        anonymousInProgress = false;
      }
    };

    // 先指定 local persistence，再開始觀察恢復中的 Firebase session；不以 localStorage 判斷教師身分。
    const startAuthObserver = async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (err) {
        // 無痕模式或瀏覽器儲存空間政策可能拒絕持久化，仍讓 Firebase 以可用的 session 繼續運作。
        console.warn('無法設定本機登入持久化', err);
      }
      if (active) unsubscribeAuth = onAuthStateChanged(auth, observeAuth);
    };
    void startAuthObserver();
    return () => { active = false; unsubscribeAuth(); unsubscribeProfile(); };
  }, []);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    // 確實從 Firebase 登出，不能只清除前端的教師 ID。
    await signOut(auth);
  }, []);

  // 連線載入畫面
  if (!authReady || (!user && !authError)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 flex flex-col items-center animate-pulse">
          <Award className="w-12 h-12 mb-4 text-indigo-500" />
          <p className="font-medium">正在恢復登入狀態...</p>
        </div>
      </div>
    );
  }
  if (authError) {
    return <div className="min-h-screen flex flex-col gap-4 items-center justify-center p-5 bg-slate-50">
      <AlertCircle className="w-10 h-10 text-red-500" />
      <p className="text-sm text-red-700 text-center">{authError}</p>
      <button className="bg-indigo-600 text-white rounded-lg px-4 py-2" onClick={() => window.location.reload()}>重新連線</button>
    </div>;
  }

  return (
    <UIContext.Provider value={uiValue}>
      <div className="min-h-screen bg-slate-100 font-sans text-slate-800 relative">
        {!isOnline && (
          <div className="sticky top-0 z-[110] bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950">
            目前離線：資料會在重新連線後同步；請勿關閉尚未完成的操作。
          </div>
        )}
        
        {/* 全域 Toast 提示元件 */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-[100] animate-bounce">
            <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium ${
              toast.type === 'error' 
                ? 'bg-red-600 text-white border-red-700' 
                : toast.type === 'info'
                ? 'bg-slate-800 text-white border-slate-700'
                : 'bg-emerald-600 text-white border-emerald-700'
            }`}>
              {toast.type === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              <span>{toast.message}</span>
            </div>
          </div>
        )}

        {/* 全域確認對話框 (Confirm Modal) */}
        {confirmDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[90] backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in-up">
              <h3 className="text-lg font-bold text-slate-800 mb-2">{confirmDialog.title}</h3>
              <p className="text-sm text-slate-600 whitespace-pre-line mb-6">{confirmDialog.message}</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const action = confirmDialog.onConfirm;
                    setConfirmDialog(null);
                    if (action) action();
                  }}
                  className={`px-4 py-2 text-sm font-bold text-white rounded-lg shadow-md transition ${
                    confirmDialog.isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  確定執行
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 路由切換：學生查分系統 vs 教師系統 */}
        {viewMode === 'student-dashboard' ? (
          <StudentDashboard 
            classId={studentViewClassId} 
            onBack={() => setViewMode('student-login')}
          />
        ) : viewMode === 'student-login' ? (
          <StudentLogin 
            onJoin={(cId) => {
              setStudentViewClassId(cId);
              setViewMode('student-dashboard');
            }}
            onBack={() => setViewMode('teacher')}
          />
        ) : user && !user.isAnonymous && !isLoggedIn ? (
          <PendingTeacherApproval
            user={user}
            onLogout={handleLogout}
          />
        ) : !isLoggedIn ? (
          <LoginPage
            onGoToStudent={() => setViewMode('student-login')}
          />
        ) : (
          <Dashboard 
            user={user} 
            teacherId={teacherId} 
            onLogout={handleLogout} 
          />
        )}
      </div>
    </UIContext.Provider>
  );
}

// --- 學生登入頁面 (輸入班級代碼) ---
function StudentLogin({ onJoin, onBack }) {
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const code = inputCode.trim();
    if (!code) {
      setError('請輸入班級代碼');
      setLoading(false);
      return;
    }

    try {
      const normalized = code.toUpperCase();
      if (!/^[A-Z0-9_-]{4,32}$/.test(normalized)) {
        setError('班級代碼須為 4–32 位英數字、底線或連字號');
      } else {
        // 只能用確切代碼 get 單一文件，不能列出所有班級或推算其他代碼。
        const codeRef = doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', normalized);
        const codeSnap = await getDoc(codeRef);
        if (!codeSnap.exists()) {
          setError('找不到此班級代碼，請向老師確認');
        } else {
          const classId = codeSnap.data().classId;
          const currentUser = auth.currentUser;
          if (!currentUser) throw new Error('尚未完成 Firebase 驗證');
          if (currentUser.isAnonymous) {
            // 只接受有正確代碼的匿名使用者取得該班唯讀授權，Rules 會再次比對。
            const grantId = `${currentUser.uid}_${classId}`;
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'class_access', grantId), {
              uid: currentUser.uid, classId, code: normalized, createdAt: serverTimestamp()
            });
          }
          onJoin(classId);
        }
      }
    } catch (err) {
      console.error('申請班級唯讀權限失敗', err);
      setError('無法進入班級，請檢查代碼或請老師確認權限設定');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md transition-all duration-300 relative">
        <button 
          onClick={onBack}
          className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 flex items-center gap-1 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> 返回教師登入
        </button>

        <div className="text-center mb-8 mt-4">
          <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">學生查分系統</h1>
          <p className="text-slate-500 text-sm mt-2">輸入老師提供的「班級代碼」查詢榮譽榜</p>
        </div>

        <form onSubmit={handleJoin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">班級代碼</label>
            <div className="relative">
              <Hash className="absolute left-3 top-3.5 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 outline-none transition text-lg font-bold tracking-widest uppercase"
                placeholder="例如：MATH2026"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2 justify-center">
              <span className="font-bold">!</span> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition duration-200 transform hover:scale-[1.02] shadow-lg flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '進入查詢'}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- 學生唯讀查分儀表板 ---
function StudentDashboard({ classId, onBack }) {
  const [students, setStudents] = useState([]);
  const [groupPoints, setGroupPoints] = useState({});
  const [classInfo, setClassInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 即時監聽班級資訊
  useEffect(() => {
    if (!classId) return;
    setClassInfo(null);
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'classes', classId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      setClassInfo(docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null);
    }, (err) => { console.error('班級讀取失敗', err); setLoadError('沒有此班級的讀取權限，請返回輸入班級代碼。'); });
    return () => unsubscribe();
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    const groupQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'group_points'),
      where('classId', '==', classId)
    );
    return onSnapshot(groupQuery, snapshot => {
      const next = {};
      snapshot.docs.forEach(item => { next[item.data().groupId] = Number(item.data().points || 0); });
      setGroupPoints(next);
    }, err => console.error('小組分數讀取失敗', err));
  }, [classId]);

  const pointDivisor = Number(classInfo?.groupPointDivisor) || 1;
  const displayedStudents = useMemo(() => students.map(student => ({
    ...student,
    totalPoints: totalPointsFor(student, groupPoints, pointDivisor)
  })), [students, groupPoints, pointDivisor]);

  // 即時監聽該班級學生點數
  useEffect(() => {
    if (!classId) return;
    const studentById = new Map();
    setStudents([]);
    setLoading(true);
    setLoadError('');
    const classStudentsQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'student_points'),
      where('classId', '==', classId)
    );
    const unsubscribe = onSnapshot(classStudentsQuery, (snapshot) => {
      setStudents(applyStudentChanges(studentById, snapshot));
      setLoading(false);
    }, (err) => {
      console.error('學生分數讀取失敗', err);
      setLoadError('無法取得學生資料，請檢查網路或 Firestore 存取權限。');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [classId]);

  // 計算積分最高的前 8 名學生
  const topStudents = useMemo(() => {
    return [...displayedStudents].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 8);
  }, [displayedStudents]);

  if (loadError) {
    return <div className="min-h-screen flex flex-col gap-3 items-center justify-center p-6 text-red-600">
      <AlertCircle className="w-10 h-10" />{loadError}
      <button className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700" onClick={onBack}>返回查詢</button>
    </div>;
  }
  if (loading && students.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center text-slate-500">
          <Loader2 className="w-10 h-10 animate-spin mb-2 text-emerald-500" />
          <p>載入成績資料中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 p-4 sm:p-6 relative">
      <button 
        onClick={onBack}
        className="fixed top-4 left-4 z-10 bg-white p-2.5 rounded-full shadow-md text-slate-500 hover:text-slate-800 transition"
        title="返回查詢首頁"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="max-w-5xl mx-auto mt-8">
        {/* 班級標頭 */}
        <header className="bg-white p-5 rounded-xl shadow-sm mb-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 to-teal-500"></div>
          <div className="bg-emerald-500 p-3 rounded-full mb-3 shadow-md mt-2">
            <Award className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">
            {classInfo ? classInfo.name : '班級榮譽榜'}
          </h1>
          <p className="text-slate-500 text-sm">優良點數即時查詢（唯讀模式）</p>
        </header>

        {/* Top 8 榮譽榜 (單列顯示，無座號，前三名金銀銅配色) */}
        <div className="mb-8 w-full mx-auto">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center justify-center gap-2">
            <Crown className="w-4 h-4 text-yellow-500" /> 榮譽榜 (Top 8)
          </h3>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {topStudents.map((s, index) => (
              <div 
                key={s.id} 
                className={`relative p-1.5 rounded-lg border shadow-sm flex flex-col items-center justify-center text-center overflow-hidden h-20
                  ${index === 0 ? 'bg-gradient-to-br from-yellow-50 to-white border-yellow-200 ring-1 ring-yellow-200' : 
                    index === 1 ? 'bg-gradient-to-br from-slate-50 to-white border-slate-200' : 
                    index === 2 ? 'bg-gradient-to-br from-orange-50 to-white border-orange-200' : 'bg-white border-slate-100'}`}
              >
                <div className={`absolute top-0 left-0 px-1.5 py-0.5 text-[9px] font-bold rounded-br z-10 leading-none
                  ${index === 0 ? 'bg-yellow-400 text-yellow-900' : 
                    index === 1 ? 'bg-slate-300 text-slate-700' : 
                    index === 2 ? 'bg-orange-300 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>
                  #{index + 1}
                </div>
                <div className="mt-3 mb-0.5 font-bold text-slate-800 truncate w-full text-xs px-0.5">
                  {s.name}
                </div>
                <div className={`text-base font-black leading-none ${s.totalPoints >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>
                  {formatPoints(s.totalPoints)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 全班成績一覽表 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <List className="w-4 h-4" /> 所有成績
            </h3>
            <span className="text-xs text-slate-400">即時同步中</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100">
                <tr>
                  <th className="px-4 py-3 w-16">座號</th>
                  <th className="px-4 py-3">姓名</th>
                  <th className="px-4 py-3 text-right">點數</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">最新紀錄</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-slate-500">{s.studentNumber || '-'}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                    <td className={`px-4 py-3 text-right font-bold text-lg ${s.totalPoints < 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                      {formatPoints(s.totalPoints)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs hidden sm:table-cell">
                      {s.lastReason || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 教師登入與註冊頁面 ---
function LoginPage({ onGoToStudent }) {
  const { notify } = useUI();
  const [isRegistering, setIsRegistering] = useState(false);
  const [inputId, setInputId] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const email = inputId.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('請輸入有效的電子郵件地址'); return; }
    if (inputPassword.length < 8) { setError('密碼至少需要 8 個字元'); return; }
    if (isRegistering && (!applicantName.trim() || !organization.trim())) {
      setError('請填寫姓名與學校／單位，供主要管理者審核'); return;
    }
    setLoading(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (isRegistering) {
        const credential = await createUserWithEmailAndPassword(auth, email, inputPassword);
        if (email === PRIMARY_ADMIN_EMAIL) {
          // 主要管理者可自助建立自己的教師設定，其他帳號一律只能提出申請。
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'teachers', credential.user.uid), {
            teacherId: credential.user.uid,
            email, backupUrl: '', createdAt: serverTimestamp()
          });
          notify('主要管理者帳號建立成功，已登入。');
        } else {
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'teacher_requests', credential.user.uid), {
            uid: credential.user.uid,
            email,
            name: applicantName.trim(),
            organization: organization.trim(),
            status: 'pending',
            createdAt: serverTimestamp()
          });
          notify('教師申請已送出，請等待主要管理者審核。', 'info');
        }
      } else {
        await signInWithEmailAndPassword(auth, email, inputPassword);
      }
      setInputPassword('');
    } catch (err) {
      console.error('Firebase 教師驗證失敗', err);
      const code = err?.code || '';
      setError(code === 'auth/email-already-in-use' ? '此信箱已註冊，請直接登入' :
        code === 'auth/weak-password' ? '密碼強度不足' :
        code === 'auth/invalid-credential' ? '電子郵件或密碼不正確' :
        '驗證失敗，請確認電子郵件、密碼及網路連線');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md transition-all duration-300">
        <div className="text-center mb-8">
          <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Award className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            {isRegistering ? '註冊教師帳號' : '教師登入系統'}
          </h1>
          <p className="text-slate-500 text-sm mt-2">學生優良點數管理平台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              教師電子郵件
            </label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="email"
                autoComplete="username"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                placeholder="例如：teacher@example.com"
              />
            </div>
            {isRegistering && (
              <p className="text-xs text-slate-400 mt-1">帳號建立後需由主要管理者審核；密碼不會存入 Firestore</p>
            )}
          </div>

          {isRegistering && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">申請者姓名</label>
                <input type="text" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" placeholder="請填寫真實姓名" maxLength={80} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">學校／單位</label>
                <input type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" placeholder="例如：○○國小" maxLength={120} />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {isRegistering ? '設定密碼（至少 8 碼）' : '密碼'}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="password"
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                placeholder="輸入密碼 (至少 8 碼)"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2">
              <span className="font-bold">!</span> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full text-white font-bold py-3 rounded-lg transition duration-200 transform hover:scale-[1.02] shadow-lg flex items-center justify-center gap-2
              ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {loading ? '處理中...' : (isRegistering ? '送出教師申請' : '進入系統')}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <div className="mt-3 text-center">
          <button type="button" onClick={async () => {
            const email = inputId.trim().toLowerCase();
            if (!email) { setError('請先輸入教師電子郵件'); return; }
            try { await sendPasswordResetEmail(auth, email); notify('如果這個信箱有帳號，Firebase 已受理密碼重設信。', 'info'); }
            catch (err) { console.error(err); setError('無法傳送重設信，請稍後再試'); }
          }} className="text-xs text-indigo-600 hover:underline">忘記密碼？寄送重設連結</button>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-100 text-center space-y-4">
          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError('');
              setInputId('');
              setInputPassword('');
            }}
            className="text-indigo-600 hover:text-indigo-800 font-medium text-sm hover:underline transition block w-full"
          >
            {isRegistering ? '返回登入' : '申請教師帳號'}
          </button>
          
          {!isRegistering && (
            <button
              onClick={onGoToStudent}
              className="w-full bg-emerald-50 text-emerald-700 font-bold py-2.5 rounded-lg hover:bg-emerald-100 transition flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" /> 我是學生 (查成績)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 尚未獲得 teachers/{UID} 授權的帳號，絕不能進入教師主控台。
function PendingTeacherApproval({ user, onLogout }) {
  const { notify } = useUI();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const requestRef = doc(db, 'artifacts', appId, 'public', 'data', 'teacher_requests', user.uid);
    return onSnapshot(requestRef, snap => {
      setRequest(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [user.uid]);

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!name.trim() || !organization.trim()) {
      notify('請填寫姓名與學校／單位', 'error'); return;
    }
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'teacher_requests', user.uid), {
        uid: user.uid,
        email: (user.email || '').toLowerCase(),
        name: name.trim(),
        organization: organization.trim(),
        status: 'pending',
        createdAt: serverTimestamp()
      });
      notify('教師申請已送出，請等待主要管理者審核。', 'info');
    } catch (err) {
      console.error('送出教師申請失敗', err);
      notify('申請送出失敗，請確認已發布最新 Firestore Rules。', 'error');
    } finally { setSubmitting(false); }
  };

  const statusMessage = request?.status === 'rejected'
    ? '此申請未獲核准。若需要協助，請聯絡主要管理者。'
    : '申請已送出，主要管理者核對資料後才會開通教師權限。';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6"><div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-8 h-8 text-amber-600" /></div><h1 className="text-2xl font-bold text-slate-800">教師帳號待審核</h1><p className="text-slate-500 text-sm mt-2">{user.email}</p></div>
        {loading ? <p className="text-center text-sm text-slate-500">讀取申請狀態中…</p>
          : request ? <div className={`rounded-lg border p-4 text-sm ${request.status === 'rejected' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>{statusMessage}</div>
          : <form onSubmit={submitRequest} className="space-y-4"><p className="text-sm text-slate-600">此帳號尚未送出教師申請。填寫資料後將交由主要管理者審核。</p><input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="申請者姓名" maxLength={80}/><input type="text" value={organization} onChange={e => setOrganization(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="學校／單位" maxLength={120}/><button disabled={submitting} className="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-lg disabled:bg-slate-400">{submitting ? '送出中…' : '送出教師申請'}</button></form>}
        <button type="button" onClick={onLogout} className="w-full mt-5 text-sm text-indigo-600 hover:underline">登出</button>
      </div>
    </div>
  );
}

// --- 教師管理主控台 (Dashboard) ---
function Dashboard({ user, teacherId, onLogout }) {
  const { notify, askConfirm } = useUI();

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(() => readLocal(`last_selected_class_${teacherId}`));
  const [students, setStudents] = useState([]);
  const [groupPoints, setGroupPoints] = useState({});
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teacherEmail, setTeacherEmail] = useState('');
  const [backupUrl, setBackupUrl] = useState('');
  
  // 視圖切換：'list' (列表模式) | 'group' (小組模式)
  const [dashboardView, setDashboardView] = useState('list');
  
  // Modal 開關狀態
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBatchActionModal, setShowBatchActionModal] = useState(false);
  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showStudentQueryModal, setShowStudentQueryModal] = useState(false);
  const [showDailyPrompt, setShowDailyPrompt] = useState(false);
  const [historyStudent, setHistoryStudent] = useState<any>(null);
  const [historyGroupId, setHistoryGroupId] = useState<number | null>(null);
  
  // 新增學生表單狀態
  const [addTab, setAddTab] = useState('single');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentNum, setNewStudentNum] = useState('');
  const [batchInput, setBatchInput] = useState('');

  const selectedClass = useMemo(
    () => classes.find(c => c.id === selectedClassId), [classes, selectedClassId]
  );
  const actionPresets = useMemo(() => resolveActionPresets(presets), [presets]);

  const sendScoreLog = useCallback((records) => {
    if (!backupUrl || !selectedClassId || !selectedClass) return;
    postSheetEvent(backupUrl.trim(), {
      action: 'score_log',
      occurredAt: new Date().toISOString(),
      teacherId,
      teacherEmail,
      classId: selectedClassId,
      className: selectedClass.name || '未命名班級',
      records
    });
  }, [backupUrl, selectedClass, selectedClassId, teacherEmail, teacherId]);

  const handleClassCreated = useCallback((newClass) => {
    if (!backupUrl) return;
    postSheetEvent(backupUrl.trim(), {
      action: 'class_created',
      occurredAt: new Date().toISOString(),
      teacherId,
      teacherEmail,
      classId: newClass.id,
      className: newClass.name,
      classCode: newClass.classCode,
      totalGroups: 6
    });
  }, [backupUrl, teacherEmail, teacherId]);

  // 備份與瀏覽器恢復時一律使用最新班級、學生、信箱及網址，防止舊閉包資料錯置。
  const backupStateRef = useRef(null);
  backupStateRef.current = {
    students, backupUrl, teacherId, teacherEmail,
    currentClass: selectedClass ? {
      id: selectedClass.id,
      name: selectedClass.name || '未命名班級',
      classCode: selectedClass.classCode || '',
      totalGroups: selectedClass.totalGroups || 0
    } : null
  };

  // 1. 讀取教師帳號設定 (信箱、GAS 備份網址)
  useEffect(() => {
    if (!user || !teacherId) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'teachers', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTeacherEmail(data.email || '');
        setBackupUrl(data.backupUrl || '');
      }
    });
    return () => unsubscribe();
  }, [user, teacherId]);

  // 2. 讀取教師旗下的所有班級
  useEffect(() => {
    if (!user || !teacherId) return;
    const classesQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'classes'),
      where('teacherId', '==', teacherId)
    );
    const unsubscribe = onSnapshot(classesQuery, (snapshot) => {
      const myClasses = (snapshot.docs
        .map(d => ({ id: d.id, ...d.data() })) as any[])
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      setClasses(myClasses);
      setSelectedClassId(previousId => {
        if (myClasses.length === 0) return '';
        if (myClasses.some(c => c.id === previousId)) return previousId;
        const nextId = myClasses[0].id;
        writeLocal(`last_selected_class_${teacherId}`, nextId);
        return nextId;
      });
      setLoading(false);
    }, (err) => {
      console.error('讀取班級失敗', err);
      notify('班級讀取失敗，請檢查網路或資料存取權限', 'error');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, teacherId, notify]);

  // 3. 讀取當前選定班級的學生資料
  useEffect(() => {
    if (!user || !selectedClassId) { 
      setStudents([]); 
      return; 
    }
    const studentById = new Map();
    setStudents([]);
    const classStudentsQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'student_points'),
      where('classId', '==', selectedClassId)
    );
    const unsubscribe = onSnapshot(classStudentsQuery, (snapshot) => {
      setStudents(applyStudentChanges(studentById, snapshot));
    }, (err) => {
      console.error('讀取班級學生失敗', err);
      notify('學生資料載入失敗', 'error');
    });
    return () => unsubscribe();
  }, [user, selectedClassId, notify]);

  useEffect(() => {
    if (!user || !selectedClassId) { setGroupPoints({}); return; }
    const groupQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'group_points'),
      where('classId', '==', selectedClassId)
    );
    return onSnapshot(groupQuery, snapshot => {
      const next = {};
      snapshot.docs.forEach(item => { next[item.data().groupId] = Number(item.data().points || 0); });
      setGroupPoints(next);
    }, err => {
      console.error('讀取小組分數失敗', err);
      notify('小組分數載入失敗', 'error');
    });
  }, [user, selectedClassId, notify]);

  // 4. 讀取教師自訂的獎勵項目 (全班級共用)
  useEffect(() => {
    if (!user || !teacherId) return;
    const presetsQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'reward_presets'),
      where('classId', '==', teacherId)
    );
    const unsubscribe = onSnapshot(presetsQuery, (snapshot) => {
      setPresets(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('獎勵項目讀取失敗', err));
    return () => unsubscribe();
  }, [user, teacherId]);

  // 計算積分最高的前 8 名學生
  const groupPointDivisor = Number(selectedClass?.groupPointDivisor) || 1;
  const displayedStudents = useMemo(() => students.map(student => ({
    ...student,
    totalPoints: totalPointsFor(student, groupPoints, groupPointDivisor)
  })), [students, groupPoints, groupPointDivisor]);
  const topStudents = useMemo(() => {
    return [...displayedStudents].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 8);
  }, [displayedStudents]);

  // 切換班級
  const handleClassChange = (e) => {
    const newId = e.target.value;
    setSelectedClassId(newId);
    writeLocal(`last_selected_class_${teacherId}`, newId);
  };

  // 更新班級分組數量
  const updateGroupCount = async (count) => {
    if (!selectedClassId || count < 1 || count > 20) return;
    try {
      const classRef = doc(db, 'artifacts', appId, 'public', 'data', 'classes', selectedClassId);
      await updateDoc(classRef, { totalGroups: count });
      notify(`已設定為 ${count} 組`);
    } catch (err) {
      console.error(err);
      notify('更新組數失敗', 'error');
    }
  };

  // --- 備份與自動提醒 ---

  // no-cors 的回應無法驗證 GAS 是否真正寫入，僅能確認瀏覽器送出請求。
  const handleCloudUpload = useCallback(async (silent = false) => {
    const { backupUrl: url, students: currentStudents, teacherId: currentTeacherId,
      teacherEmail: currentEmail, currentClass } = backupStateRef.current || {};
    if (!url) {
      if (!silent) notify('請先至「設定 → 備份」設定 Webhook 網址', 'error');
      return false;
    }
    if (!currentStudents?.length) {
      if (!silent) notify('目前沒有可備份的學生資料', 'info');
      return false;
    }
    const payload = {
      action: 'snapshot',
      occurredAt: new Date().toISOString(),
      teacherId: currentTeacherId,
      teacherEmail: currentEmail,
      classId: currentClass?.id,
      className: currentClass?.name,
      classCode: currentClass?.classCode,
      totalGroups: currentClass?.totalGroups,
      students: currentStudents.map(s => ({
        id: s.id,
        number: s.studentNumber,
        name: s.name,
            points: totalPointsFor(s, groupPoints, groupPointDivisor),
            individualPoints: s.points,
        groupId: s.groupId ?? null,
        lastReason: s.lastReason,
        lastUpdate: s.lastUpdate?.seconds
          ? new Date(s.lastUpdate.seconds * 1000).toISOString() : null
      }))
    };
    try {
      await fetch(url.trim(), {
        method: 'POST',
        mode: 'no-cors',
        // 避免在 no-cors 模式傳送未被允許的 application/json header。
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      });
      if (!silent) {
        notify('備份上傳請求已送出；請到 Google 試算表確認結果。', 'info');
        setShowDailyPrompt(false);
      }
      return true;
    } catch (err) {
      console.error('雲端備份失敗', err);
      if (!silent) notify('備份請求失敗，請檢查網路或 Webhook 網址', 'error');
      return false;
    }
  }, [notify, groupPoints, groupPointDivisor]);

  const checkAndPromptDailyReport = useCallback((automatic = false) => {
    if (students.length === 0) {
      if (!automatic) notify('目前尚無學生資料可產生報表', 'info');
      return;
    }
    if (automatic) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayKey = `${teacherId}:${selectedClassId}:${now.toLocaleDateString('en-CA')}`;
      if (readLocal('daily_prompt_day') === dayKey) return;
      // 只在今天有加扣分變動時自動提醒；手動點按「日報表」不受限。
      const hasChanges = students.some(s => s.lastUpdate?.seconds &&
        s.lastUpdate.seconds * 1000 >= today.getTime());
      if (!hasChanges) return;
      writeLocal('daily_prompt_day', dayKey);
    }
    setShowDailyPrompt(true);
  }, [students, teacherId, selectedClassId, notify]);

  // 從背景分頁返回後補做檢查，避免背景分頁的計時器被瀏覽器節流而錯過 17:00。
  useEffect(() => {
    const maybePrompt = () => {
      if (document.visibilityState === 'hidden') return;
      const hour = new Date().getHours();
      if (hour >= 17 && hour <= 23) checkAndPromptDailyReport(true);
    };
    const timer = window.setInterval(maybePrompt, 60 * 1000);
    document.addEventListener('visibilitychange', maybePrompt);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', maybePrompt);
    };
  }, [checkAndPromptDailyReport]);

  const lastAutoBackupRef = useRef(Date.now());
  const autoBackupBusyRef = useRef(false);
  useEffect(() => {
    const maybeBackup = async () => {
      if (document.visibilityState === 'hidden' || autoBackupBusyRef.current) return;
      if (Date.now() - lastAutoBackupRef.current < 20 * 60 * 1000) return;
      lastAutoBackupRef.current = Date.now();
      const { backupUrl: url, students: currentStudents } = backupStateRef.current || {};
      if (!url || !currentStudents?.length) return;
      autoBackupBusyRef.current = true;
      try { await handleCloudUpload(true); }
      finally { autoBackupBusyRef.current = false; }
    };
    const timer = window.setInterval(maybeBackup, 60 * 1000);
    document.addEventListener('visibilitychange', maybeBackup);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', maybeBackup);
    };
  }, [handleCloudUpload]);

  // 開啟 Gmail 寄送日報表
  const handleSendEmailReport = () => {
    const todayStr = new Date().toLocaleDateString();
    const sortedStudents = [...students].sort((a, b) => parseInt(a.studentNumber || 0) - parseInt(b.studentNumber || 0));
    let body = `[學生優良點數日報表] ${selectedClass?.name || ''} - ${todayStr}\n\n--------------------------------\n`;
    sortedStudents.forEach(s => {
      body += `${s.studentNumber || '無座號'}. ${s.name}： ${formatPoints(totalPointsFor(s, groupPoints, groupPointDivisor))} 分 (最新: ${s.lastReason || '無'})\n`;
    });
    body += `--------------------------------\n此郵件由學生優良點數管理系統自動生成。`;
    const subject = encodeURIComponent(`[點數報表] ${selectedClass?.name} ${todayStr}`);
    const bodyEncoded = encodeURIComponent(body);
    const recipient = teacherEmail || '';
    const mailtoLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${recipient}&su=${subject}&body=${bodyEncoded}`;
    window.open(mailtoLink, '_blank');
    setShowDailyPrompt(false);
  };

  // 登出前送出備份，不再為等待固定延遲 1.2 秒而卡住畫面。
  const handleLogoutWithBackup = async () => {
    if (backupUrl && students.length > 0) {
      setIsLoggingOut(true);
      try { await handleCloudUpload(true); }
      catch (err) { console.error('登出備份錯誤', err); }
    }
    try { await onLogout(); }
    catch (err) {
      console.error('Firebase 登出失敗', err);
      notify('登出失敗，請檢查網路連線', 'error');
      setIsLoggingOut(false);
    }
  };

  // --- 批次匯入 / 資料救援 (貼上文字解析：座號 姓名 分數) ---
  const handleBatchImport = async (textData) => {
    if (!selectedClassId) {
      notify('請先選擇或建立一個班級', 'error');
      return;
    }
    if (!textData.trim()) {
      notify('請輸入要匯入的資料', 'error');
      return;
    }

    askConfirm(
      '確認批次匯入資料',
      `確定要將資料匯入至「${selectedClass?.name}」嗎？\n這將會建立新的學生名單與點數紀錄。`,
      async () => {
        const lines = textData.split('\n');
        let successCount = 0;
        const batch = writeBatch(db);

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          // 支援空白、逗號、Tab 分隔
          const parts = cleanLine.split(/[,\t\s]+/);
          let num = '';
          let name = '';
          let points = 0;

          if (parts.length >= 3) {
            // 格式：座號 姓名 分數
            const last = parts[parts.length - 1];
            if (!isNaN(parseInt(last))) {
              points = parseInt(last);
              parts.pop();
            }
            const first = parts[0];
            if (/^\d+$/.test(first)) {
              num = first;
              parts.shift();
            }
            name = parts.join(' ');
          } else if (parts.length === 2) {
            // 格式：座號 姓名 或 姓名 分數
            if (/^\d+$/.test(parts[0])) {
              num = parts[0];
              name = parts[1];
            } else if (!isNaN(parseInt(parts[1]))) {
              name = parts[0];
              points = parseInt(parts[1]);
            } else {
              name = parts.join(' ');
            }
          } else if (parts.length === 1) {
            name = parts[0];
          }

          if (name) {
            const newDocRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'student_points'));
            batch.set(newDocRef, {
              name: name,
              studentNumber: num,
              points: points,
              classId: selectedClassId,
              createdAt: serverTimestamp(),
              lastReason: '批次匯入'
            });
            successCount++;
          }
        }

        try {
          await batch.commit();
          notify(`成功匯入 ${successCount} 筆學生資料！`, 'success');
        } catch (e) {
          console.error(e);
          notify('匯入失敗，請檢查資料格式', 'error');
        }
      }
    );
  };

  // --- 學生新增、更新分數、刪除操作 ---
  const handleAddStudent = async (e) => {
    e.preventDefault();
    if (!newStudentName.trim() || !selectedClassId) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'student_points'), {
        name: newStudentName.trim(),
        studentNumber: newStudentNum.trim(),
        points: 0,
        classId: selectedClassId,
        createdAt: serverTimestamp(),
        lastReason: '新建立'
      });
      setNewStudentName('');
      setNewStudentNum('');
      setShowAddModal(false);
      notify(`已新增學生：${newStudentName.trim()}`);
    } catch (err) { 
      console.error(err);
      notify('新增學生失敗', 'error');
    }
  };

  const handleBatchAddStudent = async (e) => {
    e.preventDefault();
    if (!batchInput.trim() || !selectedClassId) return;
    const parsedRows = parseBatchStudents(batchInput);
    const validRows = parsedRows.filter(row => row.name);
    const invalidLines = parsedRows.filter(row => !row.name).map(row => row.line);
    if (validRows.length === 0) {
      notify('請每行輸入「座號 姓名」或僅輸入姓名', 'error');
      return;
    }

    let createdCount = 0;
    try {
      // 大量名單拆成多個可安全提交的 batch，避免 500 筆上限造成整批失敗。
      for (let start = 0; start < validRows.length; start += MAX_BATCH_WRITES) {
        const batch = writeBatch(db);
        const chunk = validRows.slice(start, start + MAX_BATCH_WRITES);
        chunk.forEach(({ name, studentNumber }) => {
          const newRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'student_points'));
          batch.set(newRef, {
            name,
            studentNumber,
            points: 0,
            classId: selectedClassId,
            createdAt: serverTimestamp(),
            lastReason: '新建立'
          });
        });
        await batch.commit();
        createdCount += chunk.length;
      }
      setBatchInput('');
      setShowAddModal(false);
      setAddTab('single');
      const skippedMessage = invalidLines.length ? `；略過第 ${invalidLines.join('、')} 行（只有座號，缺少姓名）` : '';
      notify(`成功建立 ${createdCount} 位學生！${skippedMessage}`);
    } catch (err) { 
      console.error(err); 
      notify(createdCount
        ? `已建立 ${createdCount} 位，後續匯入失敗；請修正資料後重新貼上未完成的部分`
        : '批次建立失敗，請檢查網路或 Firestore 存取權限', 'error');
    }
  };

  const updatePoints = useCallback(async (student, change, reason) => {
    try {
      const finalReason = reason || (change > 0 ? '加分' : '扣分');
      const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'student_points', student.id);
      const historyRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history'));
      const batch = writeBatch(db);
      batch.update(studentRef, {
        // 原版使用舊畫面的 points + change，連續點擊或多人操作可能覆蓋分數。
        points: increment(change),
        lastReason: finalReason,
        lastUpdate: serverTimestamp()
      });
      batch.set(historyRef, {
        classId: selectedClassId, studentId: student.id, teacherId, change, reason: finalReason,
        groupId: student.groupId ?? null, type: '學生加扣分', eventId: historyRef.id, createdAt: serverTimestamp()
      });
      await batch.commit();
      sendScoreLog([{
        type: '學生加扣分', studentId: student.id, studentNumber: student.studentNumber || '',
        studentName: student.name, change, reason: finalReason, groupId: student.groupId ?? ''
      }]);
      return true;
    } catch (err) {
      console.error(err);
      notify('更新分數失敗', 'error');
      return false;
    }
  }, [notify, selectedClassId, sendScoreLog, teacherId]);

  const handleBatchPointsUpdate = async (points, reason) => {
    if (students.length === 0) return;
    const finalReason = reason || (points > 0 ? '全班加分' : '全班扣分');
    const eventId = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history')).id;
    try {
      // 每位學生會同時更新分數和建立一筆歷程，故每批最多 225 位。
      for (let start = 0; start < students.length; start += 225) {
        const batch = writeBatch(db);
        students.slice(start, start + 225).forEach(student => {
          const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'student_points', student.id);
          batch.update(studentRef, {
            points: increment(points),
            lastReason: finalReason,
            lastUpdate: serverTimestamp()
          });
          const historyRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history'));
          batch.set(historyRef, {
            classId: selectedClassId, studentId: student.id, teacherId, change: points,
            reason: finalReason, groupId: student.groupId ?? null,
            type: '全班加扣分', eventId, createdAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      setShowBatchActionModal(false);
      notify(`全班已${points > 0 ? `加 ${points}` : `扣 ${Math.abs(points)}`} 分！`);
    } catch (err) { 
      console.error(err); 
      notify('全班更新失敗', 'error'); 
    }
  };

  const deleteStudent = useCallback((studentId, studentName) => {
    askConfirm(
      '刪除學生確認',
      `確定要刪除「${studentName}」的所有點數紀錄嗎？此動作無法復原。`,
      async () => {
        try {
          await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_points', studentId));
          notify(`已刪除 ${studentName}`);
        } catch (err) { 
          console.error(err);
          notify('刪除失敗', 'error');
        }
      },
      true
    );
  }, [askConfirm, notify]);

  // --- 小組分組與小組連動加扣分邏輯 ---
  const handleAssignGroup = async (seatInput: string, groupId: number) => {
    const requestedNumbers: string[] = [...new Set<string>(seatInput
      .split(/[，,、\s]+/)
      .map(normalizeSeatNumber)
      .filter((number): number is string => Boolean(number)))];
    if (!requestedNumbers.length) return;

    const foundBySeat = new Map(students.map(student => [normalizeSeatNumber(student.studentNumber), student]));
    const matchedStudents = requestedNumbers.map(number => foundBySeat.get(number)).filter(Boolean);
    const missingNumbers = requestedNumbers.filter(number => !foundBySeat.has(number));
    if (!matchedStudents.length) {
      notify(`找不到座號：${missingNumbers.join('、')}`, 'error');
      return;
    }

    try {
      for (let start = 0; start < matchedStudents.length; start += MAX_BATCH_WRITES) {
        const batch = writeBatch(db);
        matchedStudents.slice(start, start + MAX_BATCH_WRITES).forEach(student => {
          batch.update(doc(db, 'artifacts', appId, 'public', 'data', 'student_points', student.id), { groupId });
        });
        await batch.commit();
      }
      const missingMessage = missingNumbers.length ? `；找不到座號：${missingNumbers.join('、')}` : '';
      notify(`已將 ${matchedStudents.length} 位學生加入第 ${groupId} 組${missingMessage}`);
    } catch (err) {
      console.error(err);
      notify('批次分組失敗，請檢查網路或 Firestore 存取權限', 'error');
    }
  };

  const handleRemoveFromGroup = async (studentId) => {
    try {
      const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'student_points', studentId);
      await updateDoc(studentRef, { groupId: null });
    } catch (err) {
      console.error(err);
    }
  };

  const handleGroupPoints = async (groupId, amount, reason) => {
    const groupMembers = students.filter(s => s.groupId === groupId);
    if (groupMembers.length === 0) {
      notify(`第 ${groupId} 組目前沒有成員`, 'info');
      return;
    }
    const finalReason = reason || (amount > 0 ? `第${groupId}組加分` : `第${groupId}組扣分`);
    const eventId = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history')).id;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'group_points', `${selectedClassId}_${groupId}`), {
        classId: selectedClassId, groupId, points: increment(amount), updatedAt: serverTimestamp()
      }, { merge: true });
      for (let start = 0; start < groupMembers.length; start += 225) {
        const batch = writeBatch(db);
        groupMembers.slice(start, start + 225).forEach(s => {
          const historyRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history'));
          batch.set(historyRef, {
            classId: selectedClassId, studentId: s.id, teacherId, change: amount,
            reason: finalReason, groupId, type: '小組加扣分', eventId, createdAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      sendScoreLog(groupMembers.map(student => ({
        type: '小組加扣分', studentId: student.id, studentNumber: student.studentNumber || '',
        studentName: student.name, change: amount, reason: finalReason, groupId
      })));
      notify(`第 ${groupId} 組已${amount > 0 ? `+${amount}` : amount} 分；個人總積分會依 N 自動換算。`);
    } catch (err) {
      console.error(err);
      notify('小組加扣分失敗', 'error');
    }
  };

  if (isLoggingOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 flex-col gap-4">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
        <p className="text-slate-600 font-medium">正在將最新資料備份至試算表並安全登出...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-20">
      {/* 頂部功能導覽列 */}
      <header className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-3 sm:p-4 rounded-xl shadow-sm mb-6 gap-4 sticky top-0 z-20 border-b border-slate-100">
        <div className="flex items-center gap-2 sm:gap-3 w-full xl:w-auto min-w-0">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-md">
            <School className="text-white w-6 h-6" />
          </div>
          
          {/* 班級下拉選單與新增班級按鈕 */}
          <div className="flex items-center gap-2 min-w-0 flex-1 xl:flex-none">
            {classes.length > 0 ? (
              <div className="relative group min-w-0 flex-1 xl:flex-none">
                <select 
                  value={selectedClassId}
                  onChange={handleClassChange}
                  className="appearance-none bg-slate-50 border border-slate-300 text-slate-900 text-base sm:text-lg font-bold rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full min-w-0 max-w-full pl-3 sm:pl-4 pr-9 py-2 cursor-pointer hover:bg-slate-100 transition"
                >
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-700">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            ) : (
              <div className="text-slate-500 font-medium text-sm italic">
                尚無班級，請點擊右側新增
              </div>
            )}
            
            <button 
              onClick={() => setShowCreateClassModal(true)}
              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-full transition"
              title="建立新班級"
            >
              <PlusCircle className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* 右側操作按鈕區 */}
        <div className="flex flex-wrap gap-2 w-full xl:w-auto justify-start xl:justify-end items-center">
          {selectedClassId && (
            <>
              {/* 列表模式 / 小組模式 切換器 */}
              <div className="flex bg-slate-100 rounded-lg p-1 mr-1">
                <button
                  onClick={() => setDashboardView('list')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition ${dashboardView === 'list' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Users className="w-4 h-4" /> 列表
                </button>
                <button
                  onClick={() => setDashboardView('group')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition ${dashboardView === 'group' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <LayoutGrid className="w-4 h-4" /> 小組
                </button>
              </div>

              <button onClick={() => handleCloudUpload(false)} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition shadow-md text-sm font-medium">
                {backupUrl ? <CloudUpload className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                <span className="hidden sm:inline">備份上傳</span>
              </button>
              <button onClick={() => setShowBatchActionModal(true)} className="flex items-center gap-2 bg-pink-600 text-white px-3 py-2 rounded-lg hover:bg-pink-700 transition shadow-md text-sm font-medium">
                <Zap className="w-4 h-4" />
                <span>全班加分</span>
              </button>
              <button onClick={() => setShowStatsModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition shadow-md text-sm font-medium">
                <BarChart3 className="w-4 h-4" />
                <span>統計</span>
              </button>
              <button onClick={() => setShowStudentQueryModal(true)} className="flex items-center gap-2 bg-cyan-600 text-white px-3 py-2 rounded-lg hover:bg-cyan-700 transition shadow-md text-sm font-medium" title="確認或修改學生查詢碼">
                <Search className="w-4 h-4" />
                <span>學生查詢</span>
              </button>
              <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition shadow-md text-sm font-medium">
                <UserPlus className="w-4 h-4" />
                <span>學生</span>
              </button>
            </>
          )}

          <div className="w-px h-8 bg-slate-200 mx-1 hidden sm:block"></div>
          
          <button onClick={() => setShowPresetsModal(true)} className="flex items-center gap-2 bg-white text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-50 border border-slate-200 transition shadow-sm text-sm" title="獎勵項目設定">
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setShowSettingsModal(true)} className="flex items-center gap-2 bg-white text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-50 border border-slate-200 transition shadow-sm text-sm" title="系統設定">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={handleLogoutWithBackup} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-200 transition text-sm" title="備份並登出">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 主內容區塊 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-10 h-10 animate-spin mb-3 text-indigo-500" />
          <p>載入班級資料中...</p>
        </div>
      ) : !selectedClassId ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
            <School className="w-10 h-10 text-indigo-300" />
          </div>
          <h2 className="text-xl font-bold text-slate-600 mb-2">歡迎使用優良點數管理系統！</h2>
          <p className="mb-6 text-sm">請先建立一個班級開始記錄學生表現。</p>
          <button 
            onClick={() => setShowCreateClassModal(true)}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md font-bold flex items-center gap-2"
          >
            <PlusCircle className="w-5 h-5" /> 建立第一個班級
          </button>
        </div>
      ) : (
        <>
          {/* Top 8 榮譽榜 (單列 8 欄排版，寬度與上方導覽列一致，無座號文字) */}
          <div className="mb-6 animate-fade-in-up w-full mx-auto">
            <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center justify-center gap-2">
              <Crown className="w-4 h-4 text-yellow-500" /> 榮譽榜 (Top 8)
            </h3>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              {topStudents.length === 0 ? (
                <div className="col-span-full text-center py-6 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                  此班級尚無學生資料
                </div>
              ) : (
                topStudents.map((s, index) => (
                  <div 
                    key={s.id} 
                    className={`relative p-1.5 rounded-lg border shadow-sm flex flex-col items-center justify-center text-center overflow-hidden h-20 transition hover:shadow-md
                      ${index === 0 ? 'bg-gradient-to-br from-yellow-50 to-white border-yellow-200 ring-1 ring-yellow-200' : 
                        index === 1 ? 'bg-gradient-to-br from-slate-50 to-white border-slate-200' : 
                        index === 2 ? 'bg-gradient-to-br from-orange-50 to-white border-orange-200' : 'bg-white border-slate-100'}`}
                  >
                    <div className={`absolute top-0 left-0 px-1.5 py-0.5 text-[9px] font-bold rounded-br z-10 leading-none shadow-sm
                      ${index === 0 ? 'bg-yellow-400 text-yellow-900' : 
                        index === 1 ? 'bg-slate-300 text-slate-700' : 
                        index === 2 ? 'bg-orange-300 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>
                      #{index + 1}
                    </div>
                    <div className="mt-3 mb-0.5 font-bold text-slate-800 truncate w-full text-xs px-0.5">
                      {s.name}
                    </div>
                    <div className={`text-base font-black leading-none ${s.totalPoints >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>
                      {formatPoints(s.totalPoints)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 切換顯示：列表模式 vs 小組模式 */}
          {dashboardView === 'list' ? (
            students.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl shadow-sm border border-dashed border-slate-300">
                <UserPlus className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-600">目前沒有學生資料</h3>
                <p className="text-slate-400 text-sm mt-1">點擊上方「學生」按鈕新增名單</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {displayedStudents.map(student => (
                  <StudentCard 
                    key={student.id} 
                    student={student} 
                    presets={actionPresets}
                    onUpdatePoints={updatePoints}
                    onDelete={deleteStudent}
                    onShowHistory={setHistoryStudent}
                  />
                ))}
              </div>
            )
          ) : (
            <GroupView 
              students={displayedStudents}
              totalGroups={selectedClass?.totalGroups || 6} 
              groupPoints={groupPoints}
              pointDivisor={groupPointDivisor}
              presets={actionPresets}
              onAssignGroup={handleAssignGroup}
              onRemoveFromGroup={handleRemoveFromGroup}
              onUpdateGroupCount={updateGroupCount}
              onGroupPointAction={handleGroupPoints}
              onShowGroupHistory={setHistoryGroupId}
            />
          )}
        </>
      )}

      {/* --- 彈出視窗 (MODALS) --- */}

      {/* 1. 建立新班級視窗 */}
      {showCreateClassModal && (
        <CreateClassModal 
          onClose={() => setShowCreateClassModal(false)}
          teacherId={teacherId}
          onCreated={handleClassCreated}
        />
      )}

      {/* 2. 日報表 / 雲端備份確認視窗 */}
      {showDailyPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              {backupUrl ? <CloudUpload className="w-8 h-8" /> : <Mail className="w-8 h-8" />}
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">
              {backupUrl ? '雲端試算表備份' : '寄送日報表'}
            </h3>
            <p className="text-slate-600 text-sm mb-6">
              日期：{new Date().toLocaleDateString()}<br/>
              {backupUrl ? '是否立即將全班點數資料上傳至 Google 試算表？' : '是否要將全班點數整理並開啟 Gmail 寄送？'}
            </p>
            <div className="flex gap-3 justify-center">
              <button 
                onClick={() => setShowDailyPrompt(false)} 
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
              >
                稍後再說
              </button>
              
              {backupUrl ? (
                <button 
                  onClick={() => handleCloudUpload(false)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md font-bold flex items-center gap-2"
                >
                  <CloudUpload className="w-4 h-4" /> 確認上傳
                </button>
              ) : (
                <button 
                  onClick={handleSendEmailReport}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md font-bold flex items-center gap-2"
                >
                  <Mail className="w-4 h-4" /> 確認寄送
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. 新增學生視窗 (單筆 / 批次) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up">
            <div className="bg-indigo-600 p-4 flex justify-between items-center">
              <h3 className="text-white font-bold flex items-center gap-2">
                <UserPlus className="w-5 h-5" /> 新增學生 ({selectedClass?.name})
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex border-b border-slate-200">
              <button 
                onClick={() => setAddTab('single')}
                className={`flex-1 py-3 text-sm font-medium transition ${addTab === 'single' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
              >
                單筆輸入
              </button>
              <button 
                onClick={() => setAddTab('batch')}
                className={`flex-1 py-3 text-sm font-medium transition ${addTab === 'batch' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
              >
                批次貼上
              </button>
            </div>

            <div className="p-6">
              {addTab === 'single' ? (
                <form onSubmit={handleAddStudent}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">座號 (可選)</label>
                      <input
                        type="number"
                        value={newStudentNum}
                        onChange={(e) => setNewStudentNum(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="例如: 01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">姓名</label>
                      <input
                        type="text"
                        required
                        value={newStudentName}
                        onChange={(e) => setNewStudentName(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="輸入學生姓名"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-8">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition shadow-md"
                    >
                      確認新增
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleBatchAddStudent}>
                  <div className="space-y-3">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-xs text-blue-700">
                      <p className="font-bold mb-1">使用說明：</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li>每行輸入一位學生</li>
                        <li>格式：座號 姓名 或 僅姓名</li>
                      </ul>
                    </div>
                    <textarea
                      value={batchInput}
                      onChange={(e) => setBatchInput(e.target.value)}
                      className="w-full h-40 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono leading-relaxed"
                      placeholder={`01 王小明\n02 李大華\n...`}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-3 mt-4">
                    <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                    <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md flex items-center gap-2"><Users className="w-4 h-4" /> 批次建立</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. 全班批次加扣分視窗 */}
      {showBatchActionModal && (
        <BatchActionModal 
          onClose={() => setShowBatchActionModal(false)}
          onConfirm={handleBatchPointsUpdate}
          presets={actionPresets}
          studentCount={students.length}
        />
      )}

      {/* 5. 班級分數統計與 CSV 匯出視窗 */}
      {showStatsModal && (
        <StatsModal 
          onClose={() => setShowStatsModal(false)}
          students={displayedStudents}
          classId={selectedClass?.name || teacherId}
        />
      )}

      {showStudentQueryModal && (
        <StudentQueryModal
          classes={classes}
          teacherId={teacherId}
          selectedClassId={selectedClassId}
          onSelectClass={(classId) => {
            setSelectedClassId(classId);
            writeLocal(`last_selected_class_${teacherId}`, classId);
          }}
          onClose={() => setShowStudentQueryModal(false)}
        />
      )}

      {historyStudent && (
        <StudentHistoryModal
          student={historyStudent}
          classId={selectedClassId}
          onClose={() => setHistoryStudent(null)}
        />
      )}

      {historyGroupId !== null && (
        <GroupHistoryModal
          groupId={historyGroupId}
          classId={selectedClassId}
          onClose={() => setHistoryGroupId(null)}
        />
      )}

      {/* 6. 自訂獎勵項目設定視窗 */}
      {showPresetsModal && (
        <ManagePresetsModal 
          onClose={() => setShowPresetsModal(false)}
          presets={actionPresets}
          teacherId={teacherId}
        />
      )}

      {/* 7. 系統設定視窗 (一般 / 班級管理 / 備份與匯入 / 帳號安全) */}
      {showSettingsModal && (
        <SettingsModal 
          onClose={() => setShowSettingsModal(false)} 
          classId={teacherId}
          teacherUid={user.uid}
          currentEmail={teacherEmail}
          currentBackupUrl={backupUrl}
          classes={classes}
          selectedClassId={selectedClassId}
          onBatchImport={handleBatchImport}
          isPrimaryAdmin={(user.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL}
        />
      )}
    </div>
  );
}

// --- 教師用學生查詢碼管理 ---
// 查分入口採「每班一組查詢碼」設計；此處只讓該班教師檢視與變更自己的代碼。
function StudentQueryModal({ classes, teacherId, selectedClassId, onSelectClass, onClose }) {
  const { notify } = useUI();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [queryCode, setQueryCode] = useState('');
  const [saving, setSaving] = useState(false);

  const beginEditing = (classItem) => {
    setEditingId(classItem.id);
    setQueryCode(classItem.classCode || '');
  };

  const saveCode = async (classItem) => {
    const nextCode = queryCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(nextCode)) {
      notify('查詢碼須為 4–32 位英文、數字、底線或連字號', 'error');
      return;
    }
    const previousCode = classItem.classCode || '';
    if (nextCode === previousCode) {
      setEditingId(null);
      return;
    }

    setSaving(true);
    try {
      const classRef = doc(db, 'artifacts', appId, 'public', 'data', 'classes', classItem.id);
      const nextCodeRef = doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', nextCode);
      await runTransaction(db, async (transaction) => {
        const currentClass = await transaction.get(classRef);
        if (!currentClass.exists() || currentClass.data().teacherId !== teacherId) throw new Error('NOT_OWNER');
        const occupiedCode = await transaction.get(nextCodeRef);
        if (occupiedCode.exists()) throw new Error('DUPLICATE_CLASS_CODE');

        transaction.set(nextCodeRef, { classId: classItem.id, teacherId, createdAt: serverTimestamp() });
        transaction.update(classRef, { classCode: nextCode });
        if (previousCode) {
          transaction.delete(doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', previousCode));
        }
      });
      setEditingId(null);
      notify('學生查詢碼已更新');
    } catch (error: any) {
      console.error('更新學生查詢碼失敗', error);
      notify(error?.message === 'DUPLICATE_CLASS_CODE' ? '此查詢碼已被其他班級使用' : '更新查詢碼失敗', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      notify('學生查詢碼已複製');
    } catch {
      notify('無法自動複製，請手動選取查詢碼', 'info');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in-up">
        <div className="bg-cyan-700 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold flex items-center gap-2"><Search className="w-5 h-5" /> 學生查詢</h3>
            <p className="text-cyan-100 text-xs mt-1">確認或修改各班學生查分時輸入的班級查詢碼</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="關閉學生查詢"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          {classes.length === 0 ? (
            <p className="text-center text-slate-500 py-8">尚未建立班級，請先建立班級後再提供學生查詢碼。</p>
          ) : classes.map((classItem) => (
            <div key={classItem.id} className={`border rounded-xl p-4 ${classItem.id === selectedClassId ? 'border-cyan-300 bg-cyan-50/50' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 truncate">{classItem.name}</p>
                  {editingId === classItem.id ? (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">學生查詢碼</label>
                      <input
                        autoFocus
                        value={queryCode}
                        maxLength={32}
                        onChange={(event) => setQueryCode(event.target.value.toUpperCase())}
                        className="w-full px-3 py-2 border rounded-lg font-mono font-bold tracking-wide uppercase focus:ring-2 focus:ring-cyan-500 outline-none"
                        placeholder="例如：CLASS-01"
                      />
                      <p className="mt-1 text-xs text-slate-500">4–32 位英文、數字、底線或連字號</p>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="bg-white border border-cyan-200 text-cyan-800 font-bold px-2.5 py-1 rounded text-sm tracking-wide">{classItem.classCode || '尚未設定'}</code>
                      {classItem.classCode && <button onClick={() => copyCode(classItem.classCode)} className="text-slate-400 hover:text-cyan-700" title="複製查詢碼"><Copy className="w-4 h-4" /></button>}
                    </div>
                  )}
                </div>
                {editingId === classItem.id ? (
                  <div className="flex shrink-0 gap-2">
                    <button disabled={saving} onClick={() => setEditingId(null)} className="text-sm text-slate-600 px-2 py-1 hover:bg-slate-100 rounded">取消</button>
                    <button disabled={saving} onClick={() => saveCode(classItem)} className="text-sm bg-cyan-700 text-white px-3 py-1 rounded hover:bg-cyan-800 disabled:opacity-50">{saving ? '儲存中…' : '儲存'}</button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => onSelectClass(classItem.id)} className="p-1.5 text-slate-400 hover:text-cyan-700 hover:bg-cyan-50 rounded" title="切換至此班"><Users className="w-4 h-4" /></button>
                    <button onClick={() => beginEditing(classItem)} className="p-1.5 text-slate-400 hover:text-cyan-700 hover:bg-cyan-50 rounded" title="修改學生查詢碼"><Pencil className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end"><button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">關閉</button></div>
      </div>
    </div>
  );
}

function GroupActionModal({ groupId, onClose, onConfirm }) {
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const value = Number(points);
    if (!Number.isFinite(value) || value === 0) return;
    await onConfirm(value, reason.trim() || '小組自訂加扣分');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up">
        <div className="bg-indigo-600 p-4 flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2"><Edit3 className="w-5 h-5" /> 第 {groupId} 組自訂加扣分</h3>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">加減分數</label>
            <input type="number" required autoFocus value={points} onChange={event => setPoints(event.target.value)} placeholder="例如：5 或 -3" className="w-full px-3 py-2 border rounded-lg font-bold font-mono focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">原因</label>
            <input type="text" value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：合作表現優良" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button><button type="submit" className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700">確認執行</button></div>
        </div>
      </form>
    </div>
  );
}

// --- 小組管理視圖元件 ---
function GroupView({ students, totalGroups, groupPoints, pointDivisor, presets, onAssignGroup, onRemoveFromGroup, onUpdateGroupCount, onGroupPointAction, onShowGroupHistory }) {
  const [groupCountInput, setGroupCountInput] = useState(totalGroups);
  const [inputMap, setInputMap] = useState({}); 
  const [customGroupId, setCustomGroupId] = useState<number | null>(null);

  useEffect(() => { setGroupCountInput(totalGroups); }, [totalGroups]);

  const groups = Array.from({ length: totalGroups }, (_, i) => i + 1);

  const getGroupMembers = (groupId) => {
    return students
      .filter(s => s.groupId === groupId)
      .sort((a, b) => parseInt(a.studentNumber || 0) - parseInt(b.studentNumber || 0));
  };

  const handleSeatInput = (groupId, e) => {
    setInputMap(prev => ({ ...prev, [groupId]: e.target.value }));
  };

  const handleSeatSubmit = (groupId, e) => {
    e.preventDefault();
    const val = inputMap[groupId];
    if (val && val.trim()) {
      onAssignGroup(val.trim(), groupId);
      setInputMap(prev => ({ ...prev, [groupId]: '' }));
    }
  };

  return (
    <div className="animate-fade-in">
      {/* 小組數量設定列 */}
      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4 border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-indigo-600" /> 小組競賽管理
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">分組數量:</span>
          <input 
            type="number" 
            min="1" 
            max="20"
            value={groupCountInput}
            onChange={(e) => setGroupCountInput(parseInt(e.target.value) || 1)}
            className="w-16 px-2 py-1 border rounded text-center font-bold"
          />
          <button 
            onClick={() => onUpdateGroupCount(groupCountInput)}
            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 font-medium shadow-sm"
          >
            套用組數
          </button>
        </div>
      </div>

      {/* 各小組卡片網格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map(groupId => {
          const members = getGroupMembers(groupId);
          return (
            <div key={groupId} className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-80">
              {/* 小組標題 */}
              <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center rounded-t-xl">
                <button type="button" onClick={() => onShowGroupHistory(groupId)} className="font-bold text-slate-700 hover:text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded" title="查看本組加扣分紀錄">第 {groupId} 組</button>
                <div className="flex items-center gap-1.5"><span className="text-xs text-slate-500">小組 {formatPoints(groupPoints[groupId] || 0)} ÷ {formatPoints(pointDivisor)}</span><span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">{members.length} 人</span></div>
              </div>
              
              {/* 輸入座號加入組員 */}
              <div className="p-2 border-b border-slate-100">
                <form onSubmit={(e) => handleSeatSubmit(groupId, e)} className="flex gap-2">
                  <input 
                    type="text" 
                    value={inputMap[groupId] || ''}
                    onChange={(e) => handleSeatInput(groupId, e)}
                    placeholder="輸入座號（可用逗號分隔）"
                    className="flex-1 px-2.5 py-1 text-sm border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <button type="submit" className="text-indigo-600 hover:text-indigo-800 p-1" title="加入成員">
                    <PlusCircle className="w-5 h-5" />
                  </button>
                </form>
              </div>

              {/* 組員名單 */}
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                {members.length === 0 ? (
                  <p className="text-center text-slate-400 text-xs mt-6">尚無成員，可輸入 1,2,3 批次加入</p>
                ) : (
                  <div className="space-y-1">
                    {members.map(m => (
                      <div key={m.id} className="flex justify-between items-center text-sm p-1.5 hover:bg-slate-50 rounded group">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{m.studentNumber || '#'}</span>
                          <span className="font-medium text-slate-800">{m.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${m.totalPoints >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>{formatPoints(m.totalPoints)}</span>
                          <button
                            onClick={() => onRemoveFromGroup(m.id)}
                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                            title="移出此組"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 小組連動加扣分：與個人卡片共用預設／自訂獎勵項目。 */}
              <div className="p-2.5 border-t border-slate-100 bg-slate-50 rounded-b-xl">
                <div className="grid grid-cols-2 gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                  {presets.filter(preset => !preset.isRedemption).map(preset => (
                    <button
                      key={preset.id || preset.presetKey}
                      type="button"
                      onClick={() => onGroupPointAction(groupId, preset.value, preset.label)}
                      className={`bg-white border py-1.5 rounded-lg text-xs font-bold transition shadow-sm ${preset.value > 0 ? 'border-indigo-200 text-indigo-600 hover:bg-indigo-50' : 'border-red-200 text-red-600 hover:bg-red-50'}`}
                    >
                      {preset.value > 0 ? `+${preset.value}` : preset.value} {preset.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setCustomGroupId(groupId)} className="w-full mt-2 bg-white border border-slate-300 border-dashed text-slate-500 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-100 hover:text-indigo-600 transition"><Edit3 className="w-3.5 h-3.5 inline mr-1" />自訂加扣分</button>
              </div>
            </div>
          );
        })}
      </div>
      {customGroupId !== null && (
        <GroupActionModal
          groupId={customGroupId}
          onClose={() => setCustomGroupId(null)}
          onConfirm={async (points, reason) => {
            await onGroupPointAction(customGroupId, points, reason);
            setCustomGroupId(null);
          }}
        />
      )}
    </div>
  );
}

// --- 建立新班級視窗 ---
function CreateClassModal({ onClose, teacherId, onCreated }) {
  const { notify } = useUI();
  const [name, setName] = useState('');
  const [classCode, setClassCode] = useState('');
  
  useEffect(() => {
    const randomBytes = crypto.getRandomValues(new Uint8Array(10));
    const randomCode = Array.from(randomBytes, b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    setClassCode(randomCode);
  }, []);
  
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    const finalCode = classCode.trim().toUpperCase();
    
    if (!/^[A-Z0-9_-]{4,32}$/.test(finalCode)) {
      notify('代碼須為 4–32 位英數字、底線或連字號', 'error'); return;
    }
    try {
      const classRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'classes'));
      const codeRef = doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', finalCode);
      await runTransaction(db, async tx => {
        const existing = await tx.get(codeRef);
        if (existing.exists()) throw new Error('DUPLICATE_CLASS_CODE');
        tx.set(classRef, {
          name: name.trim(), teacherId, classCode: finalCode, totalGroups: 6, groupPointDivisor: 1,
          createdAt: serverTimestamp()
        });
        tx.set(codeRef, { classId: classRef.id, teacherId, createdAt: serverTimestamp() });
      });
      onCreated?.({ id: classRef.id, name: name.trim(), classCode: finalCode });
      notify(`已建立班級：${name.trim()}`);
      onClose();
    } catch (err) {
      console.error(err);
      notify(err.message === 'DUPLICATE_CLASS_CODE' ? '班級代碼已有人使用，請換一組' : '建立班級失敗', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up">
        <div className="bg-indigo-600 p-4 flex justify-between items-center">
          <h3 className="text-white font-bold flex items-center gap-2">
            <PlusCircle className="w-5 h-5" /> 建立新班級
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleCreate} className="p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">班級名稱</label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="例如：一年五班、數學社團"
              autoFocus
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">班級代碼 (學生查分用)</label>
            <input 
              type="text" 
              value={classCode}
              onChange={e => setClassCode(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono tracking-widest uppercase"
              placeholder="自訂英數字"
              required
            />
            <p className="text-xs text-slate-400 mt-1">可自訂易記代碼，建立後亦可於系統設定修改</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md font-bold">建立班級</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 分數統計與 CSV 匯出視窗 ---
function StatsModal({ onClose, students, classId }) {
  const scoreOf = (student) => student.totalPoints ?? student.points;
  const totalPoints = students.reduce((acc, curr) => acc + scoreOf(curr), 0);
  const avgPoints = students.length > 0 ? (totalPoints / students.length).toFixed(1) : 0;
  const maxPoints = students.length > 0 ? Math.max(...students.map(scoreOf)) : 0;
  const minPoints = students.length > 0 ? Math.min(...students.map(scoreOf)) : 0;

  const handleExport = () => {
    const BOM = '\uFEFF';
    let csvContent = BOM + "座號,姓名,目前點數,最後更新原因,最後更新時間\n";
    
    const exportData = [...students].sort((a, b) => parseInt(a.studentNumber || 0) - parseInt(b.studentNumber || 0));
    
    exportData.forEach(s => {
      const dateStr = s.lastUpdate ? new Date(s.lastUpdate.seconds * 1000).toLocaleDateString() : '';
      const safeReason = (s.lastReason || '').replace(/,/g, '，');
      csvContent += `${s.studentNumber || ''},${s.name},${formatPoints(scoreOf(s))},${safeReason},${dateStr}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `分數統計_${classId}_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up flex flex-col max-h-[90vh]">
        <div className="bg-emerald-600 p-4 flex justify-between items-center flex-shrink-0">
          <h3 className="text-white font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5" /> 班級分數統計 ({classId})
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 bg-slate-50 border-b border-slate-200 flex-shrink-0 grid grid-cols-4 gap-3 text-center">
          <div className="bg-white p-2.5 rounded-lg border shadow-sm">
            <div className="text-xs text-slate-500">學生總數</div>
            <div className="font-bold text-lg text-slate-800">{students.length}</div>
          </div>
          <div className="bg-white p-2.5 rounded-lg border shadow-sm">
            <div className="text-xs text-slate-500">平均分數</div>
            <div className="font-bold text-lg text-indigo-600">{avgPoints}</div>
          </div>
          <div className="bg-white p-2.5 rounded-lg border shadow-sm">
            <div className="text-xs text-slate-500">最高分</div>
            <div className="font-bold text-lg text-emerald-600">{maxPoints}</div>
          </div>
          <div className="bg-white p-2.5 rounded-lg border shadow-sm">
            <div className="text-xs text-slate-500">最低分</div>
            <div className="font-bold text-lg text-red-600">{minPoints}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0">
              <tr>
                <th className="px-4 py-2 rounded-tl-lg">座號</th>
                <th className="px-4 py-2">姓名</th>
                <th className="px-4 py-2">點數</th>
                <th className="px-4 py-2 rounded-tr-lg">最後更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...students].sort((a, b) => parseInt(a.studentNumber || 0) - parseInt(b.studentNumber || 0)).map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-500">{s.studentNumber}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className={`px-4 py-2 font-bold ${scoreOf(s) < 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                    {formatPoints(scoreOf(s))}
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {s.lastReason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition shadow-sm font-bold text-sm"
          >
            <Download className="w-4 h-4" />
            匯出 Excel (CSV)
          </button>
        </div>
      </div>
    </div>
  );
}

// --- 全班批次加扣分視窗 ---
function BatchActionModal({ onClose, onConfirm, presets, studentCount }) {
  const { notify } = useUI();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const handlePresetClick = (preset) => {
    setPoints(preset.value);
    setReason(preset.label);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const p = parseInt(points);
    if (isNaN(p) || p === 0) {
      notify('請輸入有效的非零分數', 'error');
      return;
    }
    if (!reason.trim()) {
      notify('請輸入加扣分理由', 'error');
      return;
    }
    onConfirm(p, reason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
        <div className="bg-pink-600 p-4 flex justify-between items-center">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Zap className="w-5 h-5" /> 全班加扣分 ({studentCount}人)
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5">
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">快速選擇預設項目</label>
            {presets.length === 0 ? (
              <p className="text-sm text-slate-400 italic">尚未設定獎勵項目，請至「獎勵項目設定」新增。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {presets.filter(preset => !preset.isRedemption).map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition flex items-center gap-1
                      ${preset.value > 0 
                        ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' 
                        : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
                  >
                    <span>{preset.label}</span>
                    <span className="font-bold">
                      {preset.value > 0 ? `+${preset.value}` : preset.value}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 my-4"></div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">分數 (可為負數)</label>
                <input
                  type="number"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-pink-500 outline-none font-mono font-bold text-lg"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">理由</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                  placeholder="例如: 班級秩序優良"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
              <button type="submit" className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 shadow-md font-bold">
                確認執行
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- 自訂獎勵項目設定視窗 ---
function ManagePresetsModal({ onClose, presets, teacherId }) {
  const { notify, askConfirm } = useUI();
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [isRedemption, setIsRedemption] = useState(false);
  const positivePreset = presets.find(preset => preset.presetKey === 'positive') || BUILT_IN_PRESETS[0];
  const negativePreset = presets.find(preset => preset.presetKey === 'negative') || BUILT_IN_PRESETS[1];
  const [defaultValues, setDefaultValues] = useState({
    positiveLabel: positivePreset.label, positiveValue: String(positivePreset.value),
    negativeLabel: negativePreset.label, negativeValue: String(negativePreset.value)
  });

  useEffect(() => {
    setDefaultValues({
      positiveLabel: positivePreset.label, positiveValue: String(positivePreset.value),
      negativeLabel: negativePreset.label, negativeValue: String(negativePreset.value)
    });
  }, [positivePreset.label, positivePreset.value, negativePreset.label, negativePreset.value]);

  const saveDefault = async (presetKey) => {
    const isPositive = presetKey === 'positive';
    const nextLabel = (isPositive ? defaultValues.positiveLabel : defaultValues.negativeLabel).trim();
    const nextValue = Number(isPositive ? defaultValues.positiveValue : defaultValues.negativeValue);
    if (!nextLabel || !Number.isFinite(nextValue) || nextValue === 0) {
      notify('請輸入項目名稱與非 0 分數', 'error');
      return;
    }
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reward_presets', `${teacherId}_default_${presetKey}`), {
        label: nextLabel, value: nextValue, classId: teacherId, presetKey, updatedAt: serverTimestamp()
      }, { merge: true });
      notify('預設項目已儲存');
    } catch (error) {
      console.error(error);
      notify('儲存預設項目失敗', 'error');
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!label.trim() || !value) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reward_presets'), {
        label: label.trim(),
        value: isRedemption ? -Math.abs(parseInt(value)) : parseInt(value),
        isRedemption,
        classId: teacherId, 
        createdAt: serverTimestamp()
      });
      setLabel('');
      setValue('');
      setIsRedemption(false);
      notify('已新增獎勵項目');
    } catch (err) {
      console.error(err);
      notify('新增失敗', 'error');
    }
  };

  const handleDelete = (id, itemLabel) => {
    askConfirm(
      '刪除項目確認',
      `確定要刪除「${itemLabel}」嗎？`,
      async () => {
        try {
          await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reward_presets', id));
          notify('項目已刪除');
        } catch (err) { 
          console.error(err);
          notify('刪除失敗', 'error');
        }
      },
      true
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up flex flex-col max-h-[90vh]">
        <div className="bg-indigo-600 p-4 flex justify-between items-center flex-shrink-0">
          <h3 className="text-white font-bold flex items-center gap-2">
            <List className="w-5 h-5" /> 獎勵項目設定
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 bg-slate-50 border-b border-slate-200 flex-shrink-0 space-y-3">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">預設項目（個人與小組共用）</p>
            <div className="grid grid-cols-2 gap-2">
              {[['positive', '加分', 'positiveLabel', 'positiveValue'], ['negative', '扣分', 'negativeLabel', 'negativeValue']].map(([presetKey, title, labelKey, valueKey]) => (
                <div key={presetKey} className="bg-white border rounded-lg p-2 space-y-1.5">
                  <p className="text-xs font-bold text-slate-600">{title}</p>
                  <input value={(defaultValues as any)[labelKey]} onChange={event => setDefaultValues(previous => ({ ...previous, [labelKey]: event.target.value }))} className="w-full px-2 py-1 border rounded text-sm" aria-label={`${title}原因`} />
                  <div className="flex gap-1"><input type="number" value={(defaultValues as any)[valueKey]} onChange={event => setDefaultValues(previous => ({ ...previous, [valueKey]: event.target.value }))} className="min-w-0 flex-1 px-2 py-1 border rounded text-sm font-mono" aria-label={`${title}分數`} /><button type="button" onClick={() => saveDefault(presetKey)} className="text-xs bg-indigo-600 text-white px-2 rounded hover:bg-indigo-700">儲存</button></div>
                </div>
              ))}
            </div>
          </div>
          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex gap-2">
            <input 
              type="text" 
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="項目名稱 (如: 幫忙跑腿)" 
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
            <input 
              type="number" 
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={isRedemption ? "扣除點數" : "分數"}
              className="w-20 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
            <button type="submit" className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700" title="新增項目">
              <Plus className="w-5 h-5" />
            </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-amber-800 cursor-pointer">
              <input type="checkbox" checked={isRedemption} onChange={e => setIsRedemption(e.target.checked)} />
              學生兌獎項目（扣除點數，但不標示為扣分）
            </label>
          </form>
        </div>

        <div className="overflow-y-auto p-4 space-y-2 flex-1">
          {presets.filter(preset => !preset.presetKey).length === 0 ? (
            <div className="text-center text-slate-500 py-8 text-sm flex flex-col items-center">
              <p className="mb-1 font-medium">尚未設定任何自訂項目</p>
              <p className="text-xs text-slate-400">新增後，所有班級皆可共用這些快速按鈕</p>
            </div>
          ) : (
            presets.filter(preset => !preset.presetKey).map(p => (
              <div key={p.id} className="flex justify-between items-center bg-white p-3 rounded-lg border shadow-sm">
                <div className="flex items-center gap-2">
                  <span className={`font-bold w-14 text-center ${p.isRedemption ? 'text-amber-700' : p.value > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {p.isRedemption ? `兌 −${Math.abs(p.value)}` : p.value > 0 ? `+${p.value}` : p.value}
                  </span>
                  <span className="text-slate-700 font-medium">{p.label}{p.isRedemption && <span className="ml-1 text-xs text-amber-700">兌獎</span>}</span>
                </div>
                <button onClick={() => handleDelete(p.id, p.label)} className="text-slate-400 hover:text-red-500 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- 系統設定視窗 (一般 / 班級管理 / 備份與匯入 / 安全) ---
function SettingsModal({ onClose, classId, teacherUid, currentEmail, currentBackupUrl, classes = [], selectedClassId, onBatchImport, isPrimaryAdmin = false }) {
  const { notify, askConfirm } = useUI();
  const [activeTab, setActiveTab] = useState('general'); 
  const [email, setEmail] = useState(currentEmail || '');
  const [backupUrl, setBackupUrl] = useState(currentBackupUrl || '');
  const [editingClassId, setEditingClassId] = useState(null);
  const [editingClassName, setEditingClassName] = useState('');
  const [editingClassCode, setEditingClassCode] = useState('');
  const [editingGroupPointDivisor, setEditingGroupPointDivisor] = useState('1');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [importText, setImportText] = useState('');
  const [teacherRequests, setTeacherRequests] = useState<any[]>([]);

  useEffect(() => {
    if (!isPrimaryAdmin) { setTeacherRequests([]); return undefined; }
    const requestsRef = collection(db, 'artifacts', appId, 'public', 'data', 'teacher_requests');
    return onSnapshot(requestsRef, snapshot => {
      const pending = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as any))
        .filter(item => item.status === 'pending')
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      setTeacherRequests(pending);
    }, err => {
      console.error('讀取教師申請失敗', err);
      notify('無法讀取教師申請，請確認已發布最新 Firestore Rules。', 'error');
    });
  }, [isPrimaryAdmin, notify]);

  const handleUpdateGeneral = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const authDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'teachers', teacherUid);
      await updateDoc(authDocRef, { email: email.trim(), updatedAt: serverTimestamp() });
      notify('一般設定已儲存！');
    } catch (err) { 
      console.error(err); 
      notify('更新失敗', 'error'); 
    }
    setLoading(false);
  };

  const handleUpdateBackup = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const authDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'teachers', teacherUid);
      await updateDoc(authDocRef, { backupUrl: backupUrl.trim(), updatedAt: serverTimestamp() });
      notify('雲端備份設定已儲存！');
    } catch (err) { 
      console.error(err); 
      notify('更新失敗', 'error'); 
    }
    setLoading(false);
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (!oldPassword || !newPassword || !confirmPassword) { setError('請填寫所有欄位'); return; }
    if (newPassword.length < 8) { setError('新密碼至少 8 碼'); return; }
    if (newPassword !== confirmPassword) { setError('兩次輸入的新密碼不符'); return; }
    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.isAnonymous || !currentUser.email) throw new Error('NOT_TEACHER');
      const credential = EmailAuthProvider.credential(currentUser.email, oldPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      notify('Firebase 教師密碼修改成功');
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      console.error('Firebase 密碼變更失敗', err);
      setError('舊密碼錯誤、驗證已過期或網路錯誤');
    } finally { setLoading(false); }
  };

  const handleUpdateClassInfo = async (id) => {
    const name = editingClassName.trim();
    const nextCode = editingClassCode.trim().toUpperCase();
    const groupPointDivisor = Number(editingGroupPointDivisor);
    if (!name || !/^[A-Z0-9_-]{4,32}$/.test(nextCode) || !Number.isFinite(groupPointDivisor) || groupPointDivisor <= 0 || groupPointDivisor > 100) {
      notify('請填寫名稱、4–32 位合法班級代碼，N 須介於 0 到 100', 'error'); return;
    }
    try {
      const classRef = doc(db, 'artifacts', appId, 'public', 'data', 'classes', id);
      const nextRef = doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', nextCode);
      await runTransaction(db, async tx => {
        const oldClass = await tx.get(classRef);
        if (!oldClass.exists() || oldClass.data().teacherId !== classId) throw new Error('NOT_OWNER');
        const previousCode = oldClass.data().classCode;
        if (previousCode !== nextCode) {
          const existing = await tx.get(nextRef);
          if (existing.exists()) throw new Error('DUPLICATE_CLASS_CODE');
          tx.set(nextRef, { classId: id, teacherId: classId, createdAt: serverTimestamp() });
          if (previousCode) {
            const oldRef = doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', previousCode);
            tx.delete(oldRef);
          }
        }
        tx.update(classRef, { name, classCode: nextCode, groupPointDivisor });
      });
      setEditingClassId(null);
      notify('班級資訊已更新');
    } catch (err) {
      console.error(err);
      notify(err.message === 'DUPLICATE_CLASS_CODE' ? '代碼已被其他班級使用' : '修改失敗', 'error');
    }
  };

  const handleDeleteClass = (classItem) => {
    askConfirm(
      '刪除班級資料確認',
      `確定刪除「${classItem.name}」的 Firebase 班級、小組、學生與點數歷程嗎？此動作無法復原。Google 試算表既有分頁不會被刪除。`,
      async () => {
        try {
          const base = ['student_points', 'point_history', 'group_points'];
          for (const collectionName of base) {
            const snapshot = await getDocs(query(collection(db, 'artifacts', appId, 'public', 'data', collectionName), where('classId', '==', classItem.id)));
            const docs = snapshot.docs;
            for (let start = 0; start < docs.length; start += MAX_BATCH_WRITES) {
              const batch = writeBatch(db);
              docs.slice(start, start + MAX_BATCH_WRITES).forEach(item => batch.delete(item.ref));
              await batch.commit();
            }
          }
          const batch = writeBatch(db);
          if (classItem.classCode) batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'class_codes', classItem.classCode));
          batch.delete(doc(db, 'artifacts', appId, 'public', 'data', 'classes', classItem.id));
          await batch.commit();
          if (selectedClassId === classItem.id) removeLocal(`last_selected_class_${classId}`);
          notify('班級資料已從網站資料庫刪除；Google 試算表分頁已保留。');
        } catch (err) {
          console.error(err);
          notify('刪除班級失敗，請確認已發布最新 Firestore Rules', 'error');
        }
      },
      true
    );
  };

  const copyText = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        notify('班級代碼已複製！');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    notify('班級代碼已複製！');
  };

  const onImportSubmit = () => {
    onBatchImport(importText);
    setImportText('');
  };

  const reviewTeacherRequest = (requestItem, decision) => {
    const approved = decision === 'approved';
    askConfirm(
      approved ? '核准教師申請' : '駁回教師申請',
      approved
        ? `確定核准 ${requestItem.name}（${requestItem.organization}，${requestItem.email}）？核准後此帳號可建立及管理自己的班級。`
        : `確定駁回 ${requestItem.name}（${requestItem.email}）的教師申請？`,
      async () => {
        try {
          await runTransaction(db, async tx => {
            const requestRef = doc(db, 'artifacts', appId, 'public', 'data', 'teacher_requests', requestItem.id);
            const current = await tx.get(requestRef);
            if (!current.exists() || current.data().status !== 'pending') throw new Error('REQUEST_NOT_PENDING');
            if (approved) {
              tx.set(doc(db, 'artifacts', appId, 'public', 'data', 'teachers', requestItem.id), {
                teacherId: requestItem.id,
                email: current.data().email,
                backupUrl: '',
                createdAt: serverTimestamp()
              });
            }
            tx.update(requestRef, {
              status: decision,
              reviewedAt: serverTimestamp(),
              reviewedBy: teacherUid
            });
          });
          notify(approved ? '已核准教師帳號。' : '已駁回教師申請。');
        } catch (err) {
          console.error('審核教師申請失敗', err);
          notify('審核失敗，請確認最新 Firestore Rules 已發布。', 'error');
        }
      },
      !approved
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up">
        <div className="bg-slate-800 p-4 flex justify-between items-center">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" /> 系統設定
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        
        {/* 設定分頁標籤 */}
        <div className="flex border-b border-slate-200 overflow-x-auto no-scrollbar">
          <button onClick={() => setActiveTab('general')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'general' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>一般</button>
          <button onClick={() => setActiveTab('classes')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'classes' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>班級管理</button>
          <button onClick={() => setActiveTab('backup')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'backup' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>備份</button>
          <button onClick={() => setActiveTab('security')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'security' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>安全</button>
          {isPrimaryAdmin && <button onClick={() => setActiveTab('teacherRequests')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'teacherRequests' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>教師審核{teacherRequests.length ? ` (${teacherRequests.length})` : ''}</button>}
        </div>

        <div className="p-6">
          {/* 1. 一般設定 */}
          {activeTab === 'general' && (
            <form onSubmit={handleUpdateGeneral} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">教師信箱 (用於接收日報表)</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="example@gmail.com" />
                </div>
              </div>
              <div className="pt-4">
                <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700 transition shadow-md">{loading ? '儲存中...' : '儲存設定'}</button>
              </div>
            </form>
          )}

          {/* 2. 班級管理 (修改名稱與自訂班級代碼) */}
          {activeTab === 'classes' && (
            <div className="space-y-4 max-h-[320px] overflow-y-auto">
              {classes.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">尚未建立班級</p>
              ) : (
                classes.map(c => (
                  <div key={c.id} className="p-3 border rounded-lg bg-slate-50">
                    {editingClassId === c.id ? (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-500">班級名稱</label>
                        <input value={editingClassName} onChange={(e) => setEditingClassName(e.target.value)} className="px-2 py-1 text-sm border rounded bg-white" placeholder="班級名稱"/>
                        <label className="text-xs text-slate-500">班級代碼 (學生查分用)</label>
                        <input value={editingClassCode} onChange={(e) => setEditingClassCode(e.target.value.toUpperCase())} className="px-2 py-1 text-sm border rounded font-mono bg-white uppercase" placeholder="班級代碼"/>
                        <label className="text-xs text-slate-500">小組積分換算 N（小組分數 ÷ N）</label>
                        <input type="number" min="0.01" max="100" step="0.01" value={editingGroupPointDivisor} onChange={(e) => setEditingGroupPointDivisor(e.target.value)} className="px-2 py-1 text-sm border rounded bg-white" />
                        <div className="flex justify-end gap-2 mt-1">
                          <button onClick={() => setEditingClassId(null)} className="text-xs text-slate-500 hover:text-slate-700 border bg-white px-2.5 py-1 rounded">取消</button>
                          <button onClick={() => handleUpdateClassInfo(c.id)} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded hover:bg-emerald-700 font-bold">儲存</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-slate-800 block">{c.name}</span>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-xs text-slate-400">代碼:</span>
                            <span className="text-xs bg-white border border-slate-200 text-indigo-700 font-bold px-2 py-0.5 rounded font-mono">
                              {c.classCode || c.id}
                            </span>
                            <button onClick={() => copyText(c.classCode || c.id)} className="text-slate-400 hover:text-indigo-600" title="複製班級代碼">
                              <Copy className="w-3.5 h-3.5"/>
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-1"><button onClick={() => { setEditingClassId(c.id); setEditingClassName(c.name); setEditingClassCode(c.classCode || c.id); setEditingGroupPointDivisor(String(c.groupPointDivisor || 1)); }} className="text-slate-400 hover:text-indigo-600 p-1" title="編輯班級名稱、代碼與 N"><Pencil className="w-4 h-4" /></button><button onClick={() => handleDeleteClass(c)} className="text-slate-400 hover:text-red-600 p-1" title="刪除班級資料"><Trash2 className="w-4 h-4" /></button></div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          
          {/* 3. 雲端備份與批次文字匯入還原 */}
          {activeTab === 'backup' && (
            <div className="space-y-5">
              <form onSubmit={handleUpdateBackup} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Google Apps Script 備份網址</label>
                  <input type="url" value={backupUrl} onChange={(e) => setBackupUrl(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-mono" placeholder="https://script.google.com/macros/s/.../exec" />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700 transition shadow-md text-sm">{loading ? '儲存中...' : '儲存備份網址'}</button>
              </form>
              
              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5"><Upload className="w-4 h-4 text-indigo-600"/> 批次匯入 / 還原資料</h4>
                <p className="text-xs text-slate-500 mb-2">請貼上文字資料（格式：<span className="font-mono bg-slate-100 px-1 rounded">座號 姓名 總分</span>），每行一位學生。</p>
                <textarea
                  className="w-full h-28 px-3 py-2 border rounded-lg text-xs font-mono mb-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder={`01 王小明 10\n02 李大華 5\n...`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <button 
                  type="button"
                  onClick={onImportSubmit}
                  className="w-full bg-white border border-indigo-500 text-indigo-600 font-bold py-2 rounded-lg hover:bg-indigo-50 transition shadow-sm flex items-center justify-center gap-2 text-sm"
                >
                  <FileInput className="w-4 h-4" /> 確認匯入至目前班級
                </button>
              </div>
            </div>
          )}

          {/* 4. 帳號安全 (修改密碼) */}
          {activeTab === 'security' && (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">舊密碼</label><input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">新密碼</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">確認新密碼</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
              {error && <div className="text-red-500 text-sm bg-red-50 p-2 rounded">{error}</div>}
              <div className="pt-2"><button type="submit" disabled={loading} className="w-full bg-slate-800 text-white font-bold py-2 rounded-lg hover:bg-slate-900 transition shadow-md">{loading ? '處理中...' : '確認修改密碼'}</button></div>
            </form>
          )}

          {isPrimaryAdmin && activeTab === 'teacherRequests' && (
            <div className="space-y-3 max-h-[360px] overflow-y-auto">
              <p className="text-xs text-slate-500">核對姓名、學校／單位與電子郵件後，再決定是否開通教師權限。</p>
              {teacherRequests.length === 0 ? <p className="text-sm text-center py-8 text-slate-400">目前沒有待審核的教師申請</p>
                : teacherRequests.map(requestItem => <div key={requestItem.id} className="border rounded-lg p-3 bg-amber-50/50">
                  <p className="font-bold text-slate-800">{requestItem.name || '未填姓名'}</p>
                  <p className="text-xs text-slate-600 mt-1">{requestItem.organization || '未填學校／單位'}</p>
                  <p className="text-xs text-indigo-700 mt-1 break-all">{requestItem.email}</p>
                  <div className="flex justify-end gap-2 mt-3"><button onClick={() => reviewTeacherRequest(requestItem, 'rejected')} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 bg-white rounded hover:bg-red-50">駁回</button><button onClick={() => reviewTeacherRequest(requestItem, 'approved')} className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded hover:bg-emerald-700">核准</button></div>
                </div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 小組加扣分歷程 ---
function GroupHistoryModal({ groupId, classId, onClose }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const historyQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'point_history'),
      where('classId', '==', classId),
      where('groupId', '==', groupId),
      where('type', '==', '小組加扣分')
    );
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const seenEvents = new Set<string>();
      const rows = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as any))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .filter(entry => {
          const eventKey = entry.eventId || entry.id;
          if (seenEvents.has(eventKey)) return false;
          seenEvents.add(eventKey);
          return true;
        });
      setEntries(rows);
      setLoading(false);
    }, (snapshotError) => {
      console.error('讀取小組歷程失敗', snapshotError);
      setError('無法取得小組加扣分紀錄，請檢查網路或 Firestore 權限。');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [classId, groupId]);

  const formatTime = (timestamp) => timestamp?.seconds
    ? new Date(timestamp.seconds * 1000).toLocaleString('zh-TW', { hour12: false })
    : '剛剛';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden animate-fade-in-up">
        <div className="bg-indigo-600 p-4 flex items-center justify-between"><h3 className="text-white font-bold flex items-center gap-2"><History className="w-5 h-5" /> 第 {groupId} 組加扣分紀錄</h3><button type="button" onClick={onClose} className="text-white/80 hover:text-white p-1" aria-label="關閉紀錄"><X className="w-5 h-5" /></button></div>
        <div className="overflow-y-auto max-h-[60vh] p-4">
          {loading ? <div className="py-10 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />載入紀錄中...</div>
            : error ? <p className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</p>
            : entries.length === 0 ? <p className="py-10 text-center text-slate-400 text-sm">目前尚無本組加扣分紀錄</p>
            : <div className="space-y-2">{entries.map(entry => <div key={entry.id} className="border border-slate-100 rounded-lg p-3 flex items-center gap-3"><span className={`shrink-0 font-black text-lg ${entry.change >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>{entry.change > 0 ? `+${entry.change}` : entry.change}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-700 truncate">{entry.reason || '未填寫原因'}</p><p className="text-xs text-slate-400 mt-1">{formatTime(entry.createdAt)}</p></div></div>)}</div>}
        </div>
      </div>
    </div>
  );
}

// --- 學生個人加扣分歷程 ---
function StudentHistoryModal({ student, classId, onClose }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!student?.id || !classId) return undefined;
    const historyQuery = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'point_history'),
      where('classId', '==', classId),
      where('studentId', '==', student.id)
    );
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const rows = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as any))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setEntries(rows);
      setLoading(false);
    }, (snapshotError) => {
      console.error('讀取學生歷程失敗', snapshotError);
      setError('無法取得加扣分紀錄，請檢查網路或 Firestore 權限。');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [classId, student?.id]);

  const formatTime = (timestamp) => timestamp?.seconds
    ? new Date(timestamp.seconds * 1000).toLocaleString('zh-TW', { hour12: false })
    : '剛剛';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden animate-fade-in-up">
        <div className="bg-indigo-600 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold flex items-center gap-2"><History className="w-5 h-5" /> {student.name} 的加扣分紀錄</h3>
            <p className="text-indigo-100 text-xs mt-1">座號 {student.studentNumber || '未設定'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white p-1" aria-label="關閉紀錄"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto max-h-[60vh] p-4">
          {loading ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />載入紀錄中...</div>
          ) : error ? (
            <p className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</p>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-slate-400 text-sm">目前尚無可查詢的加扣分紀錄</p>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <div key={entry.id} className="border border-slate-100 rounded-lg p-3 flex items-center gap-3">
                  <span className={`shrink-0 font-black text-lg ${entry.change >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>
                    {entry.change > 0 ? `+${entry.change}` : entry.change}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 truncate">{entry.reason || '未填寫原因'}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatTime(entry.createdAt)}{entry.type ? ` · ${entry.type}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 學生個人點數操作卡片 (上 1/3 資訊區，下 2/3 快速加扣分按鈕區) ---
type StudentCardProps = {
  student: any;
  onUpdatePoints: (student: any, change: number, reason?: string) => Promise<boolean>;
  onDelete: (studentId: string, studentName: string) => void;
  onShowHistory: (student: any) => void;
  presets: any[];
};

const StudentCard = React.memo(function StudentCard({ student, onUpdatePoints, onDelete, onShowHistory, presets }: StudentCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customPoints, setCustomPoints] = useState('');
  const [customReason, setCustomReason] = useState('');

  const handlePointChange = async (amount: number, reason = '') => {
    setIsUpdating(true);
    let finalReason = reason;
    if (!finalReason) {
      if (amount === 1) finalReason = "優良表現";
      else if (amount === -1) finalReason = "常規違規";
      else finalReason = "手動調整";
    }
    try {
      return await onUpdatePoints(student, amount, finalReason);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    const p = parseInt(customPoints);
    if (isNaN(p) || p === 0) return;
    const success = await handlePointChange(p, customReason.trim() || '手動調整');
    if (success) {
      setShowCustom(false);
      setCustomPoints('');
      setCustomReason('');
    }
  };

  const score = student.totalPoints ?? student.points;
  const scoreColor = score >= 0
    ? (score > 10 ? "text-indigo-600" : "text-slate-800")
    : "text-red-500";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-80 relative group hover:shadow-md transition-shadow">
      
      {/* 左上角刪除按鈕 (滑鼠移入顯示) */}
      <button 
        onClick={() => onDelete(student.id, student.name)}
        className="absolute top-2 left-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1 z-10 bg-white/70 rounded-full"
        title="刪除學生"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* 右上角手動輸入按鈕 */}
      <button
        onClick={() => setShowCustom(true)}
        className="absolute top-2 right-2 text-slate-400 hover:text-indigo-600 p-1.5 z-10 bg-white/70 rounded-full transition"
        title="直接輸入加減分數"
      >
        <Edit3 className="w-4 h-4" />
      </button>

      {/* 上方 1/3：座號、姓名、最後紀錄與總分 */}
      <div className="h-1/3 bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center justify-between relative">
        <div className="flex items-center gap-3 ml-5">
          <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-base shadow-sm flex-shrink-0">
            {student.studentNumber || "#"}
          </div>
          <div className="overflow-hidden">
            <button
              type="button"
              onClick={() => onShowHistory(student)}
              className="font-bold text-slate-800 text-base md:text-lg truncate max-w-[90px] text-left hover:text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded"
              title="查看加扣分紀錄"
            >
              {student.name}
            </button>
            <p className="text-xs text-slate-400 flex items-center gap-1 truncate max-w-[90px]">
              <History className="w-3 h-3 flex-shrink-0" /> {student.lastReason || '無紀錄'}
            </p>
          </div>
        </div>
        <div className={`text-3xl md:text-4xl font-black ${scoreColor} mr-7`}>
          {formatPoints(score)}
        </div>
      </div>

      {/* 下方 2/3：快速加扣分按鈕網格 */}
      <div className="h-2/3 p-3 bg-white overflow-y-auto custom-scrollbar">
        <div className="grid grid-cols-2 gap-2 content-start">
          {/* 預設與自訂獎勵項目按鈕，皆可在「獎勵項目設定」調整。 */}
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => handlePointChange(p.value, p.isRedemption ? `兌獎：${p.label}` : p.label)}
              disabled={isUpdating}
              className={`flex items-stretch h-12 rounded-lg border overflow-hidden shadow-sm hover:shadow-md transition active:scale-95 group/btn
                ${p.isRedemption ? 'border-amber-200' : p.value > 0 ? 'border-blue-100' : 'border-pink-100'}`}
            >
              <div className={`w-1/3 flex items-center justify-center font-bold text-lg border-r transition
                ${p.isRedemption ? 'bg-amber-50 text-amber-700 border-amber-200 group-hover/btn:bg-amber-100' : p.value > 0
                  ? 'bg-blue-50 text-blue-600 border-blue-100 group-hover/btn:bg-blue-100' 
                  : 'bg-pink-50 text-pink-600 border-pink-100 group-hover/btn:bg-pink-100'}`}>
                {p.isRedemption ? `兌 −${Math.abs(p.value)}` : p.value > 0 ? `+${p.value}` : p.value}
              </div>
              <div className={`w-2/3 flex items-center justify-center bg-white text-sm font-medium px-1 text-center leading-tight
                ${p.isRedemption ? 'text-amber-800' : p.value > 0 ? 'text-blue-700' : 'text-pink-700'}`}>
                {p.label}
              </div>
            </button>
          ))}

          {/* 直接輸入加減分按鈕 (不需先建立項目) */}
          <button 
            onClick={() => setShowCustom(true)}
            className="flex items-center justify-center h-11 rounded-lg border border-slate-300 border-dashed bg-slate-50 text-slate-500 font-medium text-sm hover:bg-slate-100 hover:text-indigo-600 transition active:scale-95 col-span-2"
          >
            <Edit3 className="w-4 h-4 mr-1.5" /> 自訂加扣分
          </button>
        </div>
      </div>
      
      {/* 直接輸入加減分的覆蓋層 */}
      {showCustom && (
        <div className="absolute inset-0 bg-white/95 z-20 flex flex-col p-4 animate-fade-in">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <Edit3 className="w-4 h-4 text-indigo-600" /> 直接調整分數 ({student.name})
            </span>
            <button onClick={() => setShowCustom(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleCustomSubmit} className="flex flex-col gap-3 flex-1 justify-center">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">加減分數 (正數加分、負數扣分)</label>
              <input
                type="number"
                required
                value={customPoints}
                onChange={(e) => setCustomPoints(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-base font-bold font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="例如：5 或 -3"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">理由 (選填)</label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="預設為「手動調整」"
              />
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-indigo-700 shadow-md mt-1">
              確認送出
            </button>
          </form>
        </div>
      )}
    </div>
  );
});
