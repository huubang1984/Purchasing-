import { KeyError } from "./types.js";

/**
 * Tập master key theo phiên bản.
 *
 * Xoay khóa nghĩa là thêm một phiên bản mới và chuyển `activeVersion` sang nó,
 * đồng thời GIỮ LẠI các phiên bản cũ. Phong bì bọc bằng phiên bản cũ vẫn mở được
 * (bất biến G3) — nếu bỏ phiên bản cũ đi thì toàn bộ báo giá đã niêm phong trước
 * lần xoay sẽ vĩnh viễn không mở được.
 */
export class MasterKeyRing {
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(
    readonly activeVersion: string,
    keys: Readonly<Record<string, Buffer>>,
  ) {
    const entries = Object.entries(keys);
    for (const [version, key] of entries) {
      if (key.length !== 32) {
        throw new KeyError(`Master key "${version}" phải dài đúng 32 byte, đang là ${key.length}.`);
      }
    }
    if (!Object.hasOwn(keys, activeVersion)) {
      throw new KeyError(
        `Vòng khóa không chứa phiên bản đang dùng "${activeVersion}".`,
      );
    }
    this.#keys = new Map(entries);
  }

  get(version: string): Buffer {
    const key = this.#keys.get(version);
    if (!key) {
      throw new KeyError(`Vòng khóa không có phiên bản khóa "${version}".`);
    }
    return key;
  }

  active(): { version: string; key: Buffer } {
    return { version: this.activeVersion, key: this.get(this.activeVersion) };
  }
}
