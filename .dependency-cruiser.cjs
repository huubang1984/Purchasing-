module.exports = {
  forbidden: [
    {
      name: "khong-giai-ma-ngoai-unseal-worker",
      comment:
        "Chỉ apps/unseal-worker được chạm entrypoint mở khóa. Ranh giới bảo mật quan trọng " +
        "nhất của hệ thống (ADR-006, bất biến G1) — cưỡng chế bằng máy, không bằng trí nhớ.",
      severity: "error",
      // Ngoại lệ hẹp: test nội bộ của chính package crypto-keys được phép import
      // unwrap.ts để kiểm chứng vòng đời khóa (bọc rồi mở) — đây không phải đường
      // chạy runtime sản xuất nên không phá vỡ bất biến G1. Mọi module khác, kể cả
      // test ở package/app khác, vẫn bị chặn.
      from: {
        pathNot: [
          "^apps/unseal-worker/",
          "^packages/crypto-keys/src/.*\\.test\\.ts$",
        ],
      },
      to: { path: "^packages/crypto-keys/src/unwrap\\.ts$" },
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
  },
};
