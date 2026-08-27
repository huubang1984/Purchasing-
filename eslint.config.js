import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "evidence/**",
      "**/*.cjs",
      // Thu hẹp tối đa (fix round 2, phát hiện N1): trước đây "**/*.mjs" loại TOÀN BỘ lớp
      // file .mjs khỏi eslint trên toàn repo — một file .mjs độc hại đặt ở BẤT KỲ đâu (vd.
      // apps/zprobe/src/leak.mjs) sẽ vô hình với eslint. Giờ chỉ hai file .mjs THẬT SỰ cần
      // (hook resolve module cho tools/bench-keyprovider, không thể parse bằng typescript-eslint
      // vì nằm ngoài "include" của tsconfig.json) được loại; mọi file .mjs khác trong repo phải
      // đi qua eslint như bình thường (sẽ lỗi "not found by project service" nếu không nằm
      // trong tsconfig — một lỗi ồn ào, không phải một khoảng trống im lặng).
      "tools/bench-keyprovider/*.mjs",
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
