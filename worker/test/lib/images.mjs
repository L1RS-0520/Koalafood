// 内存里生成的测试图片（2×2 真图，文件头合法），不读写磁盘。
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4' +
  'nGP8f4KBgYGBiYGBgYGBAQAWfQHL5nHA6AAAAABJRU5ErkJggg==');
const WEBP = b64('UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AAD' +
  'sAD+9aD//yn75gB8wA/5T9/8zRMcx+vQAAA=');
const GIF = b64('R0lGODdhAgACAIEAAP/IAAAAAAAAAAAAACwAAAAAAgACAAAIBgABCAQQ' +
  'EAA7');
const JPEG = b64([
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS',
  'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ',
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy',
  'MjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA',
  'AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh',
  'MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6',
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZ',
  'mqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx',
  '8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA',
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV',
  'YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp',
  'anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE',
  'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0',
  'Kiiivx4+nP/Z',
].join(''));

const BASE = { png: PNG, jpg: JPEG, webp: WEBP, gif: GIF };
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif',
};

// 末尾追加标记字节，让每张图内容不同（解码器忽略尾随数据），
// 便于按字节核对「读回的是哪一张」。
export function image(kind, tag = '') {
  const tail = new TextEncoder().encode(tag ? `KOALA-TEST:${tag}` : '');
  const bytes = new Uint8Array(BASE[kind].length + tail.length);
  bytes.set(BASE[kind]);
  bytes.set(tail, BASE[kind].length);
  return { bytes, type: TYPES[kind], filename: `${tag || kind}.${kind}` };
}

// 指定字节数的「合法 PNG 头 + 零填充」，用来卡单张大小上限。
// 上限常量见 validators.mjs 的 MAX_PHOTO_BYTES，这里不写死。
export function pngOfSize(size, filename = 'sized.png') {
  if (size < PNG.length) throw new Error(`size 至少 ${PNG.length}`);
  const bytes = new Uint8Array(size);
  bytes.set(PNG);
  return { bytes, type: 'image/png', filename };
}
// 比上限多 1 字节
export const tooLargePng = (limit) =>
  pngOfSize(limit + 1, 'big.png');

export const textFile = () => ({
  bytes: new TextEncoder().encode('这不是图片'),
  type: 'text/plain', filename: 'note.txt',
});
// 伪装：文本内容 + .png 扩展名 + image/png 类型
export const fakePng = () => ({
  bytes: new TextEncoder().encode('<html>不是图片</html>'),
  type: 'image/png', filename: 'fake.png',
});

export const sameBytes = (a, b) => a.length === b.length &&
  a.every((x, i) => x === b[i]);
