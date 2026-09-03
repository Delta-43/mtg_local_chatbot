declare module 'stream-json/streamers/stream-array.js' {
  import type { Transform } from 'node:stream';

  export function streamArray(): Transform;
}
