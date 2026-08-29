import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "evidence/**",
      // Thu hep tu "**/*.cjs" xuong dung nhung gi that su can (fix round 3, phat hien
      // N7): cung ly do da dung de thu hep "**/*.mjs" o fix round 2 - mot file .cjs la
      // vo hinh voi eslint tren toan repo neu dung blanket glob, va tsconfig.json cung
      // khong include "**/*.cjs" nen tsc cung khong thay. Chi hai file .cjs THAT SU can
      // (cau hinh dependency-cruiser va helper regex khong phan biet hoa thuong cua no,
      // ca hai deu thuan JS khong co kieu, khong the parse bang typescript-eslint vi nam
      // ngoai "include" cua tsconfig.json) duoc loai. File .cjs khac trong tuong lai co
      // ten dang "*.config.cjs" cung duoc loai theo quy uoc, nhung MOI file .cjs khac
      // deu phai qua eslint binh thuong.
      "**/*.config.cjs",
      ".dependency-cruiser.cjs",
      "dependency-cruiser-ci.cjs",
      // Thu hẹp tối đa (fix round 2, phát hiện N1): trước đây "**/*.mjs" loại TOÀN BỘ lớp
      // file .mjs khỏi eslint trên toàn repo — một file .mjs độc hại đặt ở BẤT KỲ đâu (vd.
      // apps/zprobe/src/leak.mjs) sẽ vô hình với eslint. Giờ chỉ hai file .mjs THẬT SỰ cần
      // (hook resolve module cho tools/bench-keyprovider, không thể parse bằng typescript-eslint
      // vì nằm ngoài "include" của tsconfig.json) được loại; mọi file .mjs khác trong repo phải
      // đi qua eslint như bình thường (sẽ lỗi "not found by project service" nếu không nằm
      // trong tsconfig — một lỗi ồn ào, không phải một khoảng trống im lặng).
      // [Task 11] `tools/inv-matrix/*.mjs` là BẢN SAO CÓ CHỦ Ý của hai file trên (lý do ghi ở
      // đầu `tools/inv-matrix/ts-resolve-hook.mjs`: để hai tool dev không sinh ra một cạnh phụ
      // thuộc lẫn nhau mà depcruise phải bless). Vẫn liệt kê TỪNG THƯ MỤC, không gộp thành
      // "tools/*/*.mjs" — giữ nguyên tính chất "mọi file .mjs khác đều ồn ào".
      "tools/bench-keyprovider/*.mjs",
      "tools/inv-matrix/*.mjs",
      // [2026-08-29] Hai thư mục đo phục vụ QUYẾT ĐỊNH, không phải mã sản phẩm, và cùng
      // lý do kỹ thuật với hai dòng trên: thuần JS không kiểu, nằm ngoài "include" của
      // tsconfig.json (chỉ có "**/*.ts"), nên typescript-eslint không parse được.
      //   `bench-kms`     — đếm số lời gọi KMS một lượt mở thầu (ADR-009, trục 3).
      //   `do-webcrypto`  — trang dò khả năng WebCrypto, cộng server đột biến của nó.
      // Vẫn liệt kê TỪNG THƯ MỤC, KHÔNG gộp thành "tools/*/*.mjs": giữ nguyên tính chất
      // "mọi file .mjs khác trong repo đều ồn ào" mà fix round 2 đã mua bằng một lần đo.
      "tools/bench-kms/*.mjs",
      "tools/do-webcrypto/*.mjs",
      ".claude/**",
      "eslint.config.js",
      "vitest.config.ts",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["**/*.test.ts", "tools/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
