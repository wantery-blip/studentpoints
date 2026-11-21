# 合作型積分平台：安全登入與資料庫權限版（React + Firebase）

這版由原版 TSX 直接修改，保留學生名單、加扣分、小組模式、班級管理、CSV 匯出及 GAS 備份。**教師密碼改交由 Firebase Authentication 管理，程式不再讀寫 `teacher_auth.password`**。

> 尚未登入你的 Firebase 專案、尚未部署，也尚未完成 Firebase Emulator 的真實規則測試。正式使用真實學生資料前，請先依本文完成遷移、權限部署、測試。

## 目前完成項目（2026-11）

- 教師首頁已採「森林成長風」：奶油紙紋、頂端森林底圖、精緻木牌榮譽榜、半透明學生／小組卡與低對比綠色介面。
- 學生卡依班級設定的分數區間顯示五段成長圖：土壤萌芽、兩葉芽、四葉幼苗、小樹苗、完整樹冠；右上、左下、右下保留植物插圖，三字姓名會自動加大字距。
- 榮譽榜採獨立金／銀／銅獎牌素材，前 9 名顯示於木牌下方，標題固定在木牌中央。
- 小組分數獨立保存；「系統設定 → 班級管理」可設定每班 N、分組數量，以及是否將「小組分數 ÷ N」併入個人總積分。此選項同步影響學生卡、榮譽榜、學生查詢、備份與日報表。
- 「系統設定 → 獎勵設定」可調整學生卡成長的四個切換門檻；預設為 10、30、60、100 分。
- 多人加分、統計、新增學生、系統設定均採浮動視窗；抽獎卡維持獨立頁面。獎卡圖片使用 GitHub 專案內建檔案，由主要管理者登錄檔名，不開放教師在網站上傳。

學生個人帳號、個人查分／排名、大樹裝飾與積分飾品商城尚未實作；完整的決策與後續階段請見 [ROADMAP.md](ROADMAP.md)。

## 一、修正內容

- 教師：Firebase 電子郵件 + 密碼登入、`browserLocalPersistence` 本機持久登入、確實 `signOut()` 登出，忘記密碼可寄重設信。
- 教師申請：除 `wantery@gmail.com` 外，新帳號只能送出姓名、學校／單位與信箱供審核；未核准前不會建立 `teachers/{UID}`，因此不能建立班級或加扣分。
- 主要管理者：`wantery@gmail.com` 可在「系統設定 → 教師審核」核對資料後核准或駁回申請；核准才建立教師權限。
- 舊教師：使用遷移工具把舊 `teacherId` 綁定到新的 Firebase Authentication UID；原本 `classes.teacherId`、`reward_presets.classId` **不需重寫**。
- 學生：仍為匿名登入；輸入班級代碼後，只能 `get` 對應的 `class_codes/{CODE}`，安全規則核對代碼後才建立 `class_access/{uid}_{classId}` 唯讀授權。
- Firestore Rules：教師只能讀寫自己班級及預設獎勵；學生僅能讀取其有代碼授權的班級及學生積分；`teacher_auth` 前端全面禁止讀寫；其他路徑預設拒絕。
- 新增／變更班級代碼採交易，同步維護唯一代碼索引。預設班級代碼由加密安全亂數產生。

## 二、啟用 Firebase Authentication（必做）

1. 在 https://console.firebase.google.com/ 選取 **原本儲存積分的 Firebase 專案**。
2. Authentication → Sign-in method → 開啟 **Email/Password** 與 **Anonymous**。
3. Authentication → Settings → **Authorized domains**：首次 Pages 部署後加入 `<你的 GitHub 使用者名稱>.github.io`；若使用自訂網域，也加入該網域。否則正式網域的登入可能被 Firebase 拒絕。
4. 專案設定 → 你的應用程式 → Web App SDK 設定，填入 `.env`。
5. 將 `.env.example` 複製為 `.env`。`VITE_DATA_NAMESPACE` **一定要等於原程式的 `__app_id`**。若不是 `default-app-id`，必須改成原值，否則找不到舊資料。
6. 建議先在**測試 Firebase 專案**驗證，再更動正式資料。

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

瀏覽器開啟終端機提示的網址。新教師可用 email 註冊並送出申請；只有 `wantery@gmail.com` 可免審核建立主要管理者設定。**舊帳號不能直接輸入原來的教師 ID/舊密碼**，必須完成下一節轉移。

### 教師申請與審核流程

1. 申請者在登入頁按「申請教師帳號」，填寫電子郵件、密碼、真實姓名與學校／單位。
2. 帳號只會在 Firebase Authentication 建立；網站將資料放入 `teacher_requests/{UID}`，其狀態為 `pending`，尚無教師權限。
3. 以 `wantery@gmail.com` 登入後，開啟「系統設定 → 教師審核」，核對資料後按「核准」或「駁回」。
4. 核准會建立 `teachers/{UID}`，申請者重新整理後才可建立自己的班級及管理積分。駁回帳號則維持無權限狀態。

> 主要管理者信箱寫在 `src/App.tsx` 的 `PRIMARY_ADMIN_EMAIL` 與 `firestore.rules`，兩處必須保持相同；若日後要更換主要管理者，需一起修改、測試並重新發布規則。

## 三、舊教師帳號及原始資料遷移（不改學生分數）

### A. 建立新的教師登入帳號

在 Firebase Console → Authentication → Users → Add user，輸入**新的電子郵件與全新、強度足夠的密碼**。不要繼續使用原先保存在 Firestore 的明文密碼。密碼不要傳給 ChatGPT。

### 少量班級更簡單：直接用 Firebase Console 手動遷移（不需管理金鑰）

如果只有一位老師、少數幾個班級，建議採用此法，**完全不需要下載 Service Account 金鑰**：

1. 在 Firebase Authentication 建立新的「電子郵件／密碼」帳號，複製該帳號的 **UID**。
2. 在 Firestore 找到舊 `artifacts/<命名空間>/public/data/teacher_auth/<舊教師ID>`，記下**舊教師 ID**、報表信箱與備份 URL。請勿複製或公開舊密碼。
3. 在同一個 `artifacts/<命名空間>/public/data` 底下新增 `teachers` 集合，文件 ID 使用 Firebase Authentication 的 **UID**。建立字串欄位：`teacherId`＝舊教師 ID、`email`＝新登入信箱、`backupUrl`＝原備份網址（沒有就填空字串）。
4. 每個原本的 `classes/<班級文件ID>`，查看 `classCode` 欄位。建立 `class_codes/<班級代碼>` 文件，加入字串欄位 `classId`＝原班級文件 ID、`teacherId`＝舊教師 ID。班級代碼建議 10–12 位隨機英數字，僅可包含大寫 A–Z、數字、`_` 或 `-`；若修改原本代碼，必須同步修改 `classes/<班級文件ID>.classCode`。
5. 完成所有原班級的對應後，依 D 節部署 Firestore Rules 及新版網站，測試登入與積分是否正常。
6. 測試確定無誤後，在 Firebase Console 刪除舊 `teacher_auth/<舊教師ID>` 文件（含明文密碼）。若舊密碼曾在其他網站使用，務必一併更換。

以下的 B、C 是**大量班級或多位教師**的選用自動遷移方式，只有需要時才用。

### B. 準備本機管理憑證

從 Firebase 專案設定 → 服務帳戶 → 產生一組**本機私用**的 Service Account JSON；只放在自己的電腦，不可放進 GitHub／ZIP／訊息／網頁。妥善保管，不使用時可撤銷金鑰。本工具目前使用本機 Service Account JSON 以核對專案 ID；不支援只使用 gcloud ADC 而不提供 JSON 檔。

PowerShell 範例：

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\private\firebase-admin.json"
```

### C. 先預演，再正式遷移

`--teacher-id` 使用舊程式的教師 ID；`--email` 使用 A 步驟新增的 Firebase 帳號信箱；`--namespace` 使用 `.env` 中 `VITE_DATA_NAMESPACE`，`--project-id` 使用 `.env` 中 `VITE_FIREBASE_PROJECT_ID`。程式會核對管理憑證所屬專案，防止誤改資料。

```powershell
node scripts/migrate-legacy.mjs --teacher-id TeacherWang --email teacher@example.com --namespace default-app-id --project-id your-firebase-project --dry-run
node scripts/migrate-legacy.mjs --teacher-id TeacherWang --email teacher@example.com --namespace default-app-id --project-id your-firebase-project
```

此工具會：
- 使用 Firebase Admin SDK 確認新 Email/Password 帳號存在。
- 建立 `teachers/{Firebase UID}`，其 `teacherId` 對應原舊 ID。
- 替原有 `classes` 建立 `class_codes` 索引，保留原學生文件和原積分。
- 保留舊的報表信箱與 GAS 備份網址，但**不遷移密碼**。
- 如班級代碼格式不合法，生成新的安全代碼，並印出變更（需重新提供給學生）。
- 若班級代碼衝突則停止，**不覆寫別人的班級**。

如果有多個舊教師，要**對每位教師重複**。遷移命令可再次執行（具冪等性）。

### D. 規則發布前的必要確認（不由 GitHub Pages 自動執行）

> **重要**：若 Firestore 同一專案還有其他程式，請先**合併其既有 rules**；此檔以「其他路徑全部拒絕」為預設，直接覆寫會阻斷那些程式。

請先依「八、Firestore Rules 與 Emulator」的測試流程，在測試專案確認規則。若正式 Firebase 專案有其他應用，必須將本專案的 `artifacts/{namespace}/public/data` 規則**合併**到既有規則，再由具備該專案權限的人手動發布。

GitHub Pages 的工作流程只會建置與部署 `dist/` 靜態網站；它**不會**部署 Firebase Hosting、Firestore Rules、資料遷移或任何正式資料寫入。

### E. 驗證成功後移除明文密碼

確認新教師已能登入、看到舊班級、加扣分正常，再加上 `--purge-plaintext` 執行：

```powershell
node scripts/migrate-legacy.mjs --teacher-id TeacherWang --email teacher@example.com --namespace default-app-id --project-id your-firebase-project --purge-plaintext
```

這會刪除該教師舊 `teacher_auth/{TeacherWang}` 文件。新安全規則已經禁止任何網頁讀取這個集合，即使你未立即刪除也不能從網頁取得密碼；但**仍建議盡快刪除，並停用曾重複使用的舊密碼**。

> 若原本 Firebase Security Rules 開放所有人存取，請認定舊密碼可能已洩漏，務必更換其他服務上重複使用的密碼。

## 四、資料結構與讀寫權限

| 路徑 | 教師 | 學生匿名使用者 |
|---|---|---|
| `teachers/{UID}` | 只能讀寫自己的個人設定，不可改 `teacherId` | 不可讀寫 |
| `teacher_requests/{UID}` | 申請者只能讀自己的申請；主要管理者可列出及審核 | 不可讀寫 |
| `teacher_auth/{oldId}` | 不可讀寫 | 不可讀寫 |
| `classes/{classId}` | 自己的班級可讀寫允許欄位 | 有授權才能讀單筆 |
| `class_codes/{CODE}` | 自己的班級可建立／換碼 | 只能用正確代碼讀單筆，不可列舉 |
| `class_access/{uid}_{classId}` | 非授權教師無須使用 | 只能為自己的 UID 和正確代碼建立 |
| `student_points/{id}` | 只有班級所屬教師可讀／新增／改分／刪除 | 正確班級授權後只能讀 |
| `reward_presets/{id}` | 只能管理自己的項目 | 不可讀寫 |

班級代碼是**共享存取碼**，不是學生個人的秘密；知道代碼的人就可能讀取該班榜單。請勿公開代碼，並在介面中只展示允許公開的資訊。原學生文件內可能包含 `lastReason` 行為紀錄，建議避免寫入敏感資訊（如健康、家庭、特殊教育細節）。如需嚴格的學生個別保密，應另建每人帳號與個人可見的資料模型。

## 五、驗收測試（務必以測試班完成）

1. 一般新教師註冊：只建立 `teacher_requests/{UID}`，登入只顯示待審核頁面，不能建立班級或加扣分。
2. 以 `wantery@gmail.com` 核准後，才建立 `teachers/{UID}`；申請者重新整理後可以登入教師系統。
2. 教師建立班級與學生、快速 +1/-1、全班加分、小組加分均可使用。
3. 關閉／縮小／切換分頁／重新整理：教師仍為 Firebase 登入狀態（非無痕模式）。
4. 明確按「登出」：重新進入教師頁需要重新輸入密碼。
5. 學生不用教師密碼，只輸入班級代碼即可讀到榜單；不可按教師加扣分。
6. 錯誤班級代碼：不能進入；舊網址 `?mode=student&class_id=...` 若沒有授權也不能直接看到資料。
7. 用 Firebase Rules Playground／Emulator 驗證：匿名者 `update(student_points)` **拒絕**；教師修改他人班級 **拒絕**；匿名者 `list(class_codes)` **拒絕**；前端 `get(teacher_auth)` **拒絕**。
8. 舊班級遷移：原學生數量和總分與遷移前一致。
9. 班級更換代碼後，原學生授權應失效，必須重新輸入新代碼。
10. CSV 匯出／GAS 備份可正常使用。注意原本 `fetch(..., mode:'no-cors')` 只能確認發出請求，不能證明 Google 試算表已真的寫入。

## 六、重要界線

- 只有前端程式與規則檔，**不會自動修改遠端 Firebase 規則或資料**，請按上面步驟部署。
- Firebase Web App 設定可放進前端，**不是管理員密鑰**；Firebase Admin Service Account JSON 絕對不能進前端或 GitHub。
- GitHub Pages 已設定自動判斷 Vite `base` 和 Actions。Firestore 安全規則不會隨 Pages 自動部署；必須獨立、審核後發布。
- Firebase 規則基於這份專案現有欄位建立。如果你在資料庫另有自訂欄位，請先調整允許欄位名單再發布。

## 七、GitHub Pages 部署（首次設定）

本專案的 `.github/workflows/deploy.yml` 在 `main` 分支更新時執行 `npm ci`、TypeScript／安全檢查、`npm run build`，再以官方 GitHub Pages Actions 部署 `dist/`。它不需要預先知道 GitHub 帳號或 Repository 名稱：

- `owner.github.io` 倉庫會使用根目錄 `/`。
- 其他倉庫會自動使用 `/<repository>/`，例如 `https://owner.github.io/class-points-secure/`。
- 學生查分使用 query string（例如 `?mode=student&class_id=...`），不依賴 GitHub Pages 不支援的伺服器端重寫。

### 1. 建立倉庫與首次推送

在 GitHub 建立一個**空白**倉庫；不要選擇自動建立 README、`.gitignore` 或授權檔，以免第一次推送產生不必要合併。以下命令中的 URL 請換成 GitHub 顯示的實際 SSH 或 HTTPS URL：

```powershell
git init
git add .
git commit -m "Deploy class points platform to GitHub Pages"
git branch -M main
git remote add origin <你的 GitHub 倉庫 URL>
git push -u origin main
```

若此資料夾日後已有遠端，先用 `git remote -v` 核對 URL，再推送；不要以 `--force` 覆蓋其他專案。

### 2. 啟用 GitHub Pages

GitHub Repository → **Settings** → **Pages** → **Build and deployment**：選擇 **GitHub Actions**。接著到 **Actions** 查看「Deploy GitHub Pages」工作流程；成功後，環境名稱 `github-pages` 會顯示實際網址。

### 3. 設定 Repository Variables

Repository → **Settings** → **Secrets and variables** → **Actions** → **Variables**，新增下列變數。它們是 Firebase 網頁設定和資料命名空間，並非 Firebase Admin 私鑰；但仍建議只讓受信任協作者有倉庫寫入權。

| Variable | 值來源／用途 |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Console Web App `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Web App `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | 原本 Firestore 所在專案 ID |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Web App `messagingSenderId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Web App `storageBucket` |
| `VITE_DATA_NAMESPACE` | **舊系統 `__app_id` 的原值**；不得自行改為 Web App ID |

工作流程已將這些 Variables 注入 build 環境；未填主要 Firebase Variables 時，建置雖可產生檔案，但網站載入會顯示設定錯誤，因此請在第一次推送前完整填妥。

> 不要把教師密碼、Firebase Admin Service Account JSON、舊 `teacher_auth` 明文密碼、學生資料或 `.env` 加入 Git。`.gitignore` 已排除 `.env` 和常見 Admin 憑證檔名。

## 八、Firestore Rules 與 Emulator

`tests/firestore.rules.test.mjs` 會在**本機 Firestore Emulator** 建立獨立的 `class-points-rules-test` 測試資料，覆蓋下列正反向案例：教師 `increment()` 加分、其他教師跨班讀寫、匿名學生唯讀、`teacher_auth` 拒絕讀取、班級代碼不得 list、錯誤代碼不得建立授權。它不會連線或修改正式 Firebase 專案。

```powershell
npm ci
npm run test:rules
```

Firestore Emulator 需要本機已安裝並可從 `PATH` 呼叫的 Java（通常為 Java 11 以上）；Java 只供本機測試，不會用於 GitHub Pages。若無法啟動，請記錄為「待測」而非發布規則。

測試通過後，仍須由管理者檢視 `firestore.rules` 是否可與正式專案其他應用的 Rules 合併。未確認前，禁止執行 `firebase deploy --only firestore:rules`。

規則設計允許已登入的匿名學生以**完整代碼**讀取單一 `class_codes/{CODE}` 文件，否則無法由純前端驗證代碼；但規則禁止 list／collection query。請使用至少 8 位、不可預測的班級代碼，且不要在公開網頁張貼。

## 九、日後維護標準流程

1. 從 GitHub 拉取目前 `main`，以 `.env` 在本機開發；不可提交 `.env`。
2. 變更後依序執行：`npm ci`、`npm run check`、`npm run build`、`npm run check:pages`，涉及 Rules 時另執行 `npm run test:rules`。
3. 審查 `git status`，確認沒有 `.env`、Service Account JSON、學生 CSV 或匯出資料。
4. `git add`、`git commit`、`git push origin main`。GitHub Actions 會自動更新 Pages。
5. 到 Actions 確認成功，再用正式網址測試教師登入、重新整理保持登入、學生查分和各種加扣分。任何 Firebase Rules 或資料遷移都要另行核准並手動執行。

### 自訂獎卡圖片（GitHub 內建圖片）

獎卡圖片隨網站一起保存在 GitHub 專案的 `public/reward-cards/`，不使用 Firebase Storage，教師也不能從網站直接上傳。只有有 GitHub repo 寫入權限的主要管理者，才可在 GitHub 網頁新增／替換圖片；每次提交都會留下 Git 歷程，GitHub Actions 完成後 Pages 才會更新。

新增圖片後，主要管理者以 `wantery@gmail.com` 登入平台，開啟「系統設定 → 抽獎卡」，在「GitHub 自訂獎卡圖片清單」輸入完整檔名（例如 `reading_reward.jpg`）及選單名稱並儲存。所有教師的「正式卡圖」選單會同步出現該圖片。圖片檔名僅允許英文、數字、`.`、`_`、`-`，副檔名限 JPG、PNG、WebP；建議單張壓縮在 2 MB 內，以維持 Pages 載入速度。

此清單寫入 Firestore，需要手動發布本專案最新的 `firestore.rules` 後，主要管理者才可儲存；GitHub Pages 不會自動發布 Firebase Rules。

## 十、Google 試算表加扣分紀錄（每班一個分頁）

網站已支援把「學生加扣分」和「小組加扣分」寫入指定的 Google 試算表；每筆學生變動各寫一列。新建班級時，Apps Script 會在試算表建立該班專用分頁。每個班級分頁左側保存班級資料和最新學生名單（座號、姓名、目前積分、小組、最後加扣分原因／時間），右側保存逐筆加扣分紀錄。

目前指定試算表為 `學生獎勵點數`。本專案的 [Apps Script 程式](/apps-script/Code.gs) 已固定使用該試算表 ID，且不會覆寫既有的「工作表1」。

首次設定必須由試算表擁有者在 Google 帳號中手動完成：

1. 開啟目標試算表，選「擴充功能 → Apps Script」。
2. 將 `apps-script/Code.gs` 的內容完整貼到 `Code.gs`，儲存後按「部署 → 新增部署作業 → 網頁應用程式」。
3. 設定「執行身分」為自己；存取權設定為可讓此網站呼叫的範圍（通常是「所有人」）。Google 會要求你授權該 Script 編輯這份試算表。
4. 部署後複製結尾為 `/exec` 的網址。在平台登入後，開啟「設定 → 備份」，貼入該網址並儲存。
5. 建立一個測試班級，確認試算表新增該班分頁；再在平台按「備份上傳」，確認左側學生名單出現資料；對一位學生加 1 分，確認右側新增一列紀錄。

平台頂端的「備份上傳」會立即備份目前選取班級，不必登出。它會更新該班分頁的班級資料和學生快照；個人／小組加扣分則會逐筆寫到同一分頁右側的紀錄表。更新 `Code.gs` 後，請在 Apps Script 的「部署 → 管理部署作業」建立新版本並重新部署，原本的 `/exec` 網址可繼續使用。

前端以 `no-cors` POST 傳送記錄，因此只能確認瀏覽器已送出請求；最終是否成功寫入，以試算表是否出現資料為準。不要將 Firebase Admin 私鑰、教師密碼或舊明文密碼放進 Apps Script 或備份網址。

## 十一、批次新增與批次分組

- 「新增學生 → 批次貼上」接受每行 `座號 姓名`、`座號,姓名`、`座號. 姓名` 或僅姓名；大型名單會自動每 450 位分批寫入，避免 Firestore 的單批 500 筆上限。
- 「小組」頁面的座號輸入欄接受逗號、全形逗號、頓號或空白分隔。例如輸入 `1,2,3`，會將 1、2、3 號學生一起加入目前小組；`01` 與 `1` 視為相同座號。找不到的座號會在提示中列出，不會影響其他可找到的學生。

## 十二、學生個人加扣分紀錄

教師可點選學生卡片上的姓名，查看該學生的時間、加／扣分與原因。每次個人、小組或全班加扣分，都會在 Firestore 的 `point_history` 建立不可由前端修改或刪除的歷程；只有該班教師可讀取，學生查分帳號不可讀取。此功能需要手動發布本次更新的 `firestore.rules`，並只會記錄規則發布後的新加扣分事件；既有資料僅保留原本的最後一次加扣分原因與時間。

## 十三、小組換算、兌獎與刪除班級

- 小組加扣分會累積在各小組的獨立分數。教師可在「系統設定 → 班級管理」為每個班級設定不同的 N（預設為 1），並勾選是否將「小組分數 ÷ N」併入個人總積分。舊班級為維持既有結果，預設視為已勾選。
- 「系統設定 → 獎勵設定」可設定學生卡五段成長圖的四個切換門檻；預設為 10、30、60、100 分，分別對應兩葉芽、四葉幼苗、小樹苗、完整樹冠的起始分數。
- 「獎勵項目設定」新增「學生兌獎項目」。兌獎一律扣除點數，但會以「兌獎」而非「扣分」顯示，且只適用於個人學生卡，不會出現在全班或小組加扣分。
- 「系統設定 → 班級管理」可刪除班級。確認後會刪除 Firebase 內的班級、班級代碼、學生、小組分數與點數歷程；**不會呼叫 Google Apps Script，也不會刪除 Google 試算表中的既有分頁或紀錄**。刪除功能需要先手動發布本專案更新後的 `firestore.rules`。
