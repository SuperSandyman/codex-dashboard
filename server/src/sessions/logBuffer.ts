/**
 * 再接続時に使うログのスナップショットを保持する。
 */
export class LogBuffer {
  readonly #maxChars: number;
  #buffer: string;

  /**
   * 直近ログを保持するリングバッファを作成する。
   * @param maxChars 保持する最大文字数
   */
  constructor(maxChars: number) {
    this.#maxChars = Math.max(0, maxChars);
    this.#buffer = '';
  }

  /**
   * 出力ログを追加し、上限を超えた分は古い内容を削る。
   * @param chunk 追加するログ文字列
   */
  append(chunk: string): void {
    if (this.#maxChars === 0) {
      return;
    }

    this.#buffer = `${this.#buffer}${chunk}`;
    if (this.#buffer.length <= this.#maxChars) {
      return;
    }

    this.#buffer = this.#buffer.slice(this.#buffer.length - this.#maxChars);
  }

  /**
   * 直近ログのスナップショットを返す。
   */
  snapshot(): string {
    return this.#buffer;
  }
}
