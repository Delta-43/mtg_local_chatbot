import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import chain from 'stream-chain';

export async function* iterateArrayStream<T>(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<T> {
  const pipeline = chain([Readable.fromWeb(body as NodeReadableStream), parser(), streamArray()]);

  for await (const chunk of pipeline as AsyncIterable<{ value: T }>) {
    yield chunk.value;
  }
}
