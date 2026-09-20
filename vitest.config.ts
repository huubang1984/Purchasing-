import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ==============================================================================================
// [S1.94] TRẦN SỐ TỆP CHẠY CÙNG LÚC — VÌ THỨ KHAN HIẾM Ở ĐÂY KHÔNG PHẢI CPU MÀ LÀ CONTAINER.
//
// Mỗi tệp `*.int.test.ts` tự dựng MỘT container Postgres (`startPostgres`), và kho nay có 51 tệp
// như vậy. Vitest mặc định lấy trần theo số CPU, nên trên máy 16 luồng nó mở tới ~15 cluster
// Postgres cùng lúc trên MỘT đĩa ảo Docker — và cái nghẽn ở đó là I/O, không phải phép tính.
//
// ĐO ĐƯỢC ngày 2026-09-20, cùng một cây mã, không đổi một dòng sản xuất nào:
//   · `db/rls-coverage.int.test.ts` chạy RIÊNG: 51/51 đạt, 121,7 giây.
//   · CHÍNH tệp ấy trong lượt evidence ở trần mặc định: 507 giây, một test hết hạn 180 giây, rồi
//     ba test sau đỏ dây chuyền — vitest KHÔNG huỷ test quá hạn nên nó chạy tiếp và làm bẩn
//     fixture của các test sau trong cùng tệp.
//   · Hai lượt evidence liên tiếp: mọi tệp int chậm đều 1,35 lần (cộng dồn 3308 → 4465 giây), kể
//     cả những tệp không liên quan gì tới vòng vá — tức máy, không phải hồi quy.
//
// VÌ SAO LÀ TRẦN (`Math.min`) CHỨ KHÔNG PHẢI MỘT SỐ CỨNG: máy CI chỉ có 2–4 luồng. Viết cứng 6 ở
// đó là NÂNG mức song song lên chứ không hạ, đúng chiều ngược với thứ dòng này muốn. `min` giữ
// nguyên hành vi cũ ở mọi máy nhỏ hơn trần.
//
// RANH GIỚI NÓI RA: dòng này KHÔNG chữa cái gốc. Gốc là 51 container cho một lượt gác cổng, và
// các hạn 180 giây rải trong `db/` vẫn đứng nguyên vì chúng canh thứ khác (một `migrate()` treo
// thật). Trần này chỉ mua lại khoảng thở, và nó mua bằng một cái giá: trên máy nhiều luồng, lượt
// `pnpm test` (không container) cũng chậm đi vì bị hạ cùng. Xem khoản 203.
// ==============================================================================================
const TRAN_TEP_CUNG_LUC = 6;

export default defineConfig({
  resolve: {
    // THỨ TỰ Ở ĐÂY LÀ LOAD-BEARING. Vite so khớp alias theo tiền tố, THEO THỨ TỰ KHAI BÁO, nên
    // hai cửa SUBPATH phải đứng TRƯỚC tiền tố chung — nếu không, `@trustprocure/crypto-keys/unwrap`
    // sẽ bị dịch thành `packages/crypto-keys/unwrap` (thiếu `/src`) và không resolve được.
    //
    // [S1.6] Hai dòng ấy ra đời cùng `apps/unseal-worker`, tiến trình DUY NHẤT được đi qua hai
    // cửa hạn chế của `g1-` và `g8-`. Trước nó, không ai import hai cửa đó bằng bare specifier
    // nên khiếm khuyết này không có chỗ nào lộ ra.
    alias: {
      "@trustprocure/crypto-keys/unwrap": fileURLToPath(
        new URL("./packages/crypto-keys/src/unwrap.ts", import.meta.url),
      ),
      "@trustprocure/sealed-envelope/unseal": fileURLToPath(
        new URL("./packages/sealed-envelope/src/unseal.ts", import.meta.url),
      ),
      // [S1.17] Cửa hạn chế thứ ba, cùng khuôn: `g11-` chỉ cho tools/neo-so-kiem-toan và test
      // của chính file đó đi qua. Xem khối đầu `packages/audit/src/anchor-sign.ts`.
      "@trustprocure/audit/anchor-sign": fileURLToPath(
        new URL("./packages/audit/src/anchor-sign.ts", import.meta.url),
      ),
      "@trustprocure": fileURLToPath(new URL("./packages", import.meta.url)),
    },
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
      // [S1.6] `apps/` KHÔNG có ở đây cho tới khi `apps/unseal-worker` ra đời, và sự vắng mặt ấy
      // là một khiếm khuyết CÓ THẬT chứ không phải một lựa chọn: `tsconfig.json` include
      // `apps/**/*.ts` từ S0, nên một test đặt trong `apps/` sẽ typecheck, sẽ được depcruise quét,
      // và sẽ KHÔNG BAO GIỜ CHẠY. Một test không chạy là một test luôn xanh.
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
      "db/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 180000,
    // `minWorkers` phải đi kèm: mặc định của nó cũng suy từ số CPU, nên hạ MỘT MÌNH `maxWorkers`
    // xuống dưới số ấy làm tinypool ném ngay lúc khởi động (`minThreads and maxThreads must not
    // conflict`) — đo được lúc áp dòng trên, vitest chạy 0 tệp và thoát.
    minWorkers: 1,
    maxWorkers: Math.min(availableParallelism(), TRAN_TEP_CUNG_LUC),
  },
});
