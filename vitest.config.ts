import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
  },
});
