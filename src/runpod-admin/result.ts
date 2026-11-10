export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure {
  readonly ok: false;
  readonly error: string;
}

export type Result<T> = Success<T> | Failure;

export const isFailure = <T>(result: Result<T>): result is Failure => !result.ok;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function settle<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
