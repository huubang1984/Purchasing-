// Ham dung khong phan biet hoa thuong (ci/ciFile/ciPrefix) tach rieng sang
// dependency-cruiser-ci.cjs de co the unit-test truc tiep (xem
// tests/architecture/ci-helpers.test.ts) - depcruise clone toan bo module.exports cua file
// nay va validate bang AJV schema "additionalProperties: false", nen khong the gan them ham
// vao day de test (fix round 3, N6).
const { ci, ciFile, ciPrefix } = require("./dependency-cruiser-ci.cjs");

// ==========================================================================================
// FIX ROUND 4 - DOI TU "CAM TUNG CANH" SANG "MAC DINH DONG, MO DUNG HAI CUA"
//
// Ba vong fix truoc deu di theo mot loi: moi khi phat hien mot cach lach cu the, them mot
// quy tac cam dung cach do. Ket qua la ba lan lien tiep tu mo mot lo cung lop:
//   vong 1 -> lo hoa/thuong + cau qua local-dev-wrapper.ts
//   vong 2 -> lo "duong ra": module duoc mien tru vai tro `from` van re-export duoc
//   vong 3 -> dong duong ra cho DUNG BA module, sot module thu tu (local-dev-wrapper.ts)
//
// Nguyen nhan goc KHONG phai bat can ma la HUONG cua bat bien: cach cu mac dinh MO
// (module moi trong packages/crypto-keys/src/ tu dong voi toi duoc tu ben ngoai), nguoi viet
// phai NHO them quy tac de dong lai. Bat ky ai them file thu nam vao thu muc do se lap lai
// dung cau chuyen nay.
//
// Cach dien dat moi dao chieu bat bien: quy tac
// "g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai" coi CA THU MUC
// packages/crypto-keys/src/ la vung han che doi voi moi module ben ngoai, va chi mo dung HAI
// cua: index.ts (mat tien boc khoa, an toan cho moi service) va unwrap.ts (bi canh tiep boi
// quy tac rieng, chi unseal-worker duoc vao). Mot file MOI bat ky trong thu muc do mac dinh
// KHONG voi toi duoc tu ben ngoai - khong ai phai nho lam gi ca.
//
// Cac quy tac "g1-khong-giai-ma-*" van giu nguyen vai tro cua chung: quy tac cua cong khai
// chi canh canh DI VAO thu muc tu ben ngoai; canh NOI BO (vd. local-dev-wrapper.ts ->
// local-dev-unwrapper.ts, cau noi tu mat boc an toan sang kha nang giai ma) van phai bi cam
// rieng vi ca hai dau canh deu nam trong thu muc.
//
// TIEN TO "g1-" LA MOT GIAO UOC MAY DOC DUOC, khong phai trang tri: test bat bien
// "[INV-G1] moi module duoc mien tru vai tro `from` phai dong thoi la dich han che"
// (tests/architecture/boundaries.test.ts) quet chinh file nay, loc cac quy tac co tien to
// "g1-", giai ma nguoc `from.pathNot` bang unCi() va kiem tra tung module duoc mien tru co
// duoc mot quy tac "g1-" khac chan duong vao hay khong. Do la co che CUONG CHE BANG MAY cho
// dung lop loi da tai dien ba vong - khong con phu thuoc vao viec ai do nghi ra ca cu the.
// Them mot mien tru moi ma quen bien no thanh dich han che => test do ngay.
// ==========================================================================================

const CRYPTO_KEYS_SRC_PREFIX = ciPrefix("packages/crypto-keys/src/");
const APPS_UNSEAL_WORKER_PREFIX = ciPrefix("apps/unseal-worker/");
const BENCH_KEYPROVIDER_SRC_PREFIX = ciPrefix("tools/bench-keyprovider/src/");
const INDEX_TS = ciFile("packages/crypto-keys/src/index.ts");
const UNWRAP_TS = ciFile("packages/crypto-keys/src/unwrap.ts");
const LOCAL_DEV_WRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-wrapper.ts");
const LOCAL_DEV_UNWRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-unwrapper.ts");
const LOCAL_DEV_SHARED_TS = ciFile("packages/crypto-keys/src/local-dev-shared.ts");
const ROUNDTRIP_TEST_TS = ciFile("packages/crypto-keys/src/roundtrip.test.ts");
const BENCH_INDEX_TS = ciFile("tools/bench-keyprovider/src/index.ts");

// ==========================================================================================
// VONG FIX 2 (MUC D) - CUNG KHUON "MAC DINH DONG", AP CHO packages/identity/src/
//
// Bat doi xung do duoc tai HEAD 33985b8, ba duong toi CUNG mot symbol `hasPermission`:
//   @trustprocure/identity              (barrel)  -> khong co symbol (da rut o vong fix 1)
//   @trustprocure/identity/src/rbac.js            -> depcruise CHAN + tsc CHAN (TS2307)
//   ../../identity/src/rbac.js tu packages/audit  -> CHAY DUOC, depcruise IM, tsc IM, eslint IM
// Tuc lop cuong che duy nhat cua vong fix 1 (test bare-exports canh TAP EXPORT cua barrel)
// KHONG canh duong tuong doi xuyen goi. crypto-keys DA co quy tac cua-cong-khai dong dung lop
// nay tu fix round 4; identity thi khong. Quy tac duoi day la BAN SAO CHINH XAC cua khuon do,
// mang tien to "g2-" de test bat bien "[INV-G2]" (tests/architecture/boundaries.test.ts) quet
// duoc theo ho ten - cung co che CUONG CHE BANG MAY, khong phu thuoc vao viec ai do nghi ra ca
// cu the. `index.ts` la CUA DUY NHAT vi tap export cua no da bi mot lop khac canh
// (tests/architecture/barrel-exports.test.ts, danh sach trang [INV-D5]); hai lop nay bo tuc
// cho nhau: mot lop canh SYMBOL di qua cua, lop kia canh viec KHONG AI DI VONG QUA CUA.
// ==========================================================================================
// ==========================================================================================
// S1.1 - HO "g5-", CUNG KHUON "MAC DINH DONG", AP CHO packages/supplier/src/
//
// LAN THU TU cung mot khuon, va lan nay no duoc dung TRUOC khi goi co file thu hai:
//   crypto-keys -> g1 (fix round 4) - identity -> g2/H11 (Task 9) - outbox -> g4/H13 (Task 10)
//   - supplier -> DAY.
//
// Khac biet duy nhat, va no dang ghi ra: ba lan truoc deu la VA XONG ROI SUA - lo duoc do bang
// mot probe import tuong doi xuyen goi di lot ca ba cong (depcruise, tsc, eslint), roi quy tac
// moi duoc them vao. Lan nay quy tac ra doi CUNG LUC voi goi, nen khoan no 17 ("bon goi con lai
// khong co quy tac bien gioi") khong lon them. No KHONG duoc dong boi dong nay: audit, db,
// tenancy, test-support van chua co gi.
// ==========================================================================================
const SUPPLIER_SRC_PREFIX = ciPrefix("packages/supplier/src/");
const SUPPLIER_INDEX_TS = ciFile("packages/supplier/src/index.ts");

// S1.2 - ho "g6-", ap cho packages/rfq/src/. Lan thu NAM cung mot khuon.
// Den lan thu nam thi viec them tay tung ho quy tac chinh la KHUON DANH-SACH-TEN ma du an da
// phat hien hong ba lan (khoan no 3, 16, 17) - chi khac la danh sach nam trong dau nguoi viet
// thay vi trong mot bien. Vi vay S1.2 them mot lop SUY TU TINH CHAT:
// tests/architecture/bien-gioi-goi.test.ts [INV-H16] doi MOI goi trong packages/ phai co mot
// ho quy tac dong src/ cua no, voi mot danh sach mien tru DONG gom dung bon goi cua S0 va CHI
// DUOC CO LAI. Goi thu sau khong can ai nho gi ca - test do khi quy tac vang mat.
const RFQ_SRC_PREFIX = ciPrefix("packages/rfq/src/");
const RFQ_INDEX_TS = ciFile("packages/rfq/src/index.ts");

// S1.3 - ho "g7-", ap cho packages/invitation/src/. Lan thu SAU, va la lan DAU TIEN quy tac
// nay khong ra doi vi ai do nho: [INV-H16] (tests/architecture/bien-gioi-goi.test.ts) DO NGAY
// khi goi moi xuat hien ma khong co ho quy tac nao dong src/ cua no.
const INVITATION_SRC_PREFIX = ciPrefix("packages/invitation/src/");
const INVITATION_INDEX_TS = ciFile("packages/invitation/src/index.ts");

// ==========================================================================================
// S1.4 - HO "g8-", AP CHO packages/sealed-envelope/src/. Lan thu BAY cung mot khuon, va la lan
// DAU TIEN mot goi MOI ra doi voi HAI cua thay vi mot - dung hinh dang cua packages/crypto-keys.
//
// Cua thu hai (`unseal.ts`) khong phai mot tien nghi ma la mot yeu cau do duoc: khong co duong
// MO, khong phep do nao noi duoc gi ve duong NIEM PHONG. ADR-011 "Do bang gi" muc 1 viet thang
// dieu do: "mot phong bi niem phong chi bang P-256 phai mo duoc tron ven. Khong co ve nay, 'ho
// tro ca hai' la mot loi khai."
//
// Khac biet voi g1-: `unseal.ts` KHONG import duong mo boc khoa cua crypto-keys. No nhan khoa
// rieng da o dang PKCS8. Nho the hang rao G1 giu DUNG MOT mien tru (`apps/unseal-worker/`)
// thay vi hai, va mien tru thu hai kia se la ca mot GOI chu khong phai mot app.
// ==========================================================================================
const SEALED_ENVELOPE_SRC_PREFIX = ciPrefix("packages/sealed-envelope/src/");
const SEALED_ENVELOPE_INDEX_TS = ciFile("packages/sealed-envelope/src/index.ts");
const SEALED_ENVELOPE_UNSEAL_TS = ciFile("packages/sealed-envelope/src/unseal.ts");
const SEALED_ENVELOPE_ROUNDTRIP_TEST_TS = ciFile("packages/sealed-envelope/src/roundtrip.test.ts");
const SEALED_ENVELOPE_KEY_MATERIAL_INT_TEST_TS = ciFile(
  "packages/sealed-envelope/src/key-material.int.test.ts",
);

const IDENTITY_SRC_PREFIX = ciPrefix("packages/identity/src/");
const IDENTITY_INDEX_TS = ciFile("packages/identity/src/index.ts");

// ==========================================================================================
// VONG FIX 1 TASK 10 (dac ta IMPORTANT 1) - HO "g4-", CUNG KHUON "MAC DINH DONG", AP CHO
// packages/outbox/src/
//
// LAN THU BA CUNG MOT LOP LO, va lan nay no duoc do TRUOC khi bi khai thac:
//   crypto-keys -> g1 (fix round 4) · identity -> g2/H11 (Task 9 vong fix 1) · outbox -> DAY.
// Phep do cua reviewer dac ta, tai lap duoc: mot file
//   packages/audit/src/zz-probe-outbox-leak.ts  voi  import "../../outbox/src/runner.js"
// di lot CA BA CONG - depcruise 0 vi pham, tsc exit 0, eslint exit 0. Doi chung: ban dung bare
// specifier "@trustprocure/outbox/src/runner.js" bi chan CA HAI lop
// (g1-khong-import-trustprocure-khong-resolve-duoc + TS2307). Tuc danh sach trang barrel
// (tests/architecture/barrel-exports.test.ts) khoa DANH SACH o CUA, no khong dung BUC TUONG.
//
// Vi sao lam BAY GIO thay vi ghi thanh dieu kien vao cua Task 11: bao cao vong truoc tu khai
// khoan nay kem ly do (mot ma bat bien hang rao moi va mot sua doi docs/TEST-PLAN.md §5 va
// thang vao viec hoa giai "34 vs 46"). Ly do do dung ve CHI PHI va sai ve THU TU: hai con so
// 12/46 phai duoc SUA cho DUNG khi mot hang rao moi ra doi, con viec HOA GIAI cach dem la mot
// viec khac han. De ho mot lo da do duoc chi de mot con so khoi doi la nguoc thu tu uu tien.
//
// TIEN TO "g4-" LA MOT GIAO UOC MAY DOC DUOC, giong g1-/g2-/g3-: test "[INV-H13]" o
// tests/architecture/boundaries.test.ts loc theo tien to nay.
// ==========================================================================================
const OUTBOX_SRC_PREFIX = ciPrefix("packages/outbox/src/");
const OUTBOX_INDEX_TS = ciFile("packages/outbox/src/index.ts");

// ==========================================================================================
// TASK 9 (T9-A) - HUONG NGUOC VOI "NOI G1": GHIM THEM MOT HANG RAO, KHONG NOI HANG RAO CU
//
// Task 9 can xac thuc TOTP, ma xac thuc TOTP doi BI MAT RO. Duong di HIEN NHIEN la mien tru
// packages/identity khoi g1-...-unwrap-ts. Do dung thu QT2 cam: G1 giam kha nang GIAI MA HO SO
// THAU vao MOT app, nen mot dong mien tru o do bien mot API server bi chiem thanh mot tien
// trinh GIAI MA DUOC HO SO THAU. Doi mot tinh nang dang nhap lay ban kinh no cua ca san.
//
// Quy tac duoi day di nguoc lai: no CAM packages/identity cham vao crypto-keys BANG MOI DUONG
// (bare specifier, subpath export, duong tuong doi xuyen goi, va ca `import type` - depcruise
// thay canh chi-kieu vi tsPreCompilationDeps: true). Nho vay phat bieu "goi identity KHONG CO
// NANG LUC MAT MA" tro thanh mot thu do duoc bang may, khong phai mot loi hua trong chu thich.
//
// Cai gia phai tra, noi thang: bi mat TOTP van phai mo duoc boi AI DO. Duong da chon la mot
// CONG (`TotpSecretUnsealer` trong packages/identity/src/mfa-credentials.ts) — identity khai
// hop dong, composition root tiem cai dat. Du luong: hom nay KHONG lop nao cuong che duoc rang
// cai dat duoc tiem KHONG PHAI la bo mo phong bi ho so thau; lop do chi viet duoc khi `apps/`
// ra doi, va no se la mot quy tac cung khuon voi ba ho g1-/g2-/g3- nay. Xem task-9-report.md.
//
// TIEN TO "g3-" LA MOT GIAO UOC MAY DOC DUOC, giong g1-/g2-: test "[INV-G3]" o
// tests/architecture/boundaries.test.ts loc theo tien to nay.
// ==========================================================================================
const CRYPTO_KEYS_PKG_PREFIX = ciPrefix("packages/crypto-keys/");

module.exports = {
  forbidden: [
    {
      name: "g3-identity-khong-co-nang-luc-mat-ma",
      comment:
        "packages/identity KHONG duoc import bat cu thu gi tu packages/crypto-keys - ke ca mat " +
        "tien BOC an toan (index.ts). Ly do la mot bat bien co ten (G1/ADR-006): xac thuc TOTP " +
        "doi bi mat RO, nen ngay khi identity co MOT canh toi crypto-keys, duong di de nhat de " +
        "lam no chay duoc la mien tru identity khoi quy tac chan unwrap.ts - va khi do mot " +
        "app_api bi chiem GIAI MA DUOC HO SO THAU. Chan CA duong boc chu khong chi duong mo, vi " +
        "chinh su co mat cua canh do la thu bien viec noi G1 thanh mot dong sua nho. Bi mat MFA " +
        "duoc mo qua cong TotpSecretUnsealer, do composition root tiem vao.",
      severity: "error",
      from: { path: IDENTITY_SRC_PREFIX },
      to: { path: CRYPTO_KEYS_PKG_PREFIX },
    },
    {
      name: "g4-outbox-chi-index-la-cua-cong-khai",
      comment:
        "Toan bo packages/outbox/src/ la vung han che doi voi module ben ngoai package. Chi " +
        "index.ts duoc mo. Ly do khong phai kien truc chung chung: mot import TUONG DOI " +
        "'../../outbox/src/runner.js' tu mot goi khac di lot CA BA cong (depcruise, tsc, " +
        "eslint) - do duoc o vong fix 1 Task 10. Danh sach trang barrel khoa DANH SACH export " +
        "o CUA, no KHONG ngan viec di vong qua cua. Moi file khac - ke ca file CHUA TON TAI - " +
        "mac dinh khong voi toi duoc tu ben ngoai, nen mot module moi trong thu muc nay khong " +
        "doi ai phai nho lam gi ca.",
      severity: "error",
      from: { pathNot: OUTBOX_SRC_PREFIX },
      to: { path: OUTBOX_SRC_PREFIX, pathNot: [OUTBOX_INDEX_TS] },
    },
    {
      name: "g8-sealed-envelope-chi-index-va-unseal-la-cua-cong-khai",
      comment:
        "Toan bo packages/sealed-envelope/src/ la vung han che doi voi module ben ngoai package. " +
        "Chi hai cua duoc mo: index.ts (niem phong + vong doi khoa, an toan cho moi service) va " +
        "unseal.ts (bi canh tiep boi g8-khong-mo-phong-bi-ngoai-unseal-worker). Bat bien co ten " +
        "dang duoc giu o cua index.ts: KHONG symbol nao o do nhan hay tra mot khoa rieng - " +
        "issueRfqKeyPair sinh ra mot khoa rieng va tra ve moi thu TRU no (ADR-019 muc 1). Mot " +
        "import tuong doi vao format.ts tu goi khac se lay duoc deriveContentKey va importPrivateKey, " +
        "tuc du de mo mot phong bi neu co khoa rieng - dung thu cua thu hai duoc dung de chan.",
      severity: "error",
      from: { pathNot: SEALED_ENVELOPE_SRC_PREFIX },
      to: {
        path: SEALED_ENVELOPE_SRC_PREFIX,
        pathNot: [SEALED_ENVELOPE_INDEX_TS, SEALED_ENVELOPE_UNSEAL_TS],
      },
    },
    {
      name: "g8-khong-mo-phong-bi-ngoai-unseal-worker",
      comment:
        "Chi apps/unseal-worker va test vong doi cua chinh package duoc import unseal.ts " +
        "(ADR-006, ADR-019, bat bien A2/G1). Danh sach mien tru nay CHI DUOC CO LAI. " +
        "KHONG can mot quy tac 'khong-import-nguoc-tu-roundtrip-test' rieng nhu ho g1-: quy tac " +
        "cua cong khai o tren da bien MOI file trong src/ ngoai hai cua thanh dich han che, va " +
        "roundtrip.test.ts la mot trong so do. Ba quy tac nguoc cua g1- ra doi o fix round 3, " +
        "TRUOC khi fix round 4 dung quy tac ca-thu-muc; o day thu tu nguoc lai nen khong co du " +
        "thua. Ghi ra vi mot quy tac VANG MAT trong mot ho quy tac se bi doc thanh mot thieu sot.",
      severity: "error",
      from: {
        pathNot: [
          APPS_UNSEAL_WORKER_PREFIX,
          SEALED_ENVELOPE_ROUNDTRIP_TEST_TS,
          // Hai file test, HAI viec khac nhau, va ca hai deu doi duong MO — mot lop mo phong bi
          // khong co phep do nao la mot lop khong ai biet no con chay hay khong.
          //   roundtrip.test.ts        - phan MAT MA thuan, khong cham CSDL.
          //   key-material.int.test.ts - chuoi TRON VEN tu CSDL ra phong bi va nguoc lai.
          // Ca hai deu nam TRONG packages/sealed-envelope/src/, nen ca hai da la dich han che cua
          // quy tac cua-cong-khai o tren: khong module ngoai goi nao import nguoc vao chung duoc.
          SEALED_ENVELOPE_KEY_MATERIAL_INT_TEST_TS,
        ],
      },
      to: { path: SEALED_ENVELOPE_UNSEAL_TS },
    },
    {
      name: "g7-invitation-chi-index-la-cua-cong-khai",
      comment:
        "Toan bo packages/invitation/src/ la vung han che doi voi module ben ngoai package. " +
        "Chi index.ts duoc mo. Bat bien co ten dang duoc giu la E2: khong ham nao o cua nay tra " +
        "ve mot PHIEN tu mot TOKEN - redeemMagicLink tra ve mot thu khong mo duoc gi, va ham duy " +
        "nhat sinh phien doi mot ma OTP. Mot import tuong doi vao suppliers/invitation.js tu goi " +
        "khac se lay duoc ca cac ham noi bo va dung duoc mot duong di vong qua OTP.",
      severity: "error",
      from: { pathNot: INVITATION_SRC_PREFIX },
      to: { path: INVITATION_SRC_PREFIX, pathNot: [INVITATION_INDEX_TS] },
    },
    {
      name: "g6-rfq-chi-index-la-cua-cong-khai",
      comment:
        "Toan bo packages/rfq/src/ la vung han che doi voi module ben ngoai package. Chi " +
        "index.ts duoc mo. Bat bien co ten dang duoc giu: moi ham cua goi nay goi " +
        "assertTenantBound TRUOC MOI THU, va RFQ_TRANSITIONS la ban sao DE DOC cua bang canh " +
        "trong 009 chu khong phai lop cuong che - mot cong gac dung no se canh dung duong di " +
        "qua no, trong khi trigger canh MOI duong. Mot module moi trong thu muc nay mac dinh " +
        "khong voi toi duoc tu ben ngoai.",
      severity: "error",
      from: { pathNot: RFQ_SRC_PREFIX },
      to: { path: RFQ_SRC_PREFIX, pathNot: [RFQ_INDEX_TS] },
    },
    {
      name: "g5-supplier-chi-index-la-cua-cong-khai",
      comment:
        "Toan bo packages/supplier/src/ la vung han che doi voi module ben ngoai package. Chi " +
        "index.ts duoc mo. Ly do khong phai kien truc chung chung: mot import TUONG DOI " +
        "'../../supplier/src/suppliers.js' tu mot goi khac di lot CA BA cong (depcruise, tsc, " +
        "eslint) - do duoc ba lan o crypto-keys, identity va outbox. Bat bien co ten dang duoc " +
        "giu o day: moi ham cua goi nay goi assertTenantBound TRUOC MOI THU, va mot module moi " +
        "trong thu muc nay khong doi ai phai nho lam gi ca - mac dinh no khong voi toi duoc tu " +
        "ben ngoai. Danh sach trang barrel khoa DANH SACH export o CUA; no khong dung BUC TUONG.",
      severity: "error",
      from: { pathNot: SUPPLIER_SRC_PREFIX },
      to: { path: SUPPLIER_SRC_PREFIX, pathNot: [SUPPLIER_INDEX_TS] },
    },
    {
      name: "g2-identity-chi-index-la-cua-cong-khai",
      comment:
        "Toan bo packages/identity/src/ la vung han che doi voi module ben ngoai package. Chi " +
        "index.ts duoc mo. Ly do KHONG phai kien truc chung chung ma la mot bat bien co ten: " +
        "`hasPermission` tra boolean va KHONG ghi kiem toan, nen mot cong gac viet bang no vi " +
        "pham D5 TRONG IM LANG (do duoc: do 11 ma quyen -> 0 ban ghi moi). Vong fix 1 rut no " +
        "khoi barrel, nhung mot import TUONG DOI `../../identity/src/rbac.js` van cham toi no " +
        "va KHONG lop nao keu. Moi file khac - ke ca file CHUA TON TAI - mac dinh khong voi toi " +
        "duoc tu ben ngoai.",
      severity: "error",
      from: { pathNot: IDENTITY_SRC_PREFIX },
      to: { path: IDENTITY_SRC_PREFIX, pathNot: [IDENTITY_INDEX_TS] },
    },
    {
      name: "g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai",
      comment:
        "Toan bo packages/crypto-keys/src/ la vung han che doi voi module ben ngoai package. " +
        "Chi hai cua duoc mo: index.ts (mat tien boc khoa) va unwrap.ts (bi canh tiep boi " +
        "g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts). Moi file khac - ke ca file CHUA " +
        "TON TAI - mac dinh khong voi toi duoc tu ben ngoai. Day la quy tac dong lo CR1 " +
        "(fix round 4): local-dev-wrapper.ts duoc mien tru vai tro `from` o quy tac " +
        "local-dev-shared-ts nhung truoc day khong phai dich han che, nen no re-export " +
        "deriveOrgKey mot dong la bat cu app nao cung import duoc thang vao no.",
      severity: "error",
      from: { pathNot: CRYPTO_KEYS_SRC_PREFIX },
      to: { path: CRYPTO_KEYS_SRC_PREFIX, pathNot: [INDEX_TS, UNWRAP_TS] },
    },
    // Ba quy tac rieng, MOI quy tac dung MOT dich (`to`) va danh sach `from` mien tru
    // rieng cho DICH DO. Mot quy tac voi `to.path` la mang nhieu file va MOT danh sach
    // `from.pathNot` dung chung cho ca dam se mien tru mot file "ke" cho ca nhung dich no
    // khong he can (phat hien N2, fix round 2) - vi vay moi dich co quy tac rieng.
    // Chung van can thiet sau fix round 4 vi quy tac cua cong khai o tren chi canh canh DI
    // VAO thu muc tu BEN NGOAI; ba quy tac nay canh ca canh NOI BO trong chinh thu muc.
    {
      name: "g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts",
      comment:
        "Chi apps/unseal-worker, test vong doi khoa cua chinh package, va cong cu benchmark " +
        "dev-only duoc import unwrap.ts (ADR-006, bat bien G1).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER_PREFIX, ROUNDTRIP_TEST_TS, BENCH_INDEX_TS] },
      to: { path: UNWRAP_TS },
    },
    {
      name: "g1-khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts",
      comment:
        "Chi apps/unseal-worker VA unwrap.ts (mat tien cong khai cua chinh no) duoc import " +
        "local-dev-unwrapper.ts. local-dev-wrapper.ts (mat boc, an toan) KHONG duoc liet ke o " +
        "day - neu no import file nay, do la mot cau noi bac cau khoi mat boc an toan sang kha " +
        "nang giai ma, phai bi chan (fix round 2, phat hien N2).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER_PREFIX, UNWRAP_TS] },
      to: { path: LOCAL_DEV_UNWRAPPER_TS },
    },
    {
      name: "g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts",
      comment:
        "Chi apps/unseal-worker va hai file cai dat (wrap + unwrap) duoc import " +
        "local-dev-shared.ts - deriveOrgKey cong node:crypto la du de tu giai ma, khong can " +
        "dung toi unwrap.ts (bat bien G1, phat hien C2 o fix round 1).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER_PREFIX, LOCAL_DEV_WRAPPER_TS, LOCAL_DEV_UNWRAPPER_TS] },
      to: { path: LOCAL_DEV_SHARED_TS },
    },
    // Ba quy tac duoi day dong "duong ra" (fix round 3, phat hien N5): ba quy tac tren mien
    // tru roundtrip.test.ts, tools/bench-keyprovider/src/**, va apps/unseal-worker/** khoi vai
    // tro `from` de chung duoc phep goi vao unwrap.ts/local-dev-unwrapper.ts/local-dev-shared.ts
    // - nhung khong quy tac nao cam import NGUOC LAI vao chinh ba noi do. Mot module bat ky co
    // the import lai tu roundtrip.test.ts, tu bat ky file nao trong tools/bench-keyprovider/src,
    // hoac tu bat ky file nao trong apps/unseal-worker (kho nguy hiem nhat vi thu muc nay CHUA
    // TON TAI - khi no ra doi, moi symbol no export se voi toi duoc tu moi noi neu khong co ba
    // quy tac nay). Bien ca ba thanh DICH HAN CHE: khong module nao ngoai chinh cay cua chung
    // duoc phep import bat cu thu gi ben trong.
    {
      name: "g1-khong-import-nguoc-tu-apps-unseal-worker",
      comment:
        "apps/unseal-worker la noi DUY NHAT duoc giu kha nang giai ma - khong module nao ben " +
        "ngoai no duoc phep import bat cu thu gi no export, ke ca khi thu do chi la mot cau " +
        "noi/re-export. Neu khong co quy tac nay, mot module ben trong unseal-worker co the " +
        "re-export createLocalDevUnwrapper va bat ky app nao khac import lai duoc ma khong " +
        "cham quy tac nao khac (fix round 3, phat hien N5).",
      severity: "error",
      from: { pathNot: APPS_UNSEAL_WORKER_PREFIX },
      to: { path: APPS_UNSEAL_WORKER_PREFIX },
    },
    {
      name: "g1-khong-import-nguoc-tu-bench-keyprovider",
      comment:
        "tools/bench-keyprovider la cong cu dev-only duoc mien tru goi unwrap.ts de do hieu " +
        "nang - nhung khong gi ngoai chinh no duoc phep import LAI tu no, tranh no tro thanh " +
        "cau noi thu hai dua kha nang giai ma ra ngoai (fix round 3, phat hien N5).",
      severity: "error",
      from: { pathNot: BENCH_KEYPROVIDER_SRC_PREFIX },
      to: { path: BENCH_KEYPROVIDER_SRC_PREFIX },
    },
    {
      name: "g1-khong-import-nguoc-tu-roundtrip-test",
      comment:
        "roundtrip.test.ts la file test, khong phai module san xuat - khong co ly do hop phap " +
        "nao de bat ky module nao import no. Khong mien tru module nao (fix round 3, phat " +
        "hien N5): day la cau noi thu ba co the dua kha nang giai ma ra ngoai neu bi bo qua. " +
        "Quy tac nay chat hon quy tac cua cong khai (no cam ca module NOI BO trong " +
        "packages/crypto-keys/src/ import file test nay), nen khong bi no thay the.",
      severity: "error",
      from: {},
      to: { path: ROUNDTRIP_TEST_TS },
    },
    {
      name: "g1-khong-import-trustprocure-khong-resolve-duoc",
      comment:
        "Import dang @trustprocure/* khong resolve duoc ra file that la dau hieu loi cau hinh " +
        "(subpath export sai, typo, thieu entry trong package.json 'exports') - KHONG duoc de " +
        "am tham lot qua moi quy tac khac. Day chinh xac la cach ma " +
        "@trustprocure/crypto-keys/unwrap tung lot qua quy tac giai-ma-ngoai-unseal-worker " +
        "o ban truoc fix round 1: specifier khong resolve duoc nen khong khop `to.path`, quy tac " +
        "coi nhu khong co gi de chan. Quy tac nay la lop phong thu chong lai chinh lop loi do.",
      severity: "error",
      from: {},
      to: { path: "^" + ci("@trustprocure/"), couldNotResolve: true },
    },
    {
      name: "khong-phu-thuoc-vong",
      comment: "Phụ thuộc vòng làm ranh giới module mất ý nghĩa.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "khong-phu-thuoc-devdep-trong-src",
      severity: "error",
      from: { pathNot: "\\.(test|config)\\.(ts|js|cjs)$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    // FIX ROUND 4 (CR2) - CA HAI REGEX DUOI DAY PHAI DUOC NEO THEO DOAN DUONG DAN.
    //
    // Ban truoc dung "node_modules" va "(node_modules|dist|\\.next)" - regex KHONG NEO, khop
    // chuoi con o BAT KY DAU. Moi duong dan chua "dist", ".next" hay "node_modules" nhu mot
    // MANH cua ten thu muc/file bi loai khoi cruise HOAN TOAN: hang rao G1 tat cho module do,
    // va ca test "ma nguon hien tai khong vi pham quy tac nao" cung khong thay gi. Ten hop le
    // trung bay rat de gap: apps/distribution/, distinct.ts, district/, redistribute.ts.
    //
    // Da kiem chung trong worktree sach tai 0f27852: them apps/distribution/src/leak.ts
    // (import deriveOrgKey tu local-dev-shared.ts) -> "36 modules, 59 dependencies", DUNG BANG
    // baseline, EXIT=0; doi ten thu muc thanh apps/khongtrungbay -> "37 modules", vi pham,
    // EXIT=1. Cung mot noi dung file, khac moi ten thu muc.
    //
    // "(^|/)X(/|$)" chi khop khi X la MOT DOAN nguyen ven cua duong dan. Co y GIU PHAN BIET
    // HOA THUONG o day (khong dung ci()): exclude/doNotFollow la thao tac NOI LONG, lam no
    // khong phan biet hoa thuong se MO RONG vung khong duoc quet - nguoc huong an toan.
    doNotFollow: { path: "(^|/)node_modules(/|$)" },
    exclude: { path: "(^|/)(node_modules|dist|\\.next)(/|$)" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    // Bat buoc de depcruise tu resolve subpath export (vd. "@trustprocure/crypto-keys/unwrap")
    // qua package.json "exports", giong het cach Node/bundler that resolve luc chay. Thieu dong
    // nay, subpath khong map dung qua tsconfig "paths" (mot wildcard khong xu ly duoc subpath
    // long) va depcruise coi module la "couldNotResolve" - bo qua toan bo quy tac "to.path" mot
    // cach am tham. Day la nguyen nhan goc cua lo hong C1 phat hien o fix round 1.
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
