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

const DRAW_CARD_DEFAULTS = [
  ['class_applause', '全班讚賞卡', '全班給你 10 秒鐘的熱烈掌聲鼓勵。', 8, '#BCE0E6'],
  ['dj_song', '點歌 DJ 卡', '下課或潔牙後，挑選 2 首正向歌曲播放給全班聽。', 7, '#FFE58F'],
  ['class_bonus', '全班加分卡', '老師幫全班加上 5 個榮譽點數。', 7, '#BCE2CE'],
  ['self_bonus', '自己加分卡', '老師幫你加上 10 個榮譽點數。', 7, '#F7C699'],
  ['snack_1', '活力補給卡', '可以兌換 1 包餅乾。', 7, '#FAD199'],
  ['snack_2', '活力加倍卡', '可以兌換 2 包餅乾。', 7, '#FAD199'],
  ['drink_1', '精力補給卡', '可以兌換一瓶飲料。', 7, '#BCE2F7'],
  ['less_homework', '作業少寫卡', '課文寫前面一半，另一半用唸的。', 7, '#BCE2F7'],
  ['exam_hint', '考試有神卡', '小考時，老師可以提示一題不會的題目。', 7, '#BCE2CE'],
  ['stationery', '文具兌換卡', '可以兌換紅筆、藍筆或橡皮擦。', 7, '#F7C6CC'],
  ['nap_free', '午休自由卡', '午休時間可安靜做自己的事或寫功課。', 7, '#BCE2E6'],
  ['show_toy', '今日炫寶卡', '今天可以帶一個玩具到校並於下課使用。', 7, '#D6C4E8'],
  ['recess_free', '下課自由卡', '可以自由下課。', 7, '#FAD199'],
  ['super_lucky', '超級幸運卡', '可以再抽兩張卡片！', 2, '#FFE066'],
  ['double_points', '加分加倍卡', '老師幫你加上 20 個榮譽點數。', 2, '#F7C6D0'],
  ['teacher_help', '老師代勞卡', '老師幫你抄一天的聯絡簿。', 2, '#D6C4E8'],
  ['warm_card', '溫馨卡片卡', '獲得老師寫的一張鼓勵小卡。', 2, '#F7C6CC']
].map(([id, name, desc, weight, borderColor]) => ({ id, name, desc, weight, borderColor, enabled: true }));

// 學生查分頁的獎勵卡說明。內容依據「班級獎勵卡整理」提供的使用規則，
// 不含抽卡權重或教師端設定，學生僅可閱讀。
const STUDENT_REWARD_GUIDE = [
  { name: '點歌 DJ 卡', description: '一節下課時間或潔牙後，由你挑選 2 首正向歌曲播放給全班聽。', emoji: '🎵', color: 'bg-amber-50 border-amber-200' },
  { name: '超級幸運卡', description: '可以再抽兩張卡片。', emoji: '🍀', color: 'bg-yellow-50 border-yellow-300' },
  { name: '全班加分卡', description: '老師幫全班加上 5 個榮譽點數。', emoji: '🏫', color: 'bg-emerald-50 border-emerald-200' },
  { name: '自己加分卡', description: '老師幫你加上 10 個榮譽點數。', emoji: '⭐', color: 'bg-orange-50 border-orange-200' },
  { name: '加分加倍卡', description: '老師幫你加上 20 個榮譽點數。', emoji: '✨', color: 'bg-rose-50 border-rose-200' },
  { name: '活力補給卡', description: '可以兌換 1 包餅乾，在老師的課堂上可以吃，但不影響學習。', emoji: '🍪', color: 'bg-amber-50 border-amber-200' },
  { name: '活力加倍卡', description: '可以兌換 2 包餅乾，在老師的課堂上可以吃，但不影響學習。', emoji: '🍪🍪', color: 'bg-orange-50 border-orange-200' },
  { name: '精力補給卡', description: '可以兌換一瓶飲料，在老師的課堂上可以喝，但不影響學習。', emoji: '🧃', color: 'bg-sky-50 border-sky-200' },
  { name: '作業少寫卡', description: '課文寫前面一半，另一半用唸的；圈詞寫 1 次；成語句子寫 1 次。', emoji: '📖', color: 'bg-indigo-50 border-indigo-200' },
  { name: '考試有神卡', description: '小考時，老師可以提示你一題不會的題目。', emoji: '💡', color: 'bg-lime-50 border-lime-200' },
  { name: '文具兌換卡', description: '可以兌換一枝紅筆或一隻藍筆或一個橡皮擦。', emoji: '✏️', color: 'bg-pink-50 border-pink-200' },
  { name: '老師代勞卡', description: '老師幫你抄一天的聯絡簿。', emoji: '📝', color: 'bg-violet-50 border-violet-200' },
  { name: '溫馨卡片卡', description: '獲得老師寫給你的一張鼓勵小卡。', emoji: '💌', color: 'bg-rose-50 border-rose-200' },
  { name: '午休自由卡', description: '午休時間可以不用睡覺，可安靜做自己的事或寫功課。', emoji: '🌤️', color: 'bg-cyan-50 border-cyan-200' },
  { name: '全班讚賞卡', description: '全班給你 10 秒鐘的熱烈掌聲鼓勵。', emoji: '👏', color: 'bg-teal-50 border-teal-200' },
  { name: '今日炫寶卡', description: '今天可以帶一個玩具到校，下課可以玩，但不影響上課秩序。', emoji: '🧸', color: 'bg-purple-50 border-purple-200' },
  { name: '自由下課卡', description: '原本一節大下課不能下課，但可以自由下課。', emoji: '🛝', color: 'bg-blue-50 border-blue-200' }
];

const cardImageUrl = (imageKey) => `${import.meta.env.BASE_URL}reward-cards/${imageKey || 'class_applause'}.jpg`;
const withCardImages = (cards) => cards.map(card => ({ ...card, imageKey: card.imageKey || card.id || 'class_applause' }));
const CARD_IMAGE_OPTIONS = DRAW_CARD_DEFAULTS.map(card => ({ id: card.id, name: card.name }));
const drawCardStorageKey = (teacherId) => `studentpoints_draw_cards_${teacherId}`;

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

const QUOTA_HOLD_KEY = 'studentpoints_quota_hold';

const readQuotaHold = () => {
  try {
    const raw = readLocal(QUOTA_HOLD_KEY);
    if (!raw) return null;
    const hold = JSON.parse(raw);
    return hold?.expiresAt > Date.now() ? hold : null;
  } catch { return null; }
};

const pacificReset = () => {
  const zone = 'America/Los_Angeles';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {} as Record<string, string>);
  const nextDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  let timestamp = nextDay.getTime();
  // 以 IANA 時區反覆校正，正確處理夏令時間的 UTC 位移。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offsetLabel = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(timestamp)).find(part => part.type === 'timeZoneName')?.value || 'GMT-08:00';
    const offset = offsetLabel.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : -480;
    timestamp = nextDay.getTime() - minutes * 60 * 1000;
  }
  return timestamp;
};

const isQuotaError = (error) => {
  const message = `${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
  return /resource-exhausted|quota|rate.?limit|too many requests|limit exceeded/.test(message);
};

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
  const [quotaHold, setQuotaHold] = useState(readQuotaHold);

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
  const reportQuotaError = useCallback((error, service = 'Firestore') => {
    if (!isQuotaError(error)) return false;
    const expiresAt = pacificReset();
    const resetAt = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date(expiresAt));
    const hold = { service, expiresAt, resetAt };
    writeLocal(QUOTA_HOLD_KEY, JSON.stringify(hold));
    setQuotaHold(hold);
    return true;
  }, []);
  const uiValue = useMemo(() => ({ notify, askConfirm, reportQuotaError }), [notify, askConfirm, reportQuotaError]);

  useEffect(() => {
    if (!quotaHold) return undefined;
    const clearWhenReset = () => {
      if (quotaHold.expiresAt <= Date.now()) {
        removeLocal(QUOTA_HOLD_KEY);
        setQuotaHold(null);
      }
    };
    clearWhenReset();
    const timer = window.setInterval(clearWhenReset, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [quotaHold]);

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
        {quotaHold && <QuotaHoldModal hold={quotaHold} />}
        
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
            onShowRewardGuide={() => setViewMode('student-rewards')}
          />
        ) : viewMode === 'student-rewards' ? (
          <StudentRewardGuide classId={studentViewClassId} onBack={() => setViewMode('student-dashboard')} />
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

function QuotaHoldModal({ hold }) {
  return (
    <div className="fixed inset-0 z-[130] bg-slate-950/70 flex items-center justify-center p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="quota-hold-title">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden animate-fade-in-up">
        <div className="bg-amber-500 p-5 text-amber-950 flex items-start gap-3"><AlertCircle className="w-7 h-7 shrink-0" /><div><h2 id="quota-hold-title" className="font-bold text-lg">免費用量暫停保護已啟動</h2><p className="text-sm mt-1">{hold.service} 回報配額或速率限制，網站已暫停操作以避免持續失敗。</p></div></div>
        <div className="p-5 space-y-3 text-sm text-slate-600"><p>預計重新計算時間：<strong className="text-slate-900">{hold.resetAt}（台灣時間）</strong></p><p>此時間依 Firestore 每日免費額度的美國太平洋時間午夜推算。時間到後此瀏覽器會自動解除暫停；若雲端仍拒絕請求，請至 Firebase Console 確認用量。</p><p className="rounded-lg bg-slate-100 p-3 text-xs">Google Apps Script 的 no-cors 回應無法由瀏覽器讀取配額狀態；GitHub Pages 若用量超限可能直接無法載入頁面，因此兩者無法在頁內預先偵測。</p></div>
      </div>
    </div>
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
function StudentDashboard({ classId, onBack, onShowRewardGuide }) {
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
    return [...displayedStudents].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 9);
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
          <button type="button" onClick={onShowRewardGuide} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100 transition">
            <Award className="w-4 h-4" /> 查看獎勵卡說明
          </button>
        </header>

        {/* Top 9 榮譽榜 (單列顯示，無座號，前三名金銀銅配色) */}
        <div className="mb-8 w-full mx-auto">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center justify-center gap-2">
            <Crown className="w-4 h-4 text-yellow-500" /> 榮譽榜 (Top 9)
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5">
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

// --- 學生獎勵卡說明頁：僅提供規則說明，不會讀寫或改變任何積分。 ---
function StudentRewardGuide({ classId, onBack }) {
  const [cards, setCards] = useState(() => withCardImages(STUDENT_REWARD_GUIDE.map(card => ({ ...DRAW_CARD_DEFAULTS.find(defaultCard => defaultCard.name === card.name), ...card }))));

  useEffect(() => {
    if (!classId) return;
    const rewardCardRef = doc(db, 'artifacts', appId, 'public', 'data', 'reward_cards', classId);
    return onSnapshot(rewardCardRef, snapshot => {
      const savedCards = snapshot.data()?.cards;
      if (Array.isArray(savedCards) && savedCards.length) setCards(withCardImages(savedCards).filter(card => card.enabled !== false));
    }, error => console.warn('讀取班級獎勵卡設定失敗，改用預設說明。', error));
  }, [classId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-slate-50 to-sky-50 p-4 sm:p-6 text-slate-800">
      <div className="max-w-5xl mx-auto">
        <header className="relative overflow-hidden rounded-2xl bg-white border border-emerald-100 shadow-sm p-6 sm:p-8 text-center">
          <button type="button" onClick={onBack} className="absolute top-4 left-4 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="返回學生查分"><ArrowLeft className="w-4 h-4" /> 返回查分</button>
          <div className="mx-auto mt-4 mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl shadow-sm">🎁</div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-800">班級獎勵卡說明</h1>
          <p className="mt-2 text-sm text-slate-500">抽到獎勵卡時，看看可以獲得什麼鼓勵與權利。</p>
        </header>

        <main className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(card => (
            <article key={card.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <img src={cardImageUrl(card.imageKey)} alt={`${card.name} 圖案`} className="aspect-[4/5] w-full object-cover bg-slate-100" loading="lazy" />
              <div className="p-4"><h2 className="font-black text-slate-800">{card.name}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{card.desc || card.description || '請依老師說明使用此獎勵卡。'}</p></div>
            </article>
          ))}
        </main>

        <p className="mx-auto mt-7 max-w-2xl text-center text-xs leading-5 text-slate-500">獎勵卡使用時請依老師指示進行，並一起維護班級秩序與學習時間。</p>
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
  const { notify, askConfirm, reportQuotaError } = useUI();

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
  const [logoutNotice, setLogoutNotice] = useState('正在將最新資料備份至試算表並安全登出...');
  const autoLogoutStartedRef = useRef(false);
  const logoutWithBackupRef = useRef<((automatic?: boolean) => Promise<void>) | null>(null);
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
  const [selectedScoreStudent, setSelectedScoreStudent] = useState<any>(null);
  const [honorFontScale, setHonorFontScale] = useState(() => {
    const stored = Number(readLocal(`honor_font_scale_${teacherId}`));
    return Number.isFinite(stored) && stored >= 0.8 && stored <= 1.6 ? stored : 1;
  });
  
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
    return [...displayedStudents].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 9);
  }, [displayedStudents]);

  // 切換班級
  const handleClassChange = (e) => {
    const newId = e.target.value;
    setSelectedClassId(newId);
    writeLocal(`last_selected_class_${teacherId}`, newId);
  };

  const changeHonorFontScale = (change) => {
    setHonorFontScale(current => {
      const next = Math.min(1.6, Math.max(0.8, Number((current + change).toFixed(2))));
      writeLocal(`honor_font_scale_${teacherId}`, String(next));
      return next;
    });
  };

  const openDrawCards = () => {
    const destination = `${import.meta.env.BASE_URL}draw-card.html?teacher=${encodeURIComponent(teacherId)}`;
    window.open(destination, '_blank', 'noopener');
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
      if (reportQuotaError(err)) return;
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
  const handleLogoutWithBackup = async (automatic = false) => {
    setLogoutNotice(automatic ? '閒置超過 25 分鐘，正在備份目前分數並安全登出...' : '正在將最新資料備份至試算表並安全登出...');
    setIsLoggingOut(true);
    if (backupUrl && students.length > 0) {
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
  logoutWithBackupRef.current = handleLogoutWithBackup;

  // 教師管理頁面逾 25 分鐘未操作，先上傳目前班級快照再登出。
  // 學生查分頁不會掛載 Dashboard，因此不受此計時器影響。
  useEffect(() => {
    const IDLE_LIMIT_MS = 25 * 60 * 1000;
    let timer: number | undefined;
    const resetIdleTimer = () => {
      if (autoLogoutStartedRef.current) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (autoLogoutStartedRef.current) return;
        autoLogoutStartedRef.current = true;
        void logoutWithBackupRef.current?.(true);
      }, IDLE_LIMIT_MS);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll'];
    events.forEach(eventName => window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    resetIdleTimer();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach(eventName => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, []);

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
          if (reportQuotaError(e)) return;
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
      if (reportQuotaError(err)) return;
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
      if (reportQuotaError(err)) return;
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
      if (reportQuotaError(err)) return false;
      notify('更新分數失敗', 'error');
      return false;
    }
  }, [notify, selectedClassId, sendScoreLog, teacherId]);

  const handleBatchPointsUpdate = async (points, reason, targetStudentIds: string[]) => {
    const selectedStudents = students.filter(student => targetStudentIds.includes(student.id));
    if (selectedStudents.length === 0) {
      notify('請至少選擇一位學生', 'error'); return;
    }
    const finalReason = reason || (points > 0 ? '多人加分' : '多人扣分');
    const eventId = doc(collection(db, 'artifacts', appId, 'public', 'data', 'point_history')).id;
    try {
      // 每位學生會同時更新分數和建立一筆歷程，故每批最多 225 位。
      for (let start = 0; start < selectedStudents.length; start += 225) {
        const batch = writeBatch(db);
        selectedStudents.slice(start, start + 225).forEach(student => {
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
            type: '多人加扣分', eventId, createdAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      setShowBatchActionModal(false);
      notify(`${selectedStudents.length} 位學生已${points > 0 ? `加 ${points}` : `扣 ${Math.abs(points)}`} 分！`);
    } catch (err) { 
      console.error(err); 
      if (reportQuotaError(err)) return;
      notify('多人更新失敗', 'error');
    }
  };

  const deleteStudent = useCallback((studentId, studentName) => {
    askConfirm(
      '刪除學生確認',
      `確定要刪除「${studentName}」的所有點數紀錄嗎？此動作無法復原。`,
      async () => {
        try {
          await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_points', studentId));
          setSelectedScoreStudent(current => current?.id === studentId ? null : current);
          notify(`已刪除 ${studentName}`);
        } catch (err) { 
          console.error(err);
          if (reportQuotaError(err)) return;
          notify('刪除失敗', 'error');
        }
      },
      true
    );
  }, [askConfirm, notify]);

  const updateStudentDetails = useCallback(async (studentId, name, studentNumber) => {
    const nextName = name.trim();
    const nextNumber = studentNumber.trim();
    if (!nextName) {
      notify('學生姓名不可空白', 'error');
      return false;
    }
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'student_points', studentId), {
        name: nextName, studentNumber: nextNumber
      });
      notify('學生資料已更新');
      return true;
    } catch (err) {
      console.error(err);
      if (reportQuotaError(err)) return false;
      notify('修改學生資料失敗', 'error');
      return false;
    }
  }, [notify, reportQuotaError]);

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
      if (reportQuotaError(err)) return;
      notify('批次分組失敗，請檢查網路或 Firestore 存取權限', 'error');
    }
  };

  const handleRemoveFromGroup = async (studentId) => {
    try {
      const studentRef = doc(db, 'artifacts', appId, 'public', 'data', 'student_points', studentId);
      await updateDoc(studentRef, { groupId: null });
    } catch (err) {
      console.error(err);
      reportQuotaError(err);
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
      if (reportQuotaError(err)) return;
      notify('小組加扣分失敗', 'error');
    }
  };

  if (isLoggingOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 flex-col gap-4">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
        <p className="text-slate-600 font-medium">{logoutNotice}</p>
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
                <span>多人加分</span>
              </button>
              <button onClick={() => setShowStatsModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition shadow-md text-sm font-medium">
                <BarChart3 className="w-4 h-4" />
                <span>統計</span>
              </button>
              <button onClick={openDrawCards} className="flex items-center gap-2 bg-amber-500 text-amber-950 px-3 py-2 rounded-lg hover:bg-amber-400 transition shadow-md text-sm font-bold" title="開啟抽獎卡（新分頁）">
                <Award className="w-4 h-4" />
                <span>抽獎卡</span>
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
          <button onClick={() => handleLogoutWithBackup()} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-200 transition text-sm" title="備份並登出">
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
          {/* Top 9 榮譽榜：字體可調整，卡片邊框與尺寸固定。 */}
          <div className="mb-3 animate-fade-in-up w-full mx-auto">
            <h3 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center justify-center gap-2">
              <Crown className="w-4 h-4 text-yellow-500" /> 榮譽榜 (Top 9)
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5">
              {topStudents.length === 0 ? (
                <div className="col-span-full text-center py-6 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                  此班級尚無學生資料
                </div>
              ) : (
                topStudents.map((s, index) => (
                  <div 
                    key={s.id} 
                    className={`relative p-1.5 rounded-lg border shadow-sm flex flex-col items-center justify-center text-center overflow-hidden transition hover:shadow-md
                      ${index === 0 ? 'bg-gradient-to-br from-yellow-50 to-white border-yellow-200 ring-1 ring-yellow-200' : 
                        index === 1 ? 'bg-gradient-to-br from-slate-50 to-white border-slate-200' : 
                        index === 2 ? 'bg-gradient-to-br from-orange-50 to-white border-orange-200' : 'bg-white border-slate-100'}`}
                    style={{ height: '5rem' }}
                  >
                    <div className={`absolute top-0 left-0 px-1.5 py-0.5 font-bold rounded-br z-10 leading-none shadow-sm
                      ${index === 0 ? 'bg-yellow-400 text-yellow-900' : 
                        index === 1 ? 'bg-slate-300 text-slate-700' : 
                        index === 2 ? 'bg-orange-300 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>
                      <span style={{ fontSize: `${0.5625 * honorFontScale}rem` }}>#{index + 1}</span>
                    </div>
                    <div className="mt-3 mb-0.5 font-bold text-slate-800 truncate w-full px-0.5" style={{ fontSize: `${0.75 * honorFontScale}rem` }}>
                      {s.name}
                    </div>
                    <div className={`font-black leading-none ${s.totalPoints >= 0 ? 'text-indigo-600' : 'text-red-500'}`} style={{ fontSize: `${1 * honorFontScale}rem` }}>
                      {formatPoints(s.totalPoints)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {dashboardView === 'list' && (
            <SharedScorePanel
              student={selectedScoreStudent}
              presets={actionPresets}
              onUpdatePoints={updatePoints}
              onClear={() => setSelectedScoreStudent(null)}
            />
          )}

          {/* 切換顯示：列表模式 vs 小組模式 */}
          {dashboardView === 'list' ? (
            students.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl shadow-sm border border-dashed border-slate-300">
                <UserPlus className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-600">目前沒有學生資料</h3>
                <p className="text-slate-400 text-sm mt-1">點擊上方「學生」按鈕新增名單</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 gap-2">
                {displayedStudents.map(student => (
                  <CompactStudentCard
                    key={student.id} 
                    student={student} 
                    selected={selectedScoreStudent?.id === student.id}
                    onSelect={setSelectedScoreStudent}
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
          students={students}
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
          selectedClassName={selectedClass?.name || ''}
          students={students}
          onUpdateStudent={updateStudentDetails}
          onDeleteStudent={deleteStudent}
          onBatchImport={handleBatchImport}
          isPrimaryAdmin={(user.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL}
          honorFontScale={honorFontScale}
          onHonorFontScaleChange={changeHonorFontScale}
          drawCardTeacherId={teacherId}
        />
      )}
    </div>
  );
}

// --- 教師用學生查詢碼管理 ---
// 查分入口採「每班一組查詢碼」設計；此處只讓該班教師檢視與變更自己的代碼。
function StudentQueryModal({ classes, teacherId, selectedClassId, onSelectClass, onClose }) {
  const { notify, reportQuotaError } = useUI();
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
      if (reportQuotaError(error)) return;
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
  const { notify, reportQuotaError } = useUI();
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
      if (reportQuotaError(err)) return;
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

// --- 多人加扣分視窗 ---
function BatchActionModal({ onClose, onConfirm, presets, students }) {
  const { notify } = useUI();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [targetMode, setTargetMode] = useState('all');
  const [seatInput, setSeatInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
    let targets = students;
    if (targetMode === 'numbers') {
      const requestedNumbers = [...new Set(seatInput.split(/[\s,，]+/).map(normalizeSeatNumber).filter(Boolean))];
      if (!requestedNumbers.length) {
        notify('請輸入至少一個座號，例如：1,2,3,5,7', 'error'); return;
      }
      const byNumber = new Map(students.filter(student => student.studentNumber).map(student => [normalizeSeatNumber(student.studentNumber), student]));
      const missing = requestedNumbers.filter(number => !byNumber.has(number));
      if (missing.length) {
        notify(`找不到座號：${missing.join('、')}`, 'error'); return;
      }
      targets = requestedNumbers.map(number => byNumber.get(number));
    } else if (targetMode === 'select') {
      targets = students.filter(student => selectedIds.includes(student.id));
      if (!targets.length) {
        notify('請點選至少一位學生', 'error'); return;
      }
    }
    onConfirm(p, reason.trim(), targets.map(student => student.id));
  };

  const toggleStudent = (id) => setSelectedIds(current =>
    current.includes(id) ? current.filter(item => item !== id) : [...current, id]
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
        <div className="bg-pink-600 p-4 flex justify-between items-center">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Zap className="w-5 h-5" /> 多人加扣分
          </h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5">
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">選擇加扣分對象</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setTargetMode('all')} className={`rounded-lg border px-2 py-2 text-sm font-bold ${targetMode === 'all' ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-slate-600 border-slate-200'}`}>全班加分<br/><span className="text-xs font-normal">{students.length} 人</span></button>
              <button type="button" onClick={() => setTargetMode('numbers')} className={`rounded-lg border px-2 py-2 text-sm font-bold ${targetMode === 'numbers' ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-slate-600 border-slate-200'}`}>輸入座號</button>
              <button type="button" onClick={() => setTargetMode('select')} className={`rounded-lg border px-2 py-2 text-sm font-bold ${targetMode === 'select' ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-slate-600 border-slate-200'}`}>點選座號<br/><span className="text-xs font-normal">{selectedIds.length} 人</span></button>
            </div>
            {targetMode === 'numbers' && <div className="mt-3"><label className="block text-xs text-slate-500 mb-1">座號可用逗號、空格或換行分隔</label><input value={seatInput} onChange={e => setSeatInput(e.target.value)} className="w-full px-3 py-2 border rounded-lg font-mono focus:ring-2 focus:ring-pink-500 outline-none" placeholder="例如：1,2,3,5,7" /></div>}
            {targetMode === 'select' && <div className="mt-3 max-h-40 overflow-y-auto grid grid-cols-4 gap-2 rounded-lg border p-2 bg-slate-50">{students.map(student => { const chosen = selectedIds.includes(student.id); return <button key={student.id} type="button" onClick={() => toggleStudent(student.id)} className={`rounded border px-1 py-2 text-xs ${chosen ? 'bg-pink-600 border-pink-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-pink-300'}`} title={student.name}><span className="block font-bold">{student.studentNumber || '未設'}</span><span className="block truncate">{student.name}</span></button>; })}</div>}
          </div>

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
  const { notify, askConfirm, reportQuotaError } = useUI();
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
      if (reportQuotaError(error)) return;
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
      if (reportQuotaError(err)) return;
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
          if (reportQuotaError(err)) return;
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
function SettingsModal({ onClose, classId, teacherUid, currentEmail, currentBackupUrl, classes = [], selectedClassId, selectedClassName, students = [], onUpdateStudent, onDeleteStudent, onBatchImport, isPrimaryAdmin = false, honorFontScale = 1, onHonorFontScaleChange, drawCardTeacherId }) {
  const { notify, askConfirm, reportQuotaError } = useUI();
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
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingStudentName, setEditingStudentName] = useState('');
  const [editingStudentNumber, setEditingStudentNumber] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [drawCards, setDrawCards] = useState(() => withCardImages(DRAW_CARD_DEFAULTS));
  const [drawCardsLoading, setDrawCardsLoading] = useState(true);

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

  useEffect(() => {
    if (!selectedClassId) { setDrawCards(withCardImages(DRAW_CARD_DEFAULTS)); setDrawCardsLoading(false); return; }
    setDrawCardsLoading(true);
    const rewardCardRef = doc(db, 'artifacts', appId, 'public', 'data', 'reward_cards', selectedClassId);
    return onSnapshot(rewardCardRef, snapshot => {
      const savedCards = snapshot.data()?.cards;
      setDrawCards(Array.isArray(savedCards) && savedCards.length ? withCardImages(savedCards) : withCardImages(DRAW_CARD_DEFAULTS));
      setDrawCardsLoading(false);
    }, error => { console.error('讀取抽獎卡設定失敗', error); setDrawCardsLoading(false); });
  }, [selectedClassId]);

  const handleUpdateGeneral = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const authDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'teachers', teacherUid);
      await updateDoc(authDocRef, { email: email.trim(), updatedAt: serverTimestamp() });
      notify('一般設定已儲存！');
    } catch (err) { 
      console.error(err); 
      if (reportQuotaError(err)) return;
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
      if (reportQuotaError(err)) return;
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
      if (reportQuotaError(err)) return;
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
          if (reportQuotaError(err)) return;
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

  const beginStudentEdit = (student) => {
    setEditingStudentId(student.id);
    setEditingStudentName(student.name || '');
    setEditingStudentNumber(student.studentNumber || '');
  };

  const saveStudent = async (student) => {
    setSavingStudent(true);
    try {
      const saved = await onUpdateStudent?.(student.id, editingStudentName, editingStudentNumber);
      if (saved) setEditingStudentId(null);
    } finally { setSavingStudent(false); }
  };

  const updateDrawCard = (cardId, field, value) => {
    setDrawCards(current => current.map(card => card.id === cardId ? { ...card, [field]: field === 'weight' ? Math.max(0, Number(value) || 0) : value } : card));
  };

  const addDrawCard = () => {
    const id = `custom_${Date.now()}`;
    setDrawCards(current => [...current, { id, name: '新獎卡', desc: '請填寫獎勵內容。', weight: 1, borderColor: '#BCE2F7', imageKey: 'class_applause', enabled: true }]);
  };

  const removeDrawCard = (cardId) => {
    setDrawCards(current => current.filter(card => card.id !== cardId));
  };

  const saveDrawCards = async () => {
    const hasEnabledCard = drawCards.some(card => card.enabled !== false && Number(card.weight) > 0);
    if (!hasEnabledCard) {
      notify('至少要保留一張已啟用且權重大於 0 的獎卡。', 'error');
      return;
    }
    if (!selectedClassId) { notify('請先在主畫面選擇要設定的班級。', 'error'); return; }
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reward_cards', selectedClassId), { classId: selectedClassId, cards: withCardImages(drawCards), updatedAt: serverTimestamp() });
      // 抽獎卡獨立頁維持同瀏覽器快速讀取；學生說明頁則使用上方 Firestore 班級設定。
      writeLocal(drawCardStorageKey(drawCardTeacherId), JSON.stringify(withCardImages(drawCards)));
      notify('抽獎卡設定已儲存；學生說明頁與抽獎卡會同步更新。');
    } catch (saveError) {
      console.error('儲存抽獎卡設定失敗', saveError);
      if (reportQuotaError(saveError)) return;
      notify('儲存失敗，請確認最新 Firestore Rules 已發布。', 'error');
    }
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
          if (reportQuotaError(err)) return;
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
          <button onClick={() => setActiveTab('drawCards')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'drawCards' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>抽獎卡</button>
          <button onClick={() => setActiveTab('roster')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'roster' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>刪除名單</button>
          <button onClick={() => setActiveTab('security')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'security' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>安全</button>
          {isPrimaryAdmin && <button onClick={() => setActiveTab('teacherRequests')} className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition ${activeTab === 'teacherRequests' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-slate-50' : 'text-slate-500 hover:text-slate-700'}`}>教師審核{teacherRequests.length ? ` (${teacherRequests.length})` : ''}</button>}
        </div>

        <div className="p-6">
          {/* 1. 一般設定 */}
          {activeTab === 'general' && (
            <form onSubmit={handleUpdateGeneral} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">教師信箱 (用於接收日報表)</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="example@gmail.com" />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">榮譽榜字體大小</label>
                <p className="text-xs text-slate-500 mb-3">等比例調整名次、學生姓名與分數；此顯示設定只保存在目前瀏覽器。</p>
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => onHonorFontScaleChange?.(-0.1)} disabled={honorFontScale <= 0.8} className="w-10 h-10 rounded-lg border border-slate-300 text-xl font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40" aria-label="縮小榮譽榜字體">−</button>
                  <div className="flex-1 text-center"><span className="font-bold text-indigo-700 text-lg">{Math.round(honorFontScale * 100)}%</span><p className="text-xs text-slate-400">可調整 80%–160%</p></div>
                  <button type="button" onClick={() => onHonorFontScaleChange?.(0.1)} disabled={honorFontScale >= 1.6} className="w-10 h-10 rounded-lg border border-slate-300 text-xl font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40" aria-label="放大榮譽榜字體">+</button>
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

          {/* 4. 抽獎卡：每個班級獨立設定，學生說明頁以相同資料顯示。 */}
          {activeTab === 'drawCards' && (
            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-bold">設定抽獎卡與出現機率</p>
                <p className="mt-1 leading-relaxed">正在設定：{selectedClassName || '未選擇班級'}。權重越大，抽中的機率越高；設為 0 或取消啟用即不會出現。學生獎勵卡說明頁會讀取同一份設定。</p>
              </div>
              {drawCardsLoading && <p className="text-center text-xs text-slate-400 py-3">讀取獎卡設定中…</p>}
              <p className="text-xs text-slate-500">目前啟用的總權重：<span className="font-bold text-indigo-700">{drawCards.filter(card => card.enabled !== false).reduce((sum, card) => sum + (Number(card.weight) || 0), 0)}</span></p>
              {drawCards.map((card, index) => (
                <div key={card.id} className={`rounded-lg border p-3 space-y-2 ${card.enabled === false ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-indigo-100 bg-indigo-50/30'}`}>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer"><input type="checkbox" checked={card.enabled !== false} onChange={(event) => updateDrawCard(card.id, 'enabled', event.target.checked)} className="accent-indigo-600" /> 啟用</label>
                    <span className="ml-auto text-xs text-slate-400">第 {index + 1} 張</span>
                    <button type="button" onClick={() => removeDrawCard(card.id)} disabled={drawCards.length <= 1} className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30" title="移除這張獎卡" aria-label={`移除${card.name || '獎卡'}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-[1fr_82px] gap-2">
                    <input value={card.name || ''} onChange={(event) => updateDrawCard(card.id, 'name', event.target.value)} className="min-w-0 px-2 py-1.5 text-sm font-bold border rounded bg-white" placeholder="獎卡名稱" aria-label="獎卡名稱" />
                    <label className="text-xs text-slate-500">權重<input type="number" min="0" step="1" value={card.weight ?? 0} onChange={(event) => updateDrawCard(card.id, 'weight', event.target.value)} className="mt-1 w-full px-2 py-1.5 text-sm border rounded bg-white" aria-label="出現權重" /></label>
                  </div>
                  <textarea value={card.desc || ''} onChange={(event) => updateDrawCard(card.id, 'desc', event.target.value)} className="w-full h-16 px-2 py-1.5 text-xs border rounded bg-white resize-none" placeholder="獎勵內容／說明" aria-label="獎勵內容" />
                  <label className="block text-xs text-slate-500">正式卡圖<select value={card.imageKey || card.id || 'class_applause'} onChange={(event) => updateDrawCard(card.id, 'imageKey', event.target.value)} className="mt-1 w-full px-2 py-1.5 text-sm border rounded bg-white"><option value="">使用預設圖案</option>{CARD_IMAGE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
                  <img src={cardImageUrl(card.imageKey || card.id)} alt={`${card.name || '獎卡'} 預覽`} className="h-24 w-full rounded border border-slate-200 object-cover bg-white" loading="lazy" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onClick={addDrawCard} className="border border-indigo-300 text-indigo-700 bg-white font-bold py-2 rounded-lg text-sm hover:bg-indigo-50">＋ 新增獎卡</button>
                <button type="button" onClick={() => setDrawCards(withCardImages(DRAW_CARD_DEFAULTS))} className="border border-slate-300 text-slate-600 bg-white font-bold py-2 rounded-lg text-sm hover:bg-slate-50">還原預設</button>
              </div>
              <button type="button" onClick={saveDrawCards} className="w-full bg-amber-500 text-amber-950 font-bold py-2.5 rounded-lg hover:bg-amber-400 transition shadow-sm text-sm">儲存抽獎卡設定</button>
            </div>
          )}

          {/* 5. 刪除名單：目前選取班級的學生可改姓名、改座號或刪除。 */}
          {activeTab === 'roster' && (
            <div className="space-y-3 max-h-[360px] overflow-y-auto">
              <p className="text-xs text-slate-500">目前班級：<span className="font-bold text-slate-700">{selectedClassName || '未選擇'}</span>。可在此修改姓名、座號，或刪除學生資料。</p>
              {students.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">目前班級尚無學生名單</p> : students.map(student => (
                <div key={student.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {editingStudentId === student.id ? <div className="space-y-2"><label className="text-xs text-slate-500">座號</label><input value={editingStudentNumber} onChange={event => setEditingStudentNumber(event.target.value)} className="w-full px-2 py-1.5 border rounded bg-white" placeholder="座號" /><label className="text-xs text-slate-500">姓名</label><input value={editingStudentName} onChange={event => setEditingStudentName(event.target.value)} className="w-full px-2 py-1.5 border rounded bg-white" placeholder="姓名" /><div className="flex justify-end gap-2 pt-1"><button onClick={() => setEditingStudentId(null)} className="px-3 py-1.5 text-xs text-slate-600">取消</button><button disabled={savingStudent} onClick={() => saveStudent(student)} className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded disabled:opacity-50">{savingStudent ? '儲存中…' : '儲存'}</button></div></div> : <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="font-bold text-slate-800 truncate">{student.studentNumber || '未編號'}　{student.name}</p><p className="text-xs text-slate-500 mt-1">目前總分：{formatPoints(student.totalPoints ?? student.points)}</p></div><button onClick={() => beginStudentEdit(student)} className="p-2 rounded text-slate-500 hover:text-indigo-700 hover:bg-indigo-50" title="修改姓名或座號"><Pencil className="w-4 h-4" /></button><button onClick={() => onDeleteStudent?.(student.id, student.name)} className="p-2 rounded text-slate-500 hover:text-red-600 hover:bg-red-50" title="刪除學生資料"><Trash2 className="w-4 h-4" /></button></div>}
                </div>
              ))}
            </div>
          )}

          {/* 6. 帳號安全 (修改密碼) */}
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

// --- 共用加扣分面板與精簡學生卡 ---
function SharedScorePanel({ student, presets, onUpdatePoints, onClear }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customPoints, setCustomPoints] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [updating, setUpdating] = useState(false);

  const applyScore = async (points, reason) => {
    if (!student || updating) return;
    setUpdating(true);
    try {
      const success = await onUpdatePoints(student, points, reason);
      if (success) setCustomOpen(false);
    } finally { setUpdating(false); }
  };

  const submitCustom = async (event) => {
    event.preventDefault();
    const points = Number(customPoints);
    if (!Number.isFinite(points) || points === 0) return;
    await applyScore(points, customReason.trim() || '手動調整');
    setCustomPoints('');
    setCustomReason('');
  };

  return (
    <section className="mb-5" aria-label="共用加扣分面板">
      <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5">
        <div className="h-20 rounded-lg border border-indigo-200 bg-indigo-50 p-1.5 text-center flex flex-col items-center justify-center">
          <p className="text-[11px] text-indigo-500">共同加扣分</p>
          <p className="font-bold text-indigo-800 text-sm truncate w-full">{student ? `${student.studentNumber || '未編號'} ${student.name}` : '請先點選學生'}</p>
          {student && <button onClick={onClear} className="mt-1 text-[11px] text-indigo-600 hover:text-indigo-900 hover:underline">取消選取</button>}
        </div>
        {presets.map(preset => (
          <button key={preset.id} disabled={!student || updating} onClick={() => applyScore(preset.value, preset.isRedemption ? `兌獎：${preset.label}` : preset.label)} className={`h-20 rounded-lg border px-1 text-center text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${preset.isRedemption ? 'border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100' : preset.value > 0 ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100' : 'border-pink-200 text-pink-700 bg-pink-50 hover:bg-pink-100'}`}>
            <span className="block text-base leading-none">{preset.isRedemption ? `兌 −${Math.abs(preset.value)}` : preset.value > 0 ? `+${preset.value}` : preset.value}</span><span className="block mt-1 truncate">{preset.label}</span>
          </button>
        ))}
        <button disabled={!student || updating} onClick={() => setCustomOpen(true)} className="h-20 rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><Edit3 className="w-4 h-4 inline mr-1" />自訂</button>
      </div>
      {customOpen && student && <form onSubmit={submitCustom} className="mt-3 flex flex-col sm:flex-row gap-2 border-t pt-3"><input autoFocus required type="number" value={customPoints} onChange={event => setCustomPoints(event.target.value)} placeholder="分數，例如 5 或 -3" className="px-3 py-2 border rounded-lg sm:w-44" /><input value={customReason} onChange={event => setCustomReason(event.target.value)} placeholder="原因（選填）" className="px-3 py-2 border rounded-lg flex-1" /><button className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg">確認</button><button type="button" onClick={() => setCustomOpen(false)} className="px-3 py-2 text-slate-600">取消</button></form>}
    </section>
  );
}

type CompactStudentCardProps = {
  student: any;
  selected: boolean;
  onSelect: (student: any) => void;
  onShowHistory: (student: any) => void;
};

const CompactStudentCard = React.memo(function CompactStudentCard({ student, selected, onSelect, onShowHistory }: CompactStudentCardProps) {
  const score = student.totalPoints ?? student.points;
  const activate = () => onSelect(student);
  return <div role="button" tabIndex={0} onClick={activate} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }} className={`min-h-24 rounded-xl border p-2 flex flex-col justify-between cursor-pointer transition shadow-sm ${selected ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md'}`} title="點選後使用上方共同加扣分面板">
    <div className="flex items-center justify-center gap-1 text-indigo-700 font-extrabold text-center"><span className="text-base shrink-0">{student.studentNumber || '#'}</span><button type="button" onClick={event => { event.stopPropagation(); onShowHistory(student); }} className="max-w-[72%] truncate text-center text-base hover:underline focus:outline-none" title="查看加扣分紀錄">{student.name}</button></div>
    <div className={`text-center text-2xl sm:text-3xl font-black leading-none ${score >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatPoints(score)}</div>
  </div>;
});

// --- 舊版學生個人點數操作卡片（保留元件供相容，不再於主列表呈現） ---
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
