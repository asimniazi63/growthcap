// Splits a response stream in two: one for the browser, one the server reads to the end itself. If the person closes the tab
// mid-answer, the model has already been paid for, and the turn must still finish and be saved; with only the browser's
// copy, a cancelled stream would stop the work before it saved anything.
export function detach<T>(stream: ReadableStream<T>): { client: ReadableStream<T>; finished: Promise<void> } {
  const [client, server] = stream.tee();
  const finished = server.pipeTo(new WritableStream<T>({})).catch(() => undefined);
  return { client, finished };
}
