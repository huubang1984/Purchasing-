// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// Lý do tồn tại: các module trong packages/crypto-keys dùng quy ước NodeNext chuẩn —
// import bằng đuôi ".js" dù file nguồn là ".ts" (để nếu sau này biên dịch bằng tsc thì
// specifier vẫn đúng). `node --experimental-strip-types` chỉ bóc cú pháp TypeScript,
// KHÔNG tự ánh xạ đuôi file như bộ giải quyết module của vitest/vite vẫn làm — nên chạy
// trực tiếp mã .ts qua node cần một hook nhỏ như thế này. Không đổi hành vi runtime nào
// khác: nếu resolve gốc thành công hoặc lỗi không phải "không tìm thấy module", hook
// không can thiệp.
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
