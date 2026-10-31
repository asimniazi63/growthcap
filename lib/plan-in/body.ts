import { AppError } from "../errors";

// The multipart form around a file adds a little to its size.
const FORM_OVERHEAD = 16 * 1024;

// Reads an upload's form without ever holding more than the limit: the declared length is checked first, and the stream is
// counted as it arrives because a client can lie about it or send no length at all.
export async function readLimitedForm(request: Request, maxFileBytes: number): Promise<FormData> {
  const max = maxFileBytes + FORM_OVERHEAD;
  const tooBig = () => new AppError("INVALID_INPUT", `A file can be at most ${Math.round(maxFileBytes / 1024 / 1024)} MB.`);
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(type)) throw new AppError("INVALID_INPUT", "Send the file as a multipart form.");
  if (Number(request.headers.get("content-length") ?? 0) > max) throw tooBig();
  if (!request.body) throw new AppError("INVALID_INPUT", "The request has no file.");

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  try {
    return await new Response(new Blob(chunks), { headers: { "content-type": type } }).formData();
  } catch {
    throw new AppError("INVALID_INPUT", "The upload could not be read.");
  }
}
