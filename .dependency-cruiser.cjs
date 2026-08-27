// Ham dung khong phan biet hoa thuong (ci/ciFile/ciPrefix) tach rieng sang
// dependency-cruiser-ci.cjs de co the unit-test truc tiep (xem
// tests/architecture/ci-helpers.test.ts) - depcruise clone toan bo module.exports cua file
// nay va validate bang AJV schema "additionalProperties: false", nen khong the gan them ham
// vao day de test (fix round 3, N6).
const { ci, ciFile, ciPrefix } = require("./dependency-cruiser-ci.cjs");

const APPS_UNSEAL_WORKER_PREFIX = ciPrefix("apps/unseal-worker/");
const BENCH_KEYPROVIDER_SRC_PREFIX = ciPrefix("tools/bench-keyprovider/src/");
const UNWRAP_TS = ciFile("packages/crypto-keys/src/unwrap.ts");
const LOCAL_DEV_WRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-wrapper.ts");
const LOCAL_DEV_UNWRAPPER_TS = ciFile("packages/crypto-keys/src/local-dev-unwrapper.ts");
const LOCAL_DEV_SHARED_TS = ciFile("packages/crypto-keys/src/local-dev-shared.ts");
const ROUNDTRIP_TEST_TS = ciFile("packages/crypto-keys/src/roundtrip.test.ts");
const BENCH_INDEX_TS = ciFile("tools/bench-keyprovider/src/index.ts");

module.exports = {
  forbidden: [
    // Ba quy tac rieng, MOI quy tac dung MOT dich (`to`) va danh sach `from` mien tru
    // rieng cho DICH DO. Mot quy tac voi `to.path` la mang nhieu file va MOT danh sach
    // `from.pathNot` dung chung cho ca dam se mien tru mot file "ke" cho ca nhung dich no
    // khong he can (phat hien N2, fix round 2) - vi vay moi dich co quy tac rieng.
    {
      name: "khong-giai-ma-ngoai-unseal-worker-unwrap-ts",
      comment:
        "Chi apps/unseal-worker, test vong doi khoa cua chinh package, va cong cu benchmark " +
        "dev-only duoc import unwrap.ts (ADR-006, bat bien G1).",
      severity: "error",
      from: { pathNot: [APPS_UNSEAL_WORKER_PREFIX, ROUNDTRIP_TEST_TS, BENCH_INDEX_TS] },
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
      from: { pathNot: [APPS_UNSEAL_WORKER_PREFIX, UNWRAP_TS] },
      to: { path: LOCAL_DEV_UNWRAPPER_TS },
    },
    {
      name: "khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts",
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
      name: "khong-import-nguoc-tu-apps-unseal-worker",
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
      name: "khong-import-nguoc-tu-bench-keyprovider",
      comment:
        "tools/bench-keyprovider la cong cu dev-only duoc mien tru goi unwrap.ts de do hieu " +
        "nang - nhung khong gi ngoai chinh no duoc phep import LAI tu no, tranh no tro thanh " +
        "cau noi thu hai dua kha nang giai ma ra ngoai (fix round 3, phat hien N5).",
      severity: "error",
      from: { pathNot: BENCH_KEYPROVIDER_SRC_PREFIX },
      to: { path: BENCH_KEYPROVIDER_SRC_PREFIX },
    },
    {
      name: "khong-import-nguoc-tu-roundtrip-test",
      comment:
        "roundtrip.test.ts la file test, khong phai module san xuat - khong co ly do hop phap " +
        "nao de bat ky module nao import no. Khong mien tru module nao (fix round 3, phat " +
        "hien N5): day la cau noi thu ba co the dua kha nang giai ma ra ngoai neu bi bo qua.",
      severity: "error",
      from: {},
      to: { path: ROUNDTRIP_TEST_TS },
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
