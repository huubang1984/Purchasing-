// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// BẢN SAO CÓ CHỦ Ý của `apps/api/ts-resolve-hook.mjs`, không phải sơ suất — cùng lý do đã ghi ở
// đó: để `apps/mcp` import file của `apps/api` chỉ vì mười chín dòng này là tạo một CẠNH PHỤ
// THUỘC giữa hai app mà `depcruise` phải bless, và với `apps/mcp` cạnh ấy còn phá chính bảo đảm
// của nó ("không kéo cây nghiệp vụ vào tiến trình chỉ nói HTTP" — xem `src/cong-cu.test.ts`).
//
// Lý do tồn tại: mã nguồn dùng quy ước NodeNext chuẩn — import bằng đuôi ".js" dù file nguồn là
// ".ts". `node --experimental-transform-types` chỉ bóc cú pháp TypeScript, KHÔNG tự ánh xạ đuôi
// file như bộ giải quyết module của vitest/vite vẫn làm. Không đổi hành vi runtime nào khác: nếu
// resolve gốc thành công hoặc lỗi không phải "không tìm thấy module", hook không can thiệp.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const khongTimThayModule =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND";
    if (specifier.endsWith(".js") && khongTimThayModule) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    throw error;
  }
}
