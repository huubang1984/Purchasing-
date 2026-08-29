// =============================================================================================
// TRÌNH ĐIỀU KHIỂN `pnpm evidence` — HAI BƯỚC, VÀ BƯỚC MỘT ĐƯỢC PHÉP ĐỎ
//
// Brief đề nghị `"evidence": "pnpm test:report ; node …"` với ghi chú rằng dấu `;` (không phải
// `&&`) là cố ý: ma trận phải được sinh KỂ CẢ KHI có test đỏ, vì đó chính là lúc cần nhìn thấy
// bất biến nào đang hỏng. Ý đó đúng và được giữ nguyên ở đây. Cái KHÔNG dùng được là dấu `;`:
// trình giả lập shell của pnpm hiểu `&&` và `||` nhưng KHÔNG hiểu `;` — đo được, nó truyền
// nguyên `";" "node" "--experimental-transform-types" …` vào làm THAM SỐ của vitest:
//     CACError: Unknown option `--experimentalTransformTypes`
// Một `&&` thay vào đó sẽ đổi NGỮ NGHĨA (bỏ mất "sinh cả khi đỏ"), nên script này giữ ngữ nghĩa
// và bỏ cái shell đi.
//
// HAI CHỌN LỰA CÒN LẠI ĐỀU LÀ HỆ QUẢ TRỰC TIẾP CỦA RÀNG BUỘC (11):
//
// (a) GỌI VITEST BẰNG `process.execPath` + ĐƯỜNG DẪN .mjs, KHÔNG QUA SHIM `.cmd`. Trên Windows,
//     `execFileSync("npx.cmd", …)` trả `status = null` và `stdout = undefined` mà KHÔNG NÉM,
//     không một dòng đầu ra — cơ chế đã cho NĂM kết quả "sống sót" GIẢ trong một lô đột biến
//     của dự án này. `node node_modules/vitest/vitest.mjs` không đi qua shim nào.
//
// (b) ĐÒI DẤU HIỆU TÍCH CỰC, KHÔNG ĐÒI "KHÔNG THẤY LỖI". Bước 1 chỉ được coi là ĐÃ CHẠY khi
//     file báo cáo tồn tại VÀ chứa ít nhất một khẳng định. "Vitest thoát mã 1" không đủ để kết
//     luận gì: mã 1 vừa là "có test đỏ" (hợp lệ, đi tiếp) vừa là "vitest không khởi động được"
//     (không hợp lệ, phải dừng). Chỉ nội dung báo cáo phân biệt được hai ca đó.
// =============================================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "../..");
const VITEST = resolve(REPO, "node_modules/vitest/vitest.mjs");
const BAO_CAO = resolve(REPO, "evidence/vitest-report.json");
const BO_SINH = resolve(REPO, "tools/inv-matrix/src/index.ts");
// `--import` doi mot URL: tren Windows mot duong dan tuyet doi "D:..." bi doc la scheme "d:".
const HOOK = pathToFileURL(resolve(import.meta.dirname, "register-ts-resolve.mjs")).href;

function chay(args, nhan) {
  const kq = spawnSync(process.execPath, args, { cwd: REPO, stdio: "inherit" });
  if (kq.error) {
    console.error(`[evidence] ${nhan} không khởi động được: ${kq.error.message}`);
    process.exit(1);
  }
  if (kq.signal !== null) {
    console.error(`[evidence] ${nhan} bị tín hiệu ${kq.signal} giết — KHÔNG kết luận gì từ đây.`);
    process.exit(1);
  }
  return kq.status;
}

if (!existsSync(VITEST)) {
  console.error(`[evidence] không thấy ${VITEST} — chạy \`pnpm install\` trước.`);
  process.exit(1);
}

// --- BƯỚC 1: chạy CẢ HAI TẦNG. `vitest run` không loại trừ `*.int.test.ts`. -------------------
// Nếu bước này chỉ chạy tầng đơn vị thì mọi bất biến được phủ ở tầng tích hợp (phần lớn
// B3/B4/D1/D3/F1) sẽ hiện là CHƯA PHỦ — một ĐỎ GIẢ, và cách "sửa" hấp dẫn nhất cho nó là nới
// regex nhãn. Đó đúng là thứ QT2 cấm.
const maTest = chay(
  [VITEST, "run", "--reporter=json", `--outputFile=${BAO_CAO}`],
  "vitest",
);

if (!existsSync(BAO_CAO)) {
  console.error(`[evidence] vitest thoát mã ${maTest} và KHÔNG ghi ${BAO_CAO}. Bộ test chưa chạy.`);
  process.exit(1);
}
let soKhangDinh = 0;
try {
  const bc = JSON.parse(readFileSync(BAO_CAO, "utf8"));
  for (const f of bc.testResults ?? []) soKhangDinh += (f.assertionResults ?? []).length;
} catch (e) {
  console.error(`[evidence] không đọc được ${BAO_CAO}: ${e.message}`);
  process.exit(1);
}
if (soKhangDinh === 0) {
  console.error(
    `[evidence] báo cáo không có một khẳng định nào (vitest thoát mã ${maTest}). ` +
      `"Không thấy chữ failed" KHÔNG BAO GIỜ đủ để kết luận bộ test đã chạy.`,
  );
  process.exit(1);
}
console.log(`[evidence] vitest thoát mã ${maTest}, báo cáo có ${soKhangDinh} khẳng định.`);

// --- BƯỚC 2: sinh ma trận. CHẠY KỂ CẢ KHI BƯỚC 1 ĐỎ — đó là lúc cần nó nhất. -----------------
process.exit(chay(["--experimental-transform-types", "--import", HOOK, BO_SINH], "bộ sinh"));
