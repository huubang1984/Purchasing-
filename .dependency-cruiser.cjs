module.exports = {
  forbidden: [
    {
      name: "khong-giai-ma-ngoai-unseal-worker",
      comment:
        "Chỉ apps/unseal-worker được chạm khả năng mở khóa. Ranh giới bảo mật quan trọng " +
        "nhất của hệ thống (ADR-006, bất biến G1) — cưỡng chế bằng máy, không bằng trí nhớ. " +
        "Phủ cả entrypoint công khai (unwrap.ts) LẪN cài đặt bên trong (local-dev-unwrapper.ts, " +
        "local-dev-shared.ts) — chặn cả đường vòng import tương đối thẳng vào file cài đặt, " +
        "bỏ qua entrypoint (sự cố phát hiện ở fix round 1, xem tests/architecture/boundaries.test.ts).",
      severity: "error",
      from: {
        pathNot: [
          "^apps/unseal-worker/",
          // Đồ thị nội bộ hợp lệ của chính package crypto-keys: ba file này tạo thành cài đặt
          // của hai mặt tiền công khai (index.ts an toàn, unwrap.ts hạn chế) và BẮT BUỘC phải
          // import lẫn nhau. Không file nào trong số này export khả năng giải mã ra ngoài
          // package theo đường nào khác ngoài unwrap.ts.
          "^packages/crypto-keys/src/unwrap\\.ts$",
          "^packages/crypto-keys/src/local-dev-wrapper\\.ts$",
          "^packages/crypto-keys/src/local-dev-unwrapper\\.ts$",
          // Ngoại lệ hẹp nhất có thể, đúng MỘT file: test vòng đời khóa của chính package này
          // cần import unwrap.ts để kiểm chứng bọc-rồi-mở end-to-end. Không mở rộng cho các
          // file *.test.ts khác trong cùng thư mục (vd. wrapper.test.ts không cần và không có).
          "^packages/crypto-keys/src/roundtrip\\.test\\.ts$",
          // Ngoại lệ dev-only tường minh, đúng MỘT file: công cụ đo hiệu năng cần gọi cả hai
          // entrypoint để đo trọn vòng bọc+mở (xem tools/bench-keyprovider/src/index.ts). Đây
          // là công cụ dev, không phải service chạy production — khai báo rõ ràng ở đây thay vì
          // để lọt qua bằng lỗi resolve module như đã xảy ra ở fix round 1.
          "^tools/bench-keyprovider/src/index\\.ts$",
        ],
      },
      to: {
        path: [
          "^packages/crypto-keys/src/unwrap\\.ts$",
          "^packages/crypto-keys/src/local-dev-unwrapper\\.ts$",
          "^packages/crypto-keys/src/local-dev-shared\\.ts$",
        ],
      },
    },
    {
      name: "khong-import-trustprocure-khong-resolve-duoc",
      comment:
        "Import dạng @trustprocure/* không resolve được ra file thật là dấu hiệu lỗi cấu hình " +
        "(subpath export sai, typo, thiếu entry trong package.json 'exports') — KHÔNG được để " +
        "âm thầm lọt qua mọi quy tắc khác. Đây chính xác là cách mà " +
        "@trustprocure/crypto-keys/unwrap từng lọt qua quy tắc khong-giai-ma-ngoai-unseal-worker " +
        "ở bản trước fix round 1: specifier không resolve được nên không khớp `to.path`, quy tắc " +
        "coi như không có gì để chặn. Quy tắc này là lớp phòng thủ chống lại chính lớp lỗi đó.",
      severity: "error",
      from: {},
      to: { path: "^@trustprocure/", couldNotResolve: true },
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
    // Bắt buộc để depcruise tự resolve subpath export (vd. "@trustprocure/crypto-keys/unwrap")
    // qua package.json "exports", giống hệt cách Node/bundler thật resolve lúc chạy. Thiếu dòng
    // này, subpath không map đúng qua tsconfig "paths" (một wildcard không xử lý được subpath
    // lồng) và depcruise coi module là "couldNotResolve" — bỏ qua toàn bộ quy tắc "to.path" một
    // cách âm thầm. Đây là nguyên nhân gốc của lỗ hổng C1 phát hiện ở fix round 1.
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
