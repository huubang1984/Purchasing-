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
      // [S1.82 / khoan 116] Ban sao thu TU, cho `pnpm worker:dev`. Van viet duong dan DAY DU
      // ("apps/unseal-worker/*.mjs"), KHONG gop thanh "apps/*/*.mjs" — giu tinh chat "moi tep
      // .mjs khac deu on ao".
      "apps/unseal-worker/*.mjs",
      // [2026-08-29] Hai thư mục đo phục vụ QUYẾT ĐỊNH, không phải mã sản phẩm, và cùng
      // lý do kỹ thuật với hai dòng trên: thuần JS không kiểu, nằm ngoài "include" của
      // tsconfig.json (chỉ có "**/*.ts"), nên typescript-eslint không parse được.
      //   `bench-kms`     — đếm số lời gọi KMS một lượt mở thầu (ADR-009, trục 3).
      //   `do-webcrypto`  — trang dò khả năng WebCrypto, cộng server đột biến của nó.
      // Vẫn liệt kê TỪNG THƯ MỤC, KHÔNG gộp thành "tools/*/*.mjs": giữ nguyên tính chất
      // "mọi file .mjs khác trong repo đều ồn ào" mà fix round 2 đã mua bằng một lần đo.
      "tools/bench-kms/*.mjs",
      "tools/do-webcrypto/*.mjs",
      // [S1.11] `apps/api/*.mjs` — bộ ghi danh hook resolve cho `pnpm api:dev` (điểm vào của tiến
      // trình api chạy TypeScript trực tiếp bằng Node ≥ 22). Bản sao có chủ ý thứ ba của cùng
      // hook, cùng lý do đã ghi ở `tools/inv-matrix/ts-resolve-hook.mjs`. Vẫn liệt kê đúng một
      // thư mục, không gộp `apps/*/*.mjs`.
      "apps/api/*.mjs",
      // [S1.17] `tools/neo-so-kiem-toan/*.mjs` — bản sao có chủ ý thứ tư của cùng hook resolve,
      // cho entry point xuất/kiểm mốc neo ngoài. Vẫn liệt kê đúng một thư mục.
      "tools/neo-so-kiem-toan/*.mjs",
      // [ADR-038] `apps/mcp/*.mjs` — bản sao có chủ ý thứ NĂM của cùng hook resolve, cho điểm vào
      // của tiến trình MCP (`pnpm mcp:dev`). Lý do không dùng chung file với `apps/api` ghi ở đầu
      // `apps/mcp/ts-resolve-hook.mjs`. Vẫn liệt kê đúng một thư mục, không gộp `apps/*/*.mjs`.
      "apps/mcp/*.mjs",
      // [ADR-044] `apps/web/*.mjs` và `tools/gieo-demo/*.mjs` — bản sao có chủ ý thứ SÁU và thứ BẢY
      // của cùng hook resolve, cho `pnpm web:dev` và `pnpm gieo:demo`. Vẫn liệt kê TỪNG thư mục,
      // không gộp `apps/*/*.mjs`: tính chất "mọi tệp .mjs khác trong kho đều ồn ào" là thứ fix
      // round 2 đã mua bằng một lần đo, và một lần gộp cho tiện sẽ trả lại nó.
      "apps/web/*.mjs",
      "tools/gieo-demo/*.mjs",
      // [S1.114 / S2.7] `tools/bo-xuat-danh-gia/*.mjs` — bản sao có chủ ý thứ TÁM của cùng hook
      // resolve, cho `pnpm bang-chung`. Vẫn liệt kê đúng một thư mục, không gộp `tools/*/*.mjs`.
      "tools/bo-xuat-danh-gia/*.mjs",
      // [ADR-066] `tools/chay-migrate/*.mjs` — bản sao có chủ ý thứ CHÍN, cho entry point của task ECS
      // `tp-migrate`. Vẫn liệt kê đúng một thư mục.
      "tools/chay-migrate/*.mjs",
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
    // [ADR-044] MÃ CHẠY TRONG TRÌNH DUYỆT — `apps/web/trang/*.js`.
    //
    // Hai tệp này KHÔNG phải TypeScript và không nằm trong `tsconfig.json`, nên bộ luật cần kiểu
    // không chạy được trên chúng. Hai lựa chọn còn lại đều tệ hơn việc tắt phần cần kiểu: bỏ hẳn
    // chúng khỏi eslint (mã chạm cookie phiên của nhà cung cấp mà không lớp nào đọc), hoặc kéo
    // `lib: ["DOM"]` vào `tsconfig.base.json` (mở `document`, `window`, `localStorage` ra cho MỌI
    // tệp máy chủ của kho — bán kính ảnh hưởng lớn hơn nhiều, và `packages/sealed-envelope/src/
    // format.ts` đã ghi đúng lập luận ấy từ S1.4).
    //
    // `globals` liệt kê ĐÚNG những cái các tệp ấy dùng, không phải cả bộ trình duyệt.
    //
    // [S1.99 / khoản 207] CÂU TRÊN CHỈ THÀNH MỘT LỚP TỪ VÒNG NÀY. Bản cũ viết tiếp rằng *"một
    // tên mới xuất hiện sẽ làm eslint đỏ"* — và câu ấy SAI suốt từ S1.89, vì luật duy nhất đọc
    // `globals` là `no-undef`, mà `no-undef` không được bật ở bất kỳ đâu trong tệp này. Đo bằng
    // cách ép luật ra ngoài cấu hình: `npx eslint --rule '{"no-undef":"error"}' apps/web/trang`
    // cho đúng HAI lỗi, cả hai là `window` — một bề mặt trình duyệt không ai khai, đã lọt vào kho
    // từ vòng S1.98 mà `pnpm t0` vẫn xanh. Một danh sách trắng không có luật đọc nó là một lời
    // khai không có lớp, và nó nằm trong tệp cấu hình của chính bộ đo.
    //
    // Nay luật được bật ngay dưới đây, nên câu *"một tên mới sẽ làm eslint đỏ"* là một phép đo
    // chứ không phải một ý định.
    files: ["apps/web/trang/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        atob: "readonly",
        // [mảnh 1 / màn xuất bằng chứng] `Blob` + `URL.createObjectURL` + `setTimeout`: ghi hai tệp
        // của bộ bằng chứng ra đĩa người dùng, đúng byte máy chủ trả (`mo-thau.js` bước 8).
        Blob: "readonly",
        btoa: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    // Phải GỘP chứ không được thay: `disableTypeChecked` ở trên đóng góp trọn một khối `rules`
    // (mọi luật cần kiểu, tắt), và một khoá `rules` viết sau nó sẽ ĐÈ MẤT cả khối ấy — eslint
    // khi đó gãy ngay ở luật cần kiểu đầu tiên thay vì chạy. Đo một lần lúc bật luật này.
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "no-undef": "error",
    // [S1.107 / lượt soi ngang 77 — ③] VÀ MỘT LUẬT THỨ HAI, VÌ MỘT THƯ MỤC KHÔNG SINK HÔM NAY
    // KHÔNG PHẢI MỘT THƯ MỤC KHÔNG SINK.
    //
    // Lượt soi ngang 76 tìm ra BA khiếm khuyết CAO và cả ba nằm trong đúng thư mục này. Chúng
    // được vá ở S1.99 — nhưng vá ĐIỂM: hôm nay `apps/web/trang/*.js` có 0 chỗ gán `innerHTML`
    // khác rỗng, 0 `insertAdjacentHTML`, 0 `document.write` (đo ở lượt 77), và KHÔNG lớp nào giữ
    // cho con số ấy ở 0. Đây là mã duy nhất của kho chạy trong trình duyệt của người mua và của
    // nhà cung cấp, và nó dựng DOM từ dữ liệu máy chủ trả về — tên nhà cung cấp, mã thành phần
    // chính sách, thông điệp lỗi. Một `innerHTML` đặt vào đúng một trong những chỗ ấy là XSS.
    //
    // MƯỜI chỗ `innerHTML = ""` (xoá con) đã đổi sang `replaceChildren()` ở chính vòng này,
    // nên luật dưới đây KHÔNG cần một ngoại lệ nào — và một luật không ngoại lệ là luật không ai
    // học được cách lách.
    "no-restricted-properties": [
      "error",
      { property: "innerHTML", message: "Dựng DOM bằng createElement + textContent. `innerHTML` trên dữ liệu máy chủ là XSS; xoá con thì dùng replaceChildren()." },
      { property: "outerHTML", message: "Dựng DOM bằng createElement + textContent, không bằng chuỗi HTML." },
      { property: "insertAdjacentHTML", message: "Dựng DOM bằng createElement + textContent, không bằng chuỗi HTML." },
      { object: "document", property: "write", message: "`document.write` phân tích chuỗi thành HTML — cùng lớp rủi ro với innerHTML." },
      { object: "document", property: "writeln", message: "`document.writeln` phân tích chuỗi thành HTML — cùng lớp rủi ro với innerHTML." },
    ],
    },
  },
  {
    files: ["**/*.test.ts", "tools/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
