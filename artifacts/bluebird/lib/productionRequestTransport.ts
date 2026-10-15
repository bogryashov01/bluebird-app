export interface ProductionTransportErrorFactory {
  timeout: (timeoutMs: number) => Error;
  cancelled: () => Error;
  network: () => Error;
  http: (response: Response) => Error;
  invalidJson: () => Error;
  schema: (error: unknown) => Error;
}

export interface ProductionRequestMetadata {
  method: string;
  headerNames: string[];
  credentials: RequestCredentials;
  abortSignalPassed: boolean;
  timeoutMs: number;
  fetchInvocationReceiver: 'globalThis';
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
  onResponseStatus?: (status: number) => void;
  onFetchInitiated?: () => void;
  onFetchCompleted?: () => void;
  onFetchFailed?: () => void;
  onRequestMetadata?: (metadata: ProductionRequestMetadata) => void;
  prepareHeaders?: (signal: AbortSignal) => Promise<Record<string, string>>;
  parse: (value: unknown) => T;
  errors: ProductionTransportErrorFactory;
}

const SAFE_REQUEST_HEADER_NAMES = new Map([
  ['accept', 'Accept'],
  ['authorization', 'Authorization'],
  ['content-type', 'Content-Type'],
]);

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
  let fetchStarted = false;
  let fetchSettled = false;
  const markFetchFailed = () => {
    if (!fetchStarted || fetchSettled) return;
    fetchSettled = true;
    notify(options.onFetchFailed);
  };
  let rejectAbort: (reason: Error) => void = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortFromCaller = () => {
    cancelled = true;
    controller.abort();
    markFetchFailed();
    rejectAbort(options.errors.cancelled());
  };
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    markFetchFailed();
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
      const requestHeaders = { ...options.headers, ...extraHeaders };
      const requestInit: RequestInit = {
        method: options.method,
        headers: requestHeaders,
        ...(options.body === undefined ? {} : { body: options.body }),
        credentials: options.credentials,
        signal: controller.signal,
      };
      fetchStarted = true;
      notify(options.onFetchInitiated);
      notifyRequestMetadata(options.onRequestMetadata, {
        method: options.method,
        headerNames: [...new Set(
          Object.keys(requestHeaders)
            .map((name) => SAFE_REQUEST_HEADER_NAMES.get(name.toLowerCase()))
            .filter((name): name is string => name !== undefined),
        )].sort(),
        credentials: options.credentials,
        abortSignalPassed: requestInit.signal !== undefined,
        timeoutMs: options.timeoutMs,
        fetchInvocationReceiver: 'globalThis',
      });
      response = await options.fetcher.call(globalThis, options.url, requestInit);
      if (!fetchSettled) {
        fetchSettled = true;
        notify(options.onFetchCompleted);
      }
    } catch {
      markFetchFailed();
      if (timedOut) throw options.errors.timeout(options.timeoutMs);
      if (cancelled || controller.signal.aborted) throw options.errors.cancelled();
      throw options.errors.network();
    }
    options.onResponseStatus?.(response.status);
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

function notify(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Diagnostic observers must never change request behavior.
  }
}

function notifyRequestMetadata(
  callback: ((metadata: ProductionRequestMetadata) => void) | undefined,
  metadata: ProductionRequestMetadata,
): void {
  try {
    callback?.(metadata);
  } catch {
    // Diagnostic observers must never change request behavior.
  }
}
