// Regex khong phan biet hoa thuong bang character-class thu cong.
//
// LY DO: depcruise tu choi nhan RegExp object cho path/pathNot (schema chi cho string
// hoac string[]) va khong co option "caseSensitive" o muc rule. Nhung tren Windows/macOS,
// he thong file resolve KHONG phan biet hoa thuong, va truong "resolved" cua depcruise
// GIU NGUYEN hoa thuong nguoi viet go trong specifier (khong chuan hoa ve ten that tren
// dia). Mot file .mjs/.cjs import "Local-Dev-Shared.ts" (sai hoa thuong) van resolve
// thanh cong tren Windows, nhung regex phan biet hoa thuong khop "local-dev-shared.ts"
// se KHONG khop voi "Local-Dev-Shared.ts" - hang rao im lang bo qua.
// Day la CUNG MOT LOP LOI da lam thung hook o Task 1 (.ENV, ID_RSA lot qua so khop phan
// biet hoa thuong tren Windows) - tai dien o tang depcruise (fix round 2, phat hien N1).
//
// Chi can xu ly dau "." (dau cham trong ten file) vi day la ky tu regex dac biet duy nhat
// xuat hien trong cac chuoi literal duong dan cua du an nay (con lai chi co chu cai,
// so, dau gach ngang, dau gach cheo - khong co ky tu regex dac biet nao khac).
function ciChar(pKyTu) {
  if (pKyTu === ".") {
    return "\\.";
  }
  if (/[a-zA-Z]/.test(pKyTu)) {
    const chuThuong = pKyTu.toLowerCase();
    const chuHoa = pKyTu.toUpperCase();
    return chuThuong === chuHoa ? pKyTu : "[" + chuThuong + chuHoa + "]";
  }
  return pKyTu;
}

/** Chuyen mot chuoi literal (duong dan) thanh fragment regex khop moi cach viet hoa/thuong. */
function ci(pLiteral) {
  return pLiteral.split("").map(ciChar).join("");
}

/** Fragment regex khop chinh xac MOT file, bat ky hoa thuong. */
function ciFile(pLiteralPath) {
  return "^" + ci(pLiteralPath) + "$";
}

/** Fragment regex khop MOT tien to thu muc, bat ky hoa thuong (khong neo cuoi chuoi). */
function ciPrefix(pLiteralPrefix) {
  return "^" + ci(pLiteralPrefix);
}

const APPS_UNSEAL_WORKER = ciPrefix("apps/unseal-worker/");
const UNWRAP_TS = ciFile("packages/crypto-keys/src/unwrap.ts");
const LOCAL_DEV_WRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-wrapper.ts");
const LOCAL_DEV_UNWRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-unwrapper.ts");
const LOCAL_DEV_SHARED_TS = ciFile("packages/crypto-keys/src/local-dev-shared.ts");
const ROUNDTRIP_TEST_TS = ciFile("packages/crypto-keys/src/roundtrip.test.ts");
const BENCH_INDEX_TS = ciFile("tools/bench-keyprovider/src/index.ts");

module.exports = {
  forbidden: [
    // Ba quy tac rieng, MOI quy tac dung MOT dich (`to`) va danh sach `from` mien tru
    // rieng cho DICH DO. Fix round 1 dung MOT quy tac voi `to.path` la mang ba file va
    // MOT danh sach `from.pathNot` dung chung cho ca ba - nghia la mot file duoc mien tru
    // se mien tru voi CA BA dich, ke ca nhung dich no khong he can (phat hien N2). Vi du:
    // local-dev-wrapper.ts chi can mien tru de goi local-dev-shared.ts, nhung duoc mien tru
    // "ngam" luon ca voi local-dev-unwrapper.ts va unwrap.ts - neu ai do them
    // `export { createLocalDevUnwrapper } from "./local-dev-unwrapper.js"` vao
    // local-dev-wrapper.ts, canh do lot qua khong mot tieng dong. Tach rieng tung quy tac
    // dam bao moi mien tru chi co hieu luc DUNG cho canh no thuc su can.
    {
      name: "khong-giai-ma-ngoai-unseal-worker-unwrap-ts",
      comment:
        "Chi apps/unseal-worker, test vong doi khoa cua chinh package, va cong cu benchmark " +
        "dev-only duoc import unwrap.ts (ADR-006, bat bien G1).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER, ROUNDTRIP_TEST_TS, BENCH_INDEX_TS] },
      to: { path: UNWRAP_TS },
    },
    {
      name: "khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts",
      comment:
        "Chi apps/unseal-worker VA unwrap.ts (mat tien cong khai cua chinh no) duoc import " +
        "local-dev-unwrapper.ts. local-dev-wrapper.ts (mat boc, an toan) KHONG duoc liet ke o " +
        "day - neu no import file nay, do la mot cau noi bac cau khoi mat boc an toan sang kha " +
        "nang giai ma, phai bi chan (fix round 2, phat hien N2).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER, UNWRAP_TS] },
      to: { path: LOCAL_DEV_UNWRAPPER_TS },
    },
    {
      name: "khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts",
      comment:
        "Chi apps/unseal-worker va hai file cai dat (wrap + unwrap) duoc import " +
        "local-dev-shared.ts - deriveOrgKey cong node:crypto la du de tu giai ma, khong can " +
        "dung toi unwrap.ts (bat bien G1, phat hien C2 o fix round 1).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER, LOCAL_DEV_WRAPPER_TS, LOCAL_DEV_UNWRAPPER_TS] },
      to: { path: LOCAL_DEV_SHARED_TS },
    },
    {
      name: "khong-import-trustprocure-khong-resolve-duoc",
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
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|dist|\\.next)" },
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
