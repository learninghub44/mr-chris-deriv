/**
 * Centralized WebSocket handler for safely subscribing to observables.
 * Wraps event listeners in try/catch and logs errors with stack traces to prevent unhandled exceptions.
 */

export const safeSubscribe = (
    observable: any,
    onData: (data: any) => void,
    onError?: (error: unknown) => void
) => {
    if (!observable || typeof observable.subscribe !== 'function') {
        console.error('[WebSocketHandler] Invalid observable provided to safeSubscribe');
        return { unsubscribe: () => {} };
    }

    return observable.subscribe(
        (data: any) => {
            try {
                onData(data);
            } catch (err) {
                console.error('[WebSocketHandler] Exception in onData listener:\n', err instanceof Error ? err.stack : err);
            }
        },
        (error: unknown) => {
            try {
                if (onError) {
                    onError(error);
                } else {
                    console.error('[WebSocketHandler] Unhandled stream error:\n', error instanceof Error ? error.stack : error);
                }
            } catch (err) {
                console.error('[WebSocketHandler] Exception in onError listener:\n', err instanceof Error ? err.stack : err);
            }
        }
    );
};
