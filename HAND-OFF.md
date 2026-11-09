# HAND-OFF — topbar_deepseek

> เอกสารส่งมอบงาน (hand-off) สำหรับผู้ที่จะมาทำต่อ
> อัปเดตล่าสุด: 2026-11-09 ~23:35 (Asia/Bangkok)
> สถานะ: ใช้งานได้ในโหมด dev (repo นี้เตรียมไว้สำหรับ public)

---

## 0. เริ่มตรงนี้ (Quick start)

```powershell
cd <path\to\topbar_deepseek>

# 1) ใน environment ของ agent นี้มี ELECTRON_RUN_AS_NODE=1 ต้องลบก่อน ไม่งั้น Electron จะรันเป็น Node
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 2) ตรวจ .env (ต้องมีก่อนรัน — ดูหัวข้อ 5)
Get-Content .env

# 3) รันแอป
pnpm dev
```

ถ้าต้องการตรวจว่า HOSxP อ่านได้ไหมโดยไม่เปิดแอป:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File resources\hosxp-hn.ps1 -Once
# ตัวอย่าง: {"running":true,"hn":"000000000","form":"TPatientVisitEntryForm"}
```

---

## 1. โปรเจกต์นี้คืออะไร

แถบ **Top Sticky Bar** สูง **30 DIP** ติดขอบบนของจอ Windows:

- จองพื้นที่เดสก์ท็อปด้วย Win32 **AppBar** (`SHAppBarMessage`) ผ่าน FFI (koffi)
  ทำให้หน้าต่างแอปอื่น (รวม maximize) ถูกดันลงมา
- แสดง **HN ของผู้ป่วยที่เปิดอยู่ใน HOSxP** (อ่านจาก UI ผ่าน MSAA)
- ดึง **ชื่อ–เพศ–อายุ** ของ HN นั้นจากฐานข้อมูล HOSxP (MariaDB) มาแสดงต่อท้าย
- ย่อได้: หดหน้าต่างเหลือเส้นบาง ๆ กลางจอ และคืนพื้นที่ให้เดสก์ท็อป

Stack: Electron 45.2.3 · React 19.3.1 · TypeScript 5.9.3 · Vite 8.3.7 · electron-vite 6.0.0 ·
koffi 3.3.7 · mysql2 3.x · dotenv 18.x · lucide-react

---

## 2. สถานะ ณ วันที่ส่งมอบ

| รายการ | สถานะ |
| --- | --- |
| แอป dev | กำลังรันอยู่ (`pnpm dev -- --remote-debugging-port=9343`) เป็น background job ของ session |
| HOSxP client | ทดสอบกับ `HOSxPXE_PCU.exe` v4.64.11.3 (ดู PID: `Get-Process HOSxPXE_PCU`) |
| ตัวอ่าน HN | PowerShell helper ถูก spawn โดยแอป (ดู: `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'"`) |
| ฐานข้อมูล | MySQL/MariaDB ที่เก็บฐาน HOSxP (ทดสอบกับ MariaDB 10.6) — ตั้งค่าใน `.env` |
| Build artifacts | `out/` (ใช้ได้), `dist/win-unpacked/` (ของเก่า ลบได้) |
| Git | **ยังไม่มี** — ควร `git init` ก่อนทำงานต่อ |
| เอกสาร/ภาพ | `README.md`, `docs/bar.png`, `docs/collapsed.png`, `docs/pushed-down.png` |

> หมายเหตุ: ถ้าปิด Electron ตัว dev job จะจบตาม (electron-vite ออก) — ต้องเริ่ม `pnpm dev` ใหม่

---

## 3. สถาปัตยกรรมและเส้นทางข้อมูล

```
HOSxP (Delphi/DevExpress)
   │  UI: caption "TPatientOPDCardForm:000000000" หรือ label "HN" + edit
   ▼
resources/hosxp-hn.ps1  (PowerShell + C# interop, วนทุก 700 ms)
   │  Win32: EnumWindows/EnumChildWindows, GetWindowText, GetWindowRect
   │  MSAA : oleacc!AccessibleObjectFromWindow → IAccessible.get_accValue()
   │  stdout: {"running":true,"hn":"000000000","form":"caption"}
   ▼
Electron main (src/main/hosxp.ts)  อ่าน stdout → เก็บ state → broadcast IPC
   ▼
Renderer (src/renderer/src/App.tsx)  แสดง "HN : 000000000"
   │
   │  window.api.ptInfo(hn)
   ▼
Electron main (src/main/db.ts)  mysql2 → MariaDB <DB_NAME>.patient
   │  { fullname, sex, age: {y,m,d}, ageYmd }
   ▼
แถบแสดง: HN : 000000000  นายทดสอบ ระบบ · ชาย · 43-5-30
```

ลำดับชั้นหน้าต่างแอป (main process):

```
src/main/index.ts        app lifecycle, single instance, display listeners
  ├── bar.ts             สร้าง BrowserWindow, ตำแหน่ง, ย่อ/ขยาย, context menu
  │     └── appbar.ts    SHAppBarMessage ผ่าน koffi, จัดตำแหน่งระดับพิกเซล
  ├── hosxp.ts           spawn/call PowerShell helper, parse JSON
  ├── db.ts              pool + getPtInfo(hn)
  └── ipc.ts             handler + broadcast (bar status, hosxp state, ptInfo)
```

---

## 4. ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `src/main/index.ts` | bootstrap, single-instance lock, display change, will-quit cleanup |
| `src/main/bar.ts` | สร้างแถบ frameless/transparent/always-on-top, จัดตำแหน่ง, collapse, เมนูคลิกขวา |
| `src/main/appbar.ts` | AppBar ผ่าน koffi (`ABM_NEW/QUERYPOS/SETPOS/REMOVE`), `SetWindowPos`, ABN_POSCHANGED |
| `src/main/hosxp.ts` | spawn `resources/hosxp-hn.ps1`, parse JSON lines, broadcast state |
| `src/main/db.ts` | โหลด `.env`, สร้าง pool, `getPtInfo(hn)` |
| `src/main/ipc.ts` | IPC handlers + `broadcastAppBarStatus` / `broadcastHosxpState` |
| `src/preload/index.ts` | `contextBridge` → `window.api` |
| `src/shared/ipc.ts` | channel names + types (`AppBarStatus`, `HosxpState`, `PtInfo`) |
| `src/renderer/src/App.tsx` | UI 30 DIP: icon, HN, PtInfo, ปุ่มย่อ, มุมมองย่อ |
| `src/renderer/src/assets/main.css` | สไตล์แถบ/เส้นย่อ/HN/PtInfo |
| `resources/hosxp-hn.ps1` | ตัวอ่าน HN (bundled ไปกับแอปผ่าน `extraResources`) |
| `electron-builder.yml` | ตั้งชื่อแอป + `extraResources: resources/hosxp-hn.ps1 → hosxp-hn.ps1` |
| `.env` / `.env.example` | ค่าเชื่อมต่อ DB (`.env` อยู่ใน `.gitignore`) |
| `README.md` | เอกสารผู้ใช้/นักพัฒนา |

---

## 5. การตั้งค่า `.env` และฐานข้อมูล

`.env` (มีอยู่แล้วในเครื่องนี้ — **ห้าม commit**):

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=********        # รหัสจริงอยู่ใน .env เท่านั้น
DB_NAME=your_hosxp_db
DB_CONNECTION_LIMIT=4
```

- `.env` ชี้ไปยังฐานข้อมูล HOSxP ที่ใช้งานจริง (ในเครื่องผู้พัฒนาคือ MariaDB 10.6)
  โดยทั่วไปมีหลายฐานต่อเครื่อง เช่น `your_hosxp_db`, `your_hosxp_db_2`, …
- ตารางที่ใช้: `patient` (`hn`, `pname`, `fname`, `lname`, `full_name`, `sex`, `birthday`)
- `sex`: `1 = ชาย`, `2 = หญิง`
- **คำแนะนำ:** สร้าง user สำหรับอ่านอย่างเดียวแทน `root` เช่น
  ```sql
  CREATE USER 'topbar_ro'@'%' IDENTIFIED BY '...';
  GRANT SELECT ON your_hosxp_db.* TO 'topbar_ro'@'%';
  ```
  แล้วแก้ `DB_USER`/`DB_PASSWORD` ใน `.env`

ข้อจำกัด: `.env` **ไม่ถูกบรรจุในตัวติดตั้ง** — ถ้าแพ็กเป็น `.exe` ต้องวาง `.env`
ไว้ในโฟลเดอร์ `resources` ของแอป หรือกำหนดผ่าน environment variable

---

## 6. ส่วนการทำงานหลัก (รายละเอียด)

### 6.1 AppBar 30 DIP (`src/main/appbar.ts`)

1. `SHAppBarMessage(ABM_NEW)` ผูก appbar กับ HWND ของหน้าต่าง ซึ่งเป็น **top edge**
2. `ABM_QUERYPOS` ขอพื้นที่ว่าง (หลบ taskbar/appbar อื่น) → `ABM_SETPOS` จองพื้นที่จริง
   (38 px ที่ 125% = 30 DIP)
3. Windows บังคับความสูงขั้นต่ำของหน้าต่าง (~38 DIP) หน้าต่างจึงถูกสร้างสูงกว่านั้น
   แล้ว **เลื่อนขึ้นเหนือขอบจอ** ให้เหลือมองเห็น 30 DIP (`SetWindowPos` ระดับพิกเซล
   เพื่อไม่ให้มีรอยต่อ 1px)
4. รับ `ABN_POSCHANGED` ผ่าน `win.hookWindowMessage(0x0401)` → จัดตำแหน่ง/จองใหม่
5. ปิดแอป → `ABM_REMOVE` คืนพื้นที่ (ตรวจแล้ว work area กลับเป็น `y = 0`)

### 6.2 ย่อ/ขยาย (`src/main/bar.ts`)

- ย่อ: `ABM_REMOVE` → หน้าต่างเหลือ 132 DIP กลางจอ เลื่อนขึ้นเหนือขอบจอให้เห็นเส้น 6 DIP
- ขยาย: จอง AppBar กลับ + คืนขนาดเต็ม
- หน้าต่างเป็น `transparent: true` เพื่อให้เห็นเฉพาะ "เส้น" ตอนย่อ
- ใช้ `setBounds` ด้วยความสูง nominal (30 DIP) เสมอ เพื่อไม่ให้ความสูงหน้าต่างบวมขึ้นทุกครั้งที่ DPI ปัดเศษ

### 6.3 ตรวจจับ HN (`resources/hosxp-hn.ps1`)

HOSxP เป็น DevExpress ที่วาดข้อความเอง → `GetWindowText`/`WM_GETTEXT` อ่านไม่ได้
ตัวช่วยจึงทำตามลำดับนี้ (ทุก 700 ms):

1. หา process/window ของ HOSxP (`TMainForm` / `THOSxP*` + title มี `HOSxP`)
   เลือกตัว visible + พื้นที่ใหญ่สุด (มี `TMainForm` ปลอมชื่อ "MainForm" อยู่ด้วย)
2. รวบรวม **หน้าต่าง top-level ที่ visible ทั้งหมด** ของ process (รวม dialog เช่น
   `TPatientVisitEntryForm`), ข้าม tool window/popup (`TPUtilWindow`, `Tdx*`, `Tcx*Popup`, IME)
   เรียง: หน้าต่างที่ active ก่อน → ฟอร์มหลัก → หน้าต่างอื่นตามขนาด
3. ตรวจ **caption** ด้วย regex `:(\d{5,9})(?:\D|$)` เช่น `TPatientOPDCardForm:000000000`
4. ถ้า caption ไม่มี: หา `TcxLabel` ที่ข้อความขึ้นต้น `HN` แล้วหา edit ที่อยู่แถวเดียวกัน
   ทางขวา (ระยะใกล้สุด) → อ่านค่าด้วย MSAA:
   `AccessibleObjectFromWindow(hwnd, OBJID_CLIENT, IID_IAccessible)` แล้ว
   `get_accValue(0)` (ถ้าว่างให้ลอง inner edit `TcxCustomInnerTextEdit` และ `get_accName(0)`)
5. ค่าที่ได้ต้องเป็นตัวเลข 5–9 หลัก จึงถือเป็น HN
6. พิมพ์ JSON เฉพาะเมื่อค่าเปลี่ยน: `{"running":true,"hn":"...","form":"..."}`

### 6.4 ข้อมูลผู้ป่วย (`src/main/db.ts`)

```sql
SELECT hn, pname, fname, lname, full_name, sex, birthday
FROM patient WHERE hn = ? LIMIT 1
```

- `fullname` = `full_name` ถ้ามี ไม่งั้นประกอบ `pname + fname + lname`
- `sex` = `1 → ชาย`, `2 → หญิง`
- `ageYmd` คำนวณจาก `birthday` ถึงวันนี้ เป็น `ปี-เดือน-วัน` (เช่น `43-5-30`)
- คืน `null` ถ้าไม่พบ HN, DB ไม่พร้อม, หรือ HN ผิดรูปแบบ

### 6.5 IPC ที่มี

| API | หน้าที่ |
| --- | --- |
| `window.api.appBarStatus()` / `onAppBarStatus` | สถานะจองพื้นที่ + work area + collapsed |
| `window.api.setCollapsed(bool)` | ย่อ/ขยาย |
| `window.api.hosxpState()` / `onHosxpState` | HOSxP running + HN |
| `window.api.ptInfo(hn)` | ข้อมูลผู้ป่วยจาก DB |
| `window.api.ping()` | health check |
| `window.api.toggleDevTools()`, `quit()` | เครื่องมือ |

---

## 7. สิ่งที่ทดสอบแล้ว (และวิธีตรวจซ้ำ)

| สิ่งที่ทดสอบ | ผล / วิธีตรวจ |
| --- | --- |
| typecheck / lint / build | ผ่านทั้งหมด: `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| AppBar จองพื้นที่ | work area เปลี่ยนเป็น `y = 30`, ความสูงลดลง 30 DIP (ตรวจด้วย `SystemParametersInfo(SPI_GETWORKAREA)`) |
| ปิดแอปคืนพื้นที่ | work area กลับ `y = 0` (ทดสอบทั้งปุ่มปิด, force kill) |
| ย่อ/ขยาย 3 รอบ | viewport คงที่ 38 DIP ไม่บวม, สถานะ reserved สลับถูก |
| HN จากหน้าจอ OPD card | อ่านจาก caption: `{"hn":"000000000","form":"caption"}` |
| HN จากหน้าจอ DoctorOnestop | อ่านจาก label `HN` + MSAA: `000000001` |
| HN จาก dialog Visit Entry | `{"hn":"000000000","form":"TPatientVisitEntryForm"}` |
| ptInfo | `ptInfo('000000002')` → `นายทดสอบ ระบบ / ชาย / 39-2-20`; HN ผิดรูปแบบ → `null` |
| แพ็ก `.exe` | `electron-builder --dir` ทำงาน, helper ถูกคัดลอกไป `resources/hosxp-hn.ps1`, koffi โหลดได้ |

คำสั่งตรวจซ้ำแบบเร็ว:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File resources\hosxp-hn.ps1 -Once
# แก้พอร์ตตามที่รัน: CDP query
# node -e "...fetch('http://127.0.0.1:9343/json')..."  (ดู scripts ชั่วคราวใน %TEMP%)
```

---

## 8. Known issues / กับดักที่ต้องระวัง

1. **`ELECTRON_RUN_AS_NODE=1`** — environment ของ agent นี้ตั้งไว้ ทำให้ `pnpm dev` รัน Electron
   เป็น Node แล้วพัง (`Cannot read properties of undefined (reading 'isPackaged')`)
   ต้อง `Remove-Item Env:ELECTRON_RUN_AS_NODE` ก่อนทุกครั้ง
2. **Single instance lock** — ถ้ามี `topbar-deepseek.exe` (แพ็ก) ค้างอยู่ dev จะไม่ขึ้น
   ต้องปิดตัวเก่าก่อน
3. **ความสูงขั้นต่ำของหน้าต่าง Windows (~38 DIP)** — แถบถูกสร้างสูงกว่านั้นและเลื่อนขึ้นเหนือจอ
   ห้ามเปลี่ยนไปใช้ `setBounds` ด้วยความสูงปัจจุบันซ้ำ ๆ (จะบวมขึ้นเรื่อย ๆ)
4. **หน้าต่างโปร่งใส** — จำเป็นสำหรับโหมดย่อ (เห็นเฉพาะเส้น) และมี `::before` เติมสีด้านบน
   เพื่อกลบ sliver ที่ขอบจอ
5. **การจับ HN เป็น heuristic** — อาศัย caption, ข้อความ label `HN`, การจัดแถวของ control,
   และหน้าต่างที่ visible; ถ้า HOSxP เปลี่ยนหน้าจอ/เวอร์ชัน ต้องปรับ `ReadFromForm`/`TitleHn`
6. **ต้องรัน HOSxP บนเครื่องเดียวกัน** และหน้าจอ HOSxP ต้องไม่ถูกย่อ/ซ่อน (จะอ่านได้เฉพาะ
   หน้าต่างที่ visible) — ถ้าไม่พบ HN แถบจะซ่อนส่วนนั้น
7. **PowerShell** — helper ใช้ `-ExecutionPolicy Bypass` และพึ่ง `oleacc`/`Accessibility`;
   เครื่องที่ปิดสคริปต์หรือมี AV บล็อกอาจรันไม่ได้
8. **`.env` ไม่อยู่ในตัวติดตั้ง** — แพ็กแล้วต้องวาง `.env` ใน `resources` หรือใช้ env vars
9. **root DB user** — ควรเปลี่ยนเป็น read-only user ก่อนใช้งานจริง
10. **PowerShell 5.1 + ไฟล์ไทย** — อย่าใช้ `Set-Content` แบบ default กับไฟล์ที่มีข้อความไทย
    (จะเขียนเป็น ANSI ทำไฟล์เสีย UTF-8) ให้ใช้ editor ของ agent (`write`/`edit` tool) เท่านั้น
11. `dist/` เป็นของเก่าจากการทดสอบแพ็ก — ลบทิ้งได้; `scripts/` ว่างอยู่

---

## 9. งานที่ควรทำต่อ (backlog)

- [ ] `git init` + commit แรก (ก่อนแก้ไขอะไรเพิ่ม)
- [ ] สร้าง DB user แบบ read-only และย้าย credential ออกจาก `.env` ไปเป็น config ของผู้ใช้
- [ ] จำสถานะย่อ/ขยาย (persist) และจำ HN ล่าสุด
- [ ] ปรับการจับ HN ให้ทนกว่าเดิม: ใช้ control id ที่คงที่ หรืออ่านจาก edit ที่ focused
- [ ] รองรับหลายจอ (ตอนนี้ยึดจอหลัก) และ taskbar ที่อยู่ด้านบน
- [ ] หน้า Settings สำหรับตั้งค่า DB/HOSxP path
- [ ] เพิ่ม unit test ให้ `ageYmd` และตัวแปลง HN
- [ ] จัดการ `.env` สำหรับ production (first-run setup)
- [ ] ลบไฟล์/โฟลเดอร์ทดสอบ (`dist/`, `scripts/`) และทำความสะอาด log ใน `%TEMP%`

---

## 10. ข้อมูลอ้างอิง

- ภาพหน้าจอ: `docs/bar.png` (แถบพร้อม HN + PtInfo), `docs/collapsed.png`, `docs/pushed-down.png`
- HOSxP: `HOSxPXE_PCU.exe` v4.64.11.3 (ทดสอบกับฐานข้อมูลตัวอย่าง)
- ตัวอย่างหน้าจอที่รองรับ: `TPatientOPDCardForm` (HN ใน caption),
  `THOSxPDoctorOnstopServiceEntryForm`, `TPatientVisitEntryForm` (dialog)
- ฐานข้อมูล: MySQL/MariaDB สำหรับ HOSxP (พอร์ตปกติ 3306)
- เอกสาร MSAA: `oleacc!AccessibleObjectFromWindow` + `IAccessible::get_accValue`
- เอกสาร AppBar: `SHAppBarMessage` (ABM_NEW / ABM_QUERYPOS / ABM_SETPOS / ABM_REMOVE)
