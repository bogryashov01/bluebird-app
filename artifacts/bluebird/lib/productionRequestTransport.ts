export interface ProductionTransportErrorFactory {
  timeout: (timeoutMs: number) => Error;
  cancelled: () => Error;
  network: () => Error;
  http: (response: Response) => Error;
  invalidJson: () => Error;
  schema: (error: unknown) => Error;
}

export interface ProductionJsonRequestOptions<T> {
  url: string;
  fetcher: typeof fetch;
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentials: RequestCredentials;
  timeoutMs: number;
  signal?: AbortSignal;
  prepareHeaders?: (signal: AbortSignal) => Promise<Record<string, string>>;
  parse: (value: unknown) => T;
  errors: ProductionTransportErrorFactory;
}

/**
 * Shared production JSON transport. Callers supply error types and response
 * validation so public and authenticated APIs keep their distinct contracts.
 */
export async function requestProductionJson<T>(
  options: ProductionJsonRequestOptions<T>,
): Promise<T> {
  if (options.signal?.aborted) throw options.errors.cancelled();

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let cancelled = false;
  let rejectAbort: (reason: Error) => void = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortFromCaller = () => {
    cancelled = true;
    controller.abort();
    rejectAbort(options.errors.cancelled());
  };
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectAbort(options.errors.timeout(options.timeoutMs));
  }, options.timeoutMs);

  const operation = async (): Promise<T> => {
    const extraHeaders = options.prepareHeaders
      ? await options.prepareHeaders(controller.signal)
      : {};
    if (controller.signal.aborted) {
      throw timedOut ? options.errors.timeout(options.timeoutMs) : options.errors.cancelled();
    }

    let response: Response;
    try {
      response = await options.fetcher(options.url, {
        method: options.method,
        headers: { ...options.headers, ...extraHeaders },
        ...(options.body === undefined ? {} : { body: options.body }),
        credentials: options.credentials,
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw options.errors.timeout(options.timeoutMs);
      if (cancelled || controller.signal.aborted) throw options.errors.cancelled();
      throw options.errors.network();
    }
    if (!response.ok) throw options.errors.http(response);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      if (timedOut) throw options.errors.timeout(options.timeoutMs);
      if (cancelled || controller.signal.aborted) throw options.errors.cancelled();
      throw options.errors.invalidJson();
    }

    try {
      return options.parse(json);
    } catch (error) {
      throw options.errors.schema(error);
    }
  };

  try {
    return await Promise.race([operation(), abortPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
